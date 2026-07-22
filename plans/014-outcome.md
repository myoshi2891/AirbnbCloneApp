# Plan 014 Outcome: 予約ライフサイクル

## 結論

`paymentStatus Boolean`を状態enumへ置換し、キャンセル主体は別enumで保持する。返金後も「誰がキャンセルしたか」を失わず、状態照会を単純にするためである。

```prisma
enum BookingStatus {
  PENDING
  CONFIRMED
  CANCELLED
  REFUND_PENDING
  REFUNDED
  EXPIRED
}

enum BookingCancelledBy {
  GUEST
  HOST
  SYSTEM
}
```

Bookingへ`status BookingStatus @default(PENDING)`、`expiresAt DateTime? @db.Timestamptz(3)`、`paymentIntentId String? @unique`、`stripeRefundId String? @unique`、`cancelledBy BookingCancelledBy?`、`cancelledAt DateTime?`、`refundedAt DateTime?`を追加する。既存`checkoutSessionExpiresAt`は`expiresAt`へ統合する。

## 1. 状態遷移

| 現在状態 | イベント | 条件 | 次状態 | 副作用 |
|---|---|---|---|---|
| PENDING | Checkout Session作成 | 所有者一致・在庫競合なし | PENDING | session IDとStripe expiryを保存 |
| PENDING | payment success webhook/confirm | `payment_status=paid` | CONFIRMED | PaymentIntent IDを保存 |
| PENDING | expiry判定 | `expiresAt <= now` | EXPIRED | 在庫holdを解放 |
| PENDING | ゲスト取消 | 所有者一致 | CANCELLED | `cancelledBy=GUEST` |
| CONFIRMED | ゲスト取消 | check-inの48時間以上前 | REFUND_PENDING | 全額返金を開始 |
| CONFIRMED | ゲスト取消 | check-inまで48時間未満 | CANCELLED | 返金なし |
| CONFIRMED | ホスト取消 | 常時 | REFUND_PENDING | 全額返金を開始 |
| REFUND_PENDING | refund succeeded | refund API応答またはwebhook | REFUNDED | refund ID、refundedAtを保存 |
| REFUND_PENDING | retry | 同じBooking | REFUND_PENDING | 同じidempotency keyで再試行 |

終端状態は`CANCELLED`、`REFUNDED`、`EXPIRED`。終端状態からのユーザー操作による遷移は拒否する。`checkout.session.async_payment_failed`は即時の新状態を増やさず、Session expiryまでPENDINGとして扱う。

## 2. migrationと既存データ

SQL素案:

```sql
CREATE TYPE "BookingStatus" AS ENUM (
  'PENDING', 'CONFIRMED', 'CANCELLED',
  'REFUND_PENDING', 'REFUNDED', 'EXPIRED'
);

ALTER TABLE "Booking"
  ADD COLUMN "status" "BookingStatus",
  ADD COLUMN "expiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "paymentIntentId" TEXT,
  ADD COLUMN "stripeRefundId" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "refundedAt" TIMESTAMPTZ(3);

UPDATE "Booking"
SET "status" = CASE
  WHEN "paymentStatus" = TRUE THEN 'CONFIRMED'::"BookingStatus"
  WHEN "checkoutSessionExpiresAt" > NOW() THEN 'PENDING'::"BookingStatus"
  ELSE 'EXPIRED'::"BookingStatus"
END,
"expiresAt" = "checkoutSessionExpiresAt";

ALTER TABLE "Booking"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'PENDING';
```

unique indexと`cancelledBy` enum追加後、アプリをstatus読み取りへ切り替え、Booleanとの二重書き期間を経て`paymentStatus`と`checkoutSessionExpiresAt`を削除する。trueは全件CONFIRMED、falseは有効期限が未来の行だけPENDING、それ以外はEXPIREDとするため、古い未払い行が在庫を永久に塞がない。

## 3. holdとexpiry

