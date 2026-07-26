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

既存の支払い済み予約には`paymentIntentId`がないため、schema変更より先に返金経路を確定する。`paymentStatus = true`の各Bookingについて、既存`checkoutSessionId`を使ってStripeのCheckout Sessionを取得し、`payment_status = paid`、`metadata.bookingId`が対象Bookingと一致することを検証して`payment_intent`を復元する。復元できたIDはexpand migration後の`paymentIntentId`へバックフィルする。Session ID欠損、Stripe上で取得不能、metadata不一致、またはPaymentIntent欠損の行は、業務上の明示状態`LEGACY_REFUND_UNAVAILABLE`（DB上は`status = CONFIRMED AND paymentIntentId IS NULL`）として移行レポートへBooking IDと理由だけを記録する。この行は手動調査の対象とし、自動返金を試行しない。

Bookingへ`status BookingStatus @default(PENDING)`、`expiresAt DateTime? @db.Timestamptz(3)`、`paymentIntentId String? @unique`、`stripeRefundId String? @unique`、`cancelledBy BookingCancelledBy?`、`cancelledAt DateTime?`、`refundedAt DateTime?`を追加する。既存`checkoutSessionExpiresAt`は`expiresAt`へ統合する。`cancelBookingAction`は返金対象のCONFIRMED予約について`paymentIntentId IS NOT NULL`を同じtransaction内で必須条件とし、未設定なら`LEGACY_REFUND_UNAVAILABLE`エラーで停止する。`paymentIntentId`未設定のままREFUND_PENDINGへ遷移させてはならない。

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

終端状態は`CANCELLED`、`REFUNDED`、`EXPIRED`。終端状態からのユーザー操作による遷移は拒否する。`checkout.session.async_payment_failed`は即時の新状態を増やさず、Session expiryまでPENDINGとして扱う。`LEGACY_REFUND_UNAVAILABLE`はBookingStatusの追加値ではなく、既存CONFIRMED予約の移行時だけ使う返金可否分類である。

## 2. migrationと既存データ

適用順はexpand → データバックフィル → unique制約 → アプリ切替 → contractとし、各段階を別コミットまたは別デプロイ境界にする。

### 2.1 expand

まずenumとnullable列だけを追加する。

```sql
CREATE TYPE "BookingStatus" AS ENUM (
  'PENDING', 'CONFIRMED', 'CANCELLED',
  'REFUND_PENDING', 'REFUNDED', 'EXPIRED'
);

CREATE TYPE "BookingCancelledBy" AS ENUM (
  'GUEST', 'HOST', 'SYSTEM'
);

ALTER TABLE "Booking"
  ADD COLUMN "status" "BookingStatus",
  ADD COLUMN "expiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "paymentIntentId" TEXT,
  ADD COLUMN "stripeRefundId" TEXT,
  ADD COLUMN "cancelledBy" "BookingCancelledBy",
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "refundedAt" TIMESTAMPTZ(3);
```

### 2.2 データバックフィル

旧列から状態と期限を移し、続けて前述のStripe取得ジョブで支払い済み予約の`paymentIntentId`を更新する。ジョブはBooking IDで再開可能かつ冪等にし、PaymentIntent IDをログへ出力しない。

```sql
UPDATE "Booking"
SET "status" = CASE
  WHEN "paymentStatus" = TRUE THEN 'CONFIRMED'::"BookingStatus"
  WHEN "checkoutSessionExpiresAt" > NOW() THEN 'PENDING'::"BookingStatus"
  ELSE 'EXPIRED'::"BookingStatus"
END,
"expiresAt" = "checkoutSessionExpiresAt";
```

バックフィル完了条件は最初の2 queryが`0`を返すこと。3番目は復元不能行の件数であり、`0`でなければ全Booking IDと理由が移行レポートに存在し、`LEGACY_REFUND_UNAVAILABLE`として扱われることを確認する。

```sql
SELECT COUNT(*) FROM "Booking" WHERE "status" IS NULL;
SELECT COUNT(*) FROM "Booking"
WHERE "expiresAt" IS DISTINCT FROM "checkoutSessionExpiresAt";
SELECT COUNT(*) FROM "Booking"
WHERE "status" = 'CONFIRMED' AND "paymentIntentId" IS NULL;
```

### 2.3 制約追加とアプリ切替

重複がないことを確認してPrismaの`@unique`と同名のunique indexを追加し、statusを必須化する。

