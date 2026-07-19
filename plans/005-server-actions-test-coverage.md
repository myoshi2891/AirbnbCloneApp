# Plan 005: サーバーアクションと金額パスのテストカバレッジを確立する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- utils/actions.ts app/api/__tests__/ utils/__tests__/`
> Plan 002/003/004 由来の差分は想定内。抜粋と実コードの対応を確認してから進むこと。

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: tests
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

全ビジネスロジックが集約された `utils/actions.ts`（727行、予約作成・お気に入り・レビュー・物件 CRUD・認可ガード）に**テストが1件もない**。既存38テストは純関数ユーティリティと API Route の薄い層のみ。特に:

- 認可の唯一のチョークポイント `getAuthUser` / `getAdminUser` が無防備（壊れると管理データ露出）。
- 課金額 `unit_amount: orderTotal * 100`（`app/api/payment/route.ts:55`）— アプリ内で最も重要な数値 — に対するアサーションがゼロ。`* 100` を落とすバグが CI を通過する。
- このモジュールは高チャーンであり、Plan 006（エラーハンドリング統一）等のリファクタが控えている。特性テスト（characterization tests）を先に敷かないと、リファクタは盲目で出荷される。

## Current state

- テスト構成: `utils/__tests__/`（calculateTotals, calender, countries, format, schemas）+ `app/api/__tests__/`（payment, confirm）。`utils/actions.ts` への参照はゼロ。
- モック規約（このリポジトリの手本 — 必ず踏襲）: `app/api/__tests__/payment.test.ts` — `vi.hoisted()` でモック変数をホイストし、`vi.mock()` ファクトリ内で使用。Stripe は `class StripeMock { checkout = { sessions: { create: mockCreate } } }` 形式。
- 認可ガード（`utils/actions.ts:18-31`）:

```ts
const getAuthUser = async () => {
    const user = await currentUser();
    if (!user) {
        throw new Error("You must be logged in to access this route...");
    }
    if (!user.privateMetadata.hasProfile) redirect("/profile/create");
    return user;
};

const getAdminUser = async () => {
    const user = await getAuthUser();
    if (user.id !== process.env.ADMIN_USER_ID) redirect("/");
    return user;
};
```

  注意: 両者は **export されていない**。テストは export されたアクション経由で間接的に検証する（例: `fetchStats` は `getAdminUser` を通る）。ガード自体を直接テストしたい場合は export の追加が必要（Step 1 参照）。
- Clerk のモック対象: `currentUser`, `auth`, `clerkClient`（すべて `@clerk/nextjs/server` から import されている）。
- `redirect` は `next/navigation` から。テストでは `vi.mock("next/navigation")` で throw するモックにするのが定石（Next の実装も throw）。
- `revalidatePath` は `next/cache` から。no-op モックにする。

## Commands you will need

| Purpose   | Command                                        | Expected on success |
|-----------|------------------------------------------------|---------------------|
| Tests     | `bun run test:run`                             | all pass            |
| Single    | `bun run test:run utils/__tests__/actions.test.ts` | new tests pass |
| Typecheck | `bun run typecheck`                            | exit 0              |

## Scope

**In scope**:
- `utils/__tests__/actions.test.ts`（新規作成 — 本プランの主産物）
- `app/api/__tests__/payment.test.ts`（`unit_amount` アサーション追加）
- `utils/actions.ts` — **テスト容易性のための最小変更のみ許可**: `getAuthUser`/`getAdminUser` の `export` 追加。ロジック変更は禁止。

**Out of scope**:
- `utils/actions.ts` のロジック・構造変更（Plan 006 の領分）
- 実 DB を使う統合テスト基盤（将来課題として Maintenance notes に記載）
- E2E テスト

## Git workflow

- Branch: `advisor/005-actions-tests`
- Commit 形式: conventional commits（例: `test(actions): add characterization tests for booking actions`）。既存例: `test: add baseline unit tests for utility functions`

## Steps

### Step 1: テストハーネスの土台を作る

`utils/__tests__/actions.test.ts` を作成。ファイル冒頭で依存を全てモック:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockCurrentUser, mockRedirect, mockRevalidatePath } = vi.hoisted(() => ({
    mockDb: {
        booking: { create: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn() },
        property: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
        favorite: { create: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() },
        review: { create: vi.fn(), delete: vi.fn() },
        profile: { count: vi.fn() },
        $transaction: vi.fn(),
    },
    mockCurrentUser: vi.fn(),
    mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
    mockRevalidatePath: vi.fn(),
}));

