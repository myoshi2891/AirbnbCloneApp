# Plan 004: 重複予約（ダブルブッキング）をサーバー側で防止する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- utils/actions.ts prisma/schema.prisma`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
> 注意: Plan 002 が先に `createBookingAction` に Zod 検証を入れているはずなので、
> その差分は想定内のドリフト。抜粋との差が Plan 002 由来かを確認して進むこと。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-payment-authz-and-input-validation.md
- **Category**: security
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

物件の在庫（日程）の一意性はこのアプリの中核不変条件だが、現在サーバー側の重複チェックが**一切ない**。日付のブロックはクライアントのカレンダー UI（`utils/calender.ts` の `generateBlockedPeriods` / `generateDisabledDates`）だけで行われており、サーバーアクションを直接呼べば同一物件・同一期間に何件でも予約を作成できる。正直なクライアント同士でも、同時操作すれば check-then-act の競合で両方成立する。

## Current state

- `utils/actions.ts:419-466` — `createBookingAction`。物件の存在確認 → `calculateTotals` → `booking.create` のみで、既存予約との期間重複チェックなし。トランザクションなし。
- `prisma/schema.prisma:73-86` — `Booking` は `checkIn DateTime` / `checkOut DateTime` / `paymentStatus Boolean` を持つ。期間の排他制約なし。
- クライアント側ブロック: `components/booking/BookingContainer.tsx` がカレンダー UI で既存予約日を無効化しているのみ。
- 予約詳細ページは `fetchPropertyDetails`（`utils/actions.ts:281-298`）で全予約の `checkIn`/`checkOut` を取得しカレンダーへ渡している — つまり paid/unpaid 両方がクライアント上はブロック扱い。
- 未払い予約の扱い: `createBookingAction` は冒頭で**そのユーザーの**未払い予約を全削除する（`utils/actions.ts:425-430`）。他ユーザーの未払い予約は残る。

## Design decision (実装前に読むこと)

重複判定は「**支払済み（`paymentStatus: true`）の予約とだけ衝突を禁止する**」を採用する。理由: 未払い予約は放棄されたチェックアウトの残骸である可能性が高く、これを在庫ホールドとして扱うと放棄カートが日程を塞ぐ。現在のコードも未払いを掃除する設計（上記 deleteMany）であり、その方針と一貫する。ただしこの選択の帰結として「支払い完了までの数分間に別ユーザーが同じ日程で支払いを完了する」隙間が残る — これは Plan 014（予約ライフサイクル/expiry 付きホールド）で解消する将来課題として許容する。

期間重複の条件（半開区間 `[checkIn, checkOut)`）: 既存予約と重複 ⇔ `existing.checkIn < new.checkOut AND existing.checkOut > new.checkIn`。チェックアウト日 = 次のチェックイン日は重複ではない。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0              |
| Tests     | `bun run test:run`   | all pass            |
| Lint      | `bun run lint`       | exit 0              |

## Scope

**In scope**:
- `utils/actions.ts`（`createBookingAction` のみ）
- `utils/__tests__/` 配下に新規テストファイル（例: `bookingOverlap.test.ts`）— 重複判定ロジックを純関数に切り出す場合はそのファイルも（推奨: `utils/bookingOverlap.ts` 新規）

**Out of scope**:
- `prisma/schema.prisma` — Postgres の EXCLUDE 制約（btree_gist + daterange）が理想の最終形だが、Prisma はネイティブ非対応で raw migration が必要。本プランではアプリ層チェック + トランザクションまでとし、DB 制約は Maintenance notes の将来項目とする。
- クライアントのカレンダー UI — 変更不要。
- webhook（Plan 003）・返金（Plan 014）。

## Git workflow

- Branch: `advisor/004-prevent-double-booking`
- Commit 形式: conventional commits（例: `fix(booking): reject overlapping bookings server-side`）

## Steps

### Step 1: 重複判定を含むトランザクションに変更

`createBookingAction` 内の「物件取得 → 作成」を `db.$transaction` の **interactive transaction**（コールバック形式）に置き換える:

```ts
const booking = await db.$transaction(async (tx) => {
    const conflict = await tx.booking.findFirst({
        where: {
            propertyId,
            paymentStatus: true,
            checkIn: { lt: checkOut },
            checkOut: { gt: checkIn },
        },
        select: { id: true },
    });
    if (conflict) {
        throw new Error("Selected dates are no longer available");
    }
    return tx.booking.create({
        data: { checkIn, checkOut, propertyId, profileId: user.id, orderTotal, totalNights },
    });
});
```

throw は既存の catch → `renderError` に拾わせ、ユーザーには "Selected dates are no longer available" が表示される。`redirect` は従来どおり try/catch の外。

注意: interactive transaction は分離レベル既定（Read Committed）では並行挿入を完全には防げない。`db.$transaction(fn, { isolationLevel: "Serializable" })` を指定し、シリアライゼーション失敗（Prisma error code `P2034`）は catch 内で "Please try again" 系メッセージに変換する。

**Verify**: `bun run typecheck` → exit 0

### Step 2: テスト追加

`utils/__tests__/` に新規テスト。`db` を `vi.mock("@/utils/db")` でモックし（`app/api/__tests__/confirm.test.ts` のモックスタイルを手本に）:

- 重複あり（`findFirst` が行を返す）→ `create` が呼ばれず、`message` に "no longer available" を含む戻り値
- 重複なし → `create` が正しい data で呼ばれる
- 境界: `existing.checkOut === new.checkIn`（連続予約）は重複**ではない** — where 条件が `gt`/`lt`（`gte`/`lte` ではない）であることをアサート

**Verify**: `bun run test:run` → 全パス

## Test plan

上記3ケース + 既存テストの回帰なし。AAA パターン。モック規約は `vi.hoisted()`。

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test:run` すべて exit 0
- [ ] `grep -n '\$transaction' utils/actions.ts` が `createBookingAction` 内でヒット
- [ ] 重複条件が `checkIn: { lt: ... }` / `checkOut: { gt: ... }`（半開区間）である
- [ ] in-scope 外のファイル変更なし

## STOP conditions

- Plan 002 が未実施（`createBookingSchema` が存在しない）— 依存順序違反。停止して報告。
- Prisma のバージョン都合で `isolationLevel: "Serializable"` が型エラーになる場合（client 6.6.0 では利用可能なはず。エラーなら報告）。
- `fetchPropertyDetails` 側の予約取得が paid のみに変わっているなど、クライアントブロックの前提が変わっていた場合。

## Maintenance notes

- **将来の強化（別プラン推奨）**: Postgres の `EXCLUDE USING gist (propertyId WITH =, daterange(checkIn, checkOut) WITH &&)` 制約を raw migration で追加すれば DB レベルで不変条件が保証される。Prisma migrate の `--create-only` で SQL を手書きする。
- Plan 014 で未払いホールド（expiry 付き）を導入する場合、Step 1 の `paymentStatus: true` フィルタを status enum ベースに書き換えること。
- レビュアーの重点: トランザクション内で throw した場合にロールバックされること、`redirect` が catch に飲まれないこと。