```sql
SELECT "paymentIntentId", COUNT(*)
FROM "Booking"
WHERE "paymentIntentId" IS NOT NULL
GROUP BY "paymentIntentId"
HAVING COUNT(*) > 1;

SELECT "stripeRefundId", COUNT(*)
FROM "Booking"
WHERE "stripeRefundId" IS NOT NULL
GROUP BY "stripeRefundId"
HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX "Booking_paymentIntentId_key"
  ON "Booking"("paymentIntentId");
CREATE UNIQUE INDEX "Booking_stripeRefundId_key"
  ON "Booking"("stripeRefundId");

ALTER TABLE "Booking"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'PENDING'::"BookingStatus";
```

この状態でアプリを新旧列の二重書きへ切り替え、status基準の読み取りを先にデプロイする。trueは全件CONFIRMED、falseは有効期限が未来の行だけPENDING、それ以外はEXPIREDとするため、古い未払い行が在庫を永久に塞がない。全消費箇所が新列へ移行し、Stripe成功処理が新規CONFIRMED予約へ必ず`paymentIntentId`を保存することを確認する。

### 2.4 contractと最終検証

旧列参照がコードと実行中プロセスからなくなった後にだけ旧列を削除する。

```sql
ALTER TABLE "Booking"
  DROP COLUMN "paymentStatus",
  DROP COLUMN "checkoutSessionExpiresAt";
```

最終検証では、次のqueryが1行を返し、すべて`true`であることを確認する。

```sql
SELECT
  enum_range(NULL::"BookingStatus")::text =
    '{PENDING,CONFIRMED,CANCELLED,REFUND_PENDING,REFUNDED,EXPIRED}'
    AS booking_status_matches,
  enum_range(NULL::"BookingCancelledBy")::text =
    '{GUEST,HOST,SYSTEM}' AS cancelled_by_enum_matches,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Booking' AND column_name = 'status'
      AND is_nullable = 'NO' AND column_default LIKE '%PENDING%'
  ) AS status_is_required,
  (
    SELECT COUNT(*) = 7 FROM information_schema.columns
    WHERE table_name = 'Booking'
      AND column_name IN (
        'expiresAt', 'paymentIntentId', 'stripeRefundId', 'cancelledBy',
        'cancelledAt', 'refundedAt', 'status'
      )
  ) AS expected_columns_exist,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'Booking'
      AND indexname = 'Booking_paymentIntentId_key'
  ) AS payment_intent_is_unique,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'Booking'
      AND indexname = 'Booking_stripeRefundId_key'
  ) AS refund_id_is_unique,
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Booking'
      AND column_name IN ('paymentStatus', 'checkoutSessionExpiresAt')
  ) AS legacy_columns_removed;
```

## 3. holdとexpiry

- Checkout開始前の作成transactionで、`CONFIRMED`または`PENDING AND expiresAt > now`と期間重複するBookingを競合とする。
- Session作成後にStripeの`expires_at`を`expiresAt`へ保存する。Session未作成の短時間窓には、Booking作成時点で15分後の仮expiryを設定する。
- 読み取りと予約作成の冒頭で期限切れPENDINGを`updateMany(... status: EXPIRED)`するlazy cleanupをv1とする。日次jobは監視・清掃用のv2であり、正しさの前提にしない。
- DBのpartial exclusion constraintへ`NOW()`依存を直接入れず、既存のSerializable transactionと同じoverlap述語を維持する。将来constraintを追加する場合はcleanupでPENDINGをEXPIREDへ確実に遷移させる。

## 4. 返金

Checkout Sessionの支払い成功後は`payment_intent`参照を持つため、completed/async success処理でBookingへ保存する。[Stripe Checkout Session](https://docs.stripe.com/api/checkout/sessions) 返金はPaymentIntentを指定して作成できる。[Stripe refunds](https://docs.stripe.com/api/refunds/create)

`cancelBookingAction`の処理順:

1. 認証ユーザーがゲスト本人または物件所有者で、現在状態がCONFIRMEDであることをtransaction内で確認する。
2. 返金対象なら`paymentIntentId`が存在することを確認し、`updateMany({ status: CONFIRMED, paymentIntentId: { not: null } }, { status: REFUND_PENDING, cancelledBy, cancelledAt })`で単一実行者を確定する。未設定なら状態を変えず`LEGACY_REFUND_UNAVAILABLE`を返す。
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