vi.mock("@/utils/db", () => ({ default: mockDb }));
vi.mock("@clerk/nextjs/server", () => ({
    currentUser: mockCurrentUser,
    auth: vi.fn(),
    clerkClient: { users: { updateUserMetadata: vi.fn() } },
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
```

認証済みユーザーのフィクスチャ: `{ id: "user_test_123", privateMetadata: { hasProfile: true }, emailAddresses: [{ emailAddress: "test@example.com" }], imageUrl: "" }`（ダミー値のみ使用）。

**Verify**: `bun run test:run utils/__tests__/actions.test.ts` → ハーネスだけの空 describe でパス

### Step 2: 認可ガードのテスト

`utils/actions.ts` で `getAuthUser`/`getAdminUser` を `export` に変更（ロジック変更なし）。テストケース:

- 未ログイン（`currentUser` → null）: `getAuthUser` が "must be logged in" を含む Error を throw
- プロフィール未作成（`hasProfile` falsy）: `/profile/create` へ redirect（`REDIRECT:` throw をアサート）
- `getAdminUser`: `vi.stubEnv("ADMIN_USER_ID", "user_admin_test")` を使い、不一致ユーザーが `/` へ redirect、一致ユーザーが user を返す

**Verify**: `bun run test:run utils/__tests__/actions.test.ts` → パス

### Step 3: 予約系アクションの特性テスト

`createBookingAction`（Plan 002/004 適用後の姿に合わせる — 適用前ならその時点の動作を固定）:

- 正常系: `calculateTotals` の実関数（モック不要 — 純関数）による `orderTotal`/`totalNights` が `booking.create` の data に渡ること、成功時に `/checkout/?bookingId=...` へ redirect すること
- 物件不在（`findUnique`/transaction が null 相当）: `{ message: "Property not found..." }` が返ること
- 未払い予約の削除: `deleteMany` が `{ profileId, paymentStatus: false }` で呼ばれること

`deleteBookingAction`: `delete` の where に `profileId` が含まれること（所有者スコープの回帰防止）。

**Verify**: `bun run test:run utils/__tests__/actions.test.ts` → パス

### Step 4: お気に入り・レビューのテスト

- `toggleFavoriteAction`: favoriteId あり → 削除パス / なし → `create` が `{ propertyId, profileId }` で呼ばれる。戻り message の分岐も確認
- `createReviewAction`: 検証済みフィールド + `profileId` で `review.create`、`revalidatePath` が `/properties/<id>` で呼ばれる
- `deleteReviewAction`: where に `profileId` が含まれる

**Verify**: `bun run test:run utils/__tests__/actions.test.ts` → パス

### Step 5: 課金額のアサーションを追加

`app/api/__tests__/payment.test.ts` の既存正常系テストに追加:

```ts
const createArg = mockCreate.mock.calls[0][0];
expect(createArg.line_items[0].price_data.unit_amount).toBe(booking.orderTotal * 100);
```

（変数名は既存テストのフィクスチャに合わせること。）

**Verify**: `bun run test:run app/api/__tests__/payment.test.ts` → パス

## Test plan

Step 2〜5 のケース一覧が本体。全テスト AAA パターン、正常系と異常系の両方を含む。構造の手本: `app/api/__tests__/payment.test.ts`。

## Done criteria

- [ ] `bun run test:run` exits 0、テスト総数が 55 件以上（38 + 新規 17+）
- [ ] `utils/__tests__/actions.test.ts` が存在し、booking / favorite / review / ガードをカバー
- [ ] `payment.test.ts` に `unit_amount` のアサーションが存在（`grep -n "unit_amount" app/api/__tests__/payment.test.ts`）
- [ ] `utils/actions.ts` の diff が `export` キーワード追加のみ（`git diff utils/actions.ts` を目視）
- [ ] `bun run typecheck` exits 0

## STOP conditions

- `"use server"` ファイルのテスト import で Vitest が失敗し、`vitest.config` 側の調整が必要になった場合（設定変更は最小にとどめ、変更内容を報告）。
- モックの都合で `utils/actions.ts` に export 追加以上の変更が必要と判明した場合。
- 既存38テストのいずれかが本プランの変更で壊れた場合。

## Maintenance notes

- ここで固定した特性テストが Plan 006（エラーハンドリング統一リファクタ）の安全網。**Plan 006 は本プラン完了後に着手すること。**
- モック DB は実クエリの正しさを保証しない。将来的には testcontainers 等で Postgres 統合テストを1層足すのが理想（今回は範囲外と判断 — 費用対効果とCI複雑性のトレードオフ）。
- レビュアーの重点: テストが実装の鏡写し（モック呼び出し形状の再記述）だけになっていないか。少なくとも金額・所有者スコープ・redirect 先は「意味のある」アサーション。
