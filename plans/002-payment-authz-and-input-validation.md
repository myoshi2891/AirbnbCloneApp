# Plan 002: 決済 API の所有者チェックと予約入力バリデーションを追加する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- app/api/payment/route.ts utils/actions.ts utils/schemas.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: security
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

3件の認可/バリデーション欠落をまとめて塞ぐ:

1. **IDOR（決済）**: `/api/payment` はリクエストボディの `bookingId` を無条件に検索し、他人の予約に対しても Stripe Checkout セッションを作成できる（予約の物件名・画像・金額が漏れる）。
2. **予約入力の未検証**: `createBookingAction` は `checkIn`/`checkOut`/`propertyId` を Zod 検証なしで信頼する。日付計算は `Math.abs` を使うため `checkOut < checkIn` や過去日でも正の宿泊数が算出され、予約行が作成される。
3. **IDOR（お気に入り）**: `toggleFavoriteAction` は `favoriteId` を所有者フィルタなしで delete するため、他人のお気に入りIDを渡せば削除できる。

## Current state

- `app/api/payment/route.ts:7-23` — `POST` ハンドラ。`auth()` 呼び出しが**存在しない**（import もない）。ミドルウェアでログインは強制されるが、所有者ゲートはない:

```ts
export const POST = async (req: NextRequest) => {
    const requestHeaders = new Headers(req.headers);
    const origin = requestHeaders.get("origin");
    const { bookingId } = await req.json();
    const booking = await db.booking.findUnique({
        where: {
            id: bookingId,
        },
        ...
```

- `utils/actions.ts:419-447` — `createBookingAction`。Zod なしで `prevState` の値を直接使用:

```ts
export const createBookingAction = async (prevState: {
    propertyId: string;
    checkIn: Date;
    checkOut: Date;
}) => {
    const user = await getAuthUser();
    ...
    const { propertyId, checkIn, checkOut } = prevState;
```

- `utils/calender.ts:81-93` — `caluculateDaysBetween` は `Math.abs(checkOut.getTime() - checkIn.getTime())` を使うため逆転日付でも正値。
- `utils/actions.ts:231-237` — `toggleFavoriteAction` の削除分岐は `id` のみで削除:

```ts
if (favoriteId) {
    await db.favorite.delete({
        where: {
            id: favoriteId,
        },
    });
```

- 対照的に正しい例（このリポジトリの規約）: `deleteReviewAction`（`utils/actions.ts:374-379`）は `where: { id: reviewId, profileId: user.id }` で所有者を複合条件に含めている。**このパターンに合わせる。**
- バリデーションの規約: `utils/schemas.ts` の `validateWithZodSchema(schema, data)` がスキーマ検証の唯一の入口。失敗時はメッセージ連結の `Error` を throw し、アクションの catch → `renderError` が拾う。`createReviewSchema`（`utils/schemas.ts:94-98`）が既存の手本。
- Clerk の userId 取得: サーバーアクションは `getAuthUser()`（`utils/actions.ts:18-25`）、API Route は `await auth()`（`@clerk/nextjs/server`、Next 15 なので async）。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0              |
| Tests     | `bun run test:run`   | all pass            |
| Lint      | `bun run lint`       | exit 0              |

## Scope

**In scope**:
- `app/api/payment/route.ts`
- `utils/actions.ts`（`createBookingAction` と `toggleFavoriteAction` のみ）
- `utils/schemas.ts`（`createBookingSchema` 追加）
- `app/api/__tests__/payment.test.ts`（テスト追加）
- `utils/__tests__/schemas.test.ts`（テスト追加）

**Out of scope**:
- `app/api/confirm/route.ts` — webhook 化は Plan 003。
- 重複予約チェック — Plan 004。
- `components/booking/**` — クライアント側は変更不要（正しい入力は通る）。

## Git workflow

- Branch: `advisor/002-payment-authz`
- Commit 形式: conventional commits（例: `fix(payment): require booking ownership for checkout session`）

## Steps

### Step 1: `/api/payment` に所有者チェックを追加

