# Plan 011: サーバーアクションのボイラープレート統合とデッド設定の掃除

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- utils/actions.ts next.config.mjs Dockerfile.dev`
> Plan 002/004/006 による utils/actions.ts の差分は想定内。着手前に
> `ls utils/__tests__/actions.test.ts` で特性テスト（Plan 005）の存在を確認（なければ STOP）。

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/005-server-actions-test-coverage.md, plans/006-error-handling-hardening.md
- **Category**: tech-debt
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

`utils/actions.ts` では「`getAuthUser()` → try { validate/db → revalidatePath → return {message} } catch { return renderError(error) }」という同一形状が**約13回**手書きコピーされている。エラー契約の変更（Plan 006 のような）は毎回13箇所の目視を要する。また `next.config.mjs` と `Dockerfile.dev` に説明なしのコメントアウト済み設定ブロックが残り、「React strict mode は有効なのか」「Dockerfile.dev は単体で動くのか」を読む者に誤解させる。

## Current state

- 反復パターンの代表例（`utils/actions.ts:98-119` `updateProfileAction`）:

```ts
export const updateProfileAction = async (
    prevState: any,
    formData: FormData
): Promise<{ message: string }> => {
    const user = await getAuthUser();
    try {
        const rawData = Object.fromEntries(formData);
        const validatedFields = validateWithZodSchema(profileSchema, rawData);
        await db.profile.update({ where: { clerkId: user.id }, data: validatedFields });
        revalidatePath("/profile");
        return { message: "Profile updated successfully!" };
    } catch (error) {
        return renderError(error);
    }
};
```

  同型: `updateProfileImageAction`, `createPropertyAction`, `createReviewAction`, `deleteReviewAction`, `deleteBookingAction`, `deleteRentalAction`, `updatePropertyAction`, `updatePropertyImageAction`, `toggleFavoriteAction` ほか。
- **重要な例外パターン（壊すと事故る）**: `createProfileAction`（39-68行）、`createPropertyAction`（147-172行）、`createBookingAction`（419-466行）は **`redirect()` を try/catch の外**で呼ぶ。Next.js の `redirect` は例外で実装されているため、catch に入ると握りつぶされる。ヘルパー設計は return 型とこの3つの redirect 型を区別する必要がある。
- `prevState: any` が複数のアクションに残っている（リポジトリ規約は `any` 禁止）。
- `next.config.mjs:15-25` — コメントアウトされた `webpackDevMiddleware` / `reactStrictMode: true` / `env` ブロック。strict mode は現在**無効**（既定値）。
- `Dockerfile.dev:20-26` — `npm run build` と `CMD` がコメントアウトされ、実行コマンドは `compose.yaml` の `command:` が供給する構成（コメントからは読み取れない）。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0              |
| Tests     | `bun run test:run`   | all pass            |
| Lint      | `bun run lint`       | exit 0              |

## Scope

**In scope**:
- `utils/actions.ts`（ヘルパー導入 + 段階的移行 + `any` 撲滅）
- `next.config.mjs`（デッドブロック削除）
- `Dockerfile.dev`（コメント整理 + compose 前提の明記コメント）

**Out of scope**:
- `renderError` の挙動変更（Plan 006 で確定済み — その契約を変えない）
- アクションの分割・ファイル移動（`utils/actions.ts` 集中は CLAUDE.md 記載の設計判断）
- `reactStrictMode: true` の**有効化** — 挙動変更（開発時二重レンダリング）であり本プランでは行わない。Maintenance notes に判断材料を記載

## Git workflow

- Branch: `advisor/011-actions-boilerplate`
- Commit は「ヘルパー導入」「アクション移行（数個ずつ）」「デッド設定削除」を分ける。

## Steps

### Step 1: ヘルパーを導入

`utils/actions.ts` 冒頭（`renderError` の後）に追加:

```ts
type ActionResult = { message: string };

/** 認証必須アクションの共通ラッパー（return 型）。redirect するアクションには使わない。 */
const authedAction = async (
    fn: (user: Awaited<ReturnType<typeof getAuthUser>>) => Promise<ActionResult>
): Promise<ActionResult> => {
    const user = await getAuthUser();
    try {
        return await fn(user);
    } catch (error) {
        return renderError(error);
    }
};
```

**Verify**: `bun run typecheck` → exit 0

### Step 2: return 型アクションを段階移行

`updateProfileAction` から着手し、1コミットあたり3〜4アクションずつ `authedAction` へ移行:

```ts
export const updateProfileAction = async (
    prevState: unknown,
    formData: FormData
): Promise<{ message: string }> =>
    authedAction(async (user) => {
        const rawData = Object.fromEntries(formData);
        const validatedFields = validateWithZodSchema(profileSchema, rawData);
        await db.profile.update({ where: { clerkId: user.id }, data: validatedFields });
        revalidatePath("/profile");
        return { message: "Profile updated successfully!" };
    });
```

移行と同時に `prevState: any` → `unknown`（または実際の形の型）へ変更。**redirect 型**（`createPropertyAction`, `createBookingAction`, `createProfileAction`）は `authedAction` に**移行しない** — 現状の「redirect は try の外」構造を保つ。

各バッチ後に Plan 005 の特性テストがパスすることを確認 — これがこのリファクタの安全網。

**Verify**: 各バッチ後 `bun run test:run` → 全パス

### Step 3: デッド設定の削除

- `next.config.mjs`: 15-25行のコメントブロックを削除。strict mode が無効のままである事実は変えない（有効化するなら別判断 — Maintenance notes 参照）。
- `Dockerfile.dev`: コメントアウトされた build/CMD 行を削除し、先頭に1行コメント「開発用イメージ。実行コマンドは compose.yaml の command が供給する」を追加。

**Verify**: `bun run build` → exit 0（next.config が壊れていないこと）、`docker compose config` → exit 0（compose 構文確認のみ。ビルドは不要）

## Test plan

新規テストなし。Plan 005 の特性テスト（booking/favorite/review/ガード）+ 既存38テストが挙動不変の証明。**移行前後で `bun run test:run` の結果が同一であること**が本プランの成功条件そのもの。

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test:run` すべて exit 0
- [ ] `grep -c "return renderError(error)" utils/actions.ts` が 4 以下（redirect 型 + 特殊形のみ残存）
- [ ] `grep -n "prevState: any" utils/actions.ts` が 0 件
- [ ] `next.config.mjs` にコメントアウト済み設定ブロックがない
- [ ] redirect 型3アクションの `redirect()` が try/catch の外にあることを目視確認

## STOP conditions

- 特性テスト（Plan 005）が未整備。
- `authedAction` 移行でテストが落ち、その原因が「redirect が catch に飲まれた」である場合 — そのアクションは redirect 型。移行対象から外して報告。
- `useFormState`/`useActionState` 連携の都合で `prevState` の型変更がクライアントコンポーネント側に波及し、3ファイル以上の修正が必要な場合。

## Maintenance notes

- **strict mode 判断材料**: 有効化は React 18/19 移行の品質検査として価値があるが、開発時の副作用二重実行で既存コードの隠れバグが露見する可能性がある。React 19 アップグレード（Plan 010 Step 4）の前提作業として別途小プラン化を推奨。
- 新規アクションを書くときは `authedAction`（return 型）か「redirect は try の外」（redirect 型)のどちらかに従うこと — 第三の形を増やさない。
- レビュアーの重点: 各アクションの `revalidatePath` 引数と成功メッセージが移行前後で一字一句同じか。