- Checkout開始前の作成transactionで、`CONFIRMED`または`PENDING AND expiresAt > now`と期間重複するBookingを競合とする。
- Session作成後にStripeの`expires_at`を`expiresAt`へ保存する。Session未作成の短時間窓には、Booking作成時点で15分後の仮expiryを設定する。
- 読み取りと予約作成の冒頭で期限切れPENDINGを`updateMany(... status: EXPIRED)`するlazy cleanupをv1とする。日次jobは監視・清掃用のv2であり、正しさの前提にしない。
- DBのpartial exclusion constraintへ`NOW()`依存を直接入れず、既存のSerializable transactionと同じoverlap述語を維持する。将来constraintを追加する場合はcleanupでPENDINGをEXPIREDへ確実に遷移させる。

## 4. 返金

Checkout Sessionの支払い成功後は`payment_intent`参照を持つため、completed/async success処理でBookingへ保存する。[Stripe Checkout Session](https://docs.stripe.com/api/checkout/sessions) 返金はPaymentIntentを指定して作成できる。[Stripe refunds](https://docs.stripe.com/api/refunds/create)

`cancelBookingAction`の処理順:

1. 認証ユーザーがゲスト本人または物件所有者で、現在状態がCONFIRMEDであることをtransaction内で確認する。
2. 返金対象なら`updateMany({ status: CONFIRMED }, { status: REFUND_PENDING, cancelledBy, cancelledAt })`で単一実行者を確定する。
3. `stripe.refunds.create({ payment_intent: paymentIntentId, reason: "requested_by_customer", metadata: { bookingId } }, { idempotencyKey: "booking-refund-<bookingId>" })`を呼ぶ。
4. succeededならREFUNDED、pending/requires_actionならREFUND_PENDINGを維持する。API失敗時もREFUND_PENDINGのまま安全に再試行する。
5. `refund.updated`または`charge.refunded` webhookで最終状態を同期する。

ポリシーは「ゲストはcheck-in 48時間以上前なら全額、48時間未満は返金なし。ホスト取消は常に全額」。部分返金はv1対象外とする。

## 5. 改修範囲とUI

| 箇所 | 書き換え方針 |
|---|---|
| Prisma Booking | enum・expiry・PaymentIntent・refund/cancel fieldsを追加 |
| `createBookingAction` | cleanupとPENDING/CONFIRMED overlap判定 |
| bookings/reservations/rentals/stats/charts fetcher | `paymentStatus: true`を`status: CONFIRMED`基準へ変更 |
| payment route | CONFIRMED拒否、Session expiryを保存 |
| webhook/confirm | conditional status遷移とPaymentIntent保存 |
| deleteBookingAction | hard deleteを廃止しcancel actionへ置換 |
| booking overlap/API/action tests | 状態遷移とexpiry境界へ更新 |
| bookings/reservations UI | status badge、許可時だけcancel button、返金状態表示 |

`paymentStatus`の全消費箇所は、`createBookingAction`、`fetchBookings`、`fetchRentals`、`fetchReservations`、`fetchStats`、`fetchChartsData`、`fetchReservationStats`、payment/confirm/webhookの3 Route Handler、およびactions・bookingOverlap・各Route Handlerのテストである。すべて上表のstatus条件へ置換する。

blast radiusはschema 1、server actions 1、API route 3、一覧UI 2、関連test 5ファイル以上。管理集計値はCONFIRMEDのみを売上・宿泊数へ含める。

## 本実装の3分割

1. **M — enum migration**: additive schema、バックフィル、二重読み書き、全fetcher/APIのstatus化、旧Boolean削除。
2. **M — hold/expiry**: 仮expiry、Stripe expiry同期、lazy cleanup、overlapテスト、期限表示。
3. **L — cancel/refund**: PaymentIntent保存、cancel認可、Stripe idempotent refund、webhook同期、UI。

本スパイクではmigrationやStripe API呼び出しを行っていない。返金挙動は公式API仕様に基づく設計であり、3番目の実装プランでStripe test modeの統合確認を行う。