`app/api/payment/route.ts` で `auth` を import し（`import { auth } from "@clerk/nextjs/server";`）、ハンドラ冒頭で:

```ts
const { userId } = await auth();
if (!userId) {
    return Response.json(null, { status: 401, statusText: "Unauthorized" });
}
```

`findUnique` の where を `{ id: bookingId, profileId: userId }` に変更（`findUnique` は複合条件不可のため `findFirst` に変える）。所有していない場合は既存の 404 分岐に落ちる。

**Verify**: `bun run typecheck` → exit 0

### Step 2: `createBookingSchema` を追加

`utils/schemas.ts` に追加（`createReviewSchema` の直後）:

```ts
export const createBookingSchema = z
    .object({
        propertyId: z.string().uuid(),
        checkIn: z.coerce.date(),
        checkOut: z.coerce.date(),
    })
    .refine((data) => data.checkOut > data.checkIn, {
        message: "checkOut must be after checkIn",
    });
```

**Verify**: `bun run typecheck` → exit 0

### Step 3: `createBookingAction` で検証を通す

`utils/actions.ts` の `createBookingAction` 冒頭（`deleteMany` の前）で:

```ts
const validated = validateWithZodSchema(createBookingSchema, prevState);
```

以降 `propertyId`/`checkIn`/`checkOut` は `validated` から取る。検証失敗の throw を拾うため、`deleteMany` から `findUnique` までを既存の try ブロックに含める形に整える（`redirect` は try の外に置く — redirect は throw で実装されているため catch に飲まれてはならない。この規約は同ファイルの `createPropertyAction:147-172` を参照）。

**Verify**: `bun run typecheck` → exit 0

### Step 4: `toggleFavoriteAction` の削除に所有者条件を追加

削除分岐を `deleteMany` に変更（`delete` は複合 unique を要求するため）:

```ts
await db.favorite.deleteMany({
    where: { id: favoriteId, profileId: user.id },
});
```

**Verify**: `bun run typecheck` → exit 0

### Step 5: テスト追加

- `app/api/__tests__/payment.test.ts`: 既存の `vi.hoisted()` + `StripeMock` クラス規約に従い、(a) 未認証 → 401、(b) 他人の booking（`findFirst` が null）→ 404 のケースを追加。Clerk の `auth` は `vi.mock("@clerk/nextjs/server", ...)` でモック。
- `utils/__tests__/schemas.test.ts`: `createBookingSchema` の正常系（未来の checkIn < checkOut）と異常系（逆転日付が reject される）を AAA パターンで追加。

**Verify**: `bun run test:run` → 全パス、新規テストを含む

## Test plan

- 401（未認証）/ 404（非所有）— `payment.test.ts` に追加、既存テストを手本にする
- `createBookingSchema`: 逆転日付 reject / 正常系 pass — `schemas.test.ts`
- 既存 38 テストの回帰なし

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test:run` すべて exit 0
- [ ] `app/api/payment/route.ts` に `await auth()` と `profileId` フィルタが存在する
- [ ] `grep -n "createBookingSchema" utils/schemas.ts utils/actions.ts` が両ファイルでヒット
- [ ] `grep -A3 "favorite.deleteMany" utils/actions.ts` に `profileId` が含まれる
- [ ] in-scope 外のファイル変更なし（`git status`）

## STOP conditions

- 既存の payment テストが Step 1 の変更で 3 回以上失敗し、モック調整で解決しない場合。
- `createBookingAction` の呼び出し元（`components/booking/ConfirmBooking.tsx`）が Date ではなく別の型を渡していると判明した場合（`z.coerce.date()` で吸収できないケース）。
- `propertyId` が UUID でない既存データが前提になっている場合（`z.string().uuid()` を `z.string().min(1)` に緩めて続行してよいが、報告すること）。

## Maintenance notes

- Plan 004（重複予約防止）はこのプランの検証済み入力を前提にする。
- レビュアーは「redirect が try/catch に飲まれていないか」を重点確認すること（Next.js の `redirect()` は例外で実装されている）。
- 将来 Booking の状態管理を enum 化する場合（Plan 014）、このスキーマが入口になる。
