# Plan 006: エラーハンドリングの統一と内部情報リークの遮断

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- utils/actions.ts utils/schemas.ts`
> Plan 002/004/005 由来の差分は想定内。特に Plan 005 の特性テストが存在することを
> `ls utils/__tests__/actions.test.ts` で確認してから着手すること（存在しなければ STOP）。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/005-server-actions-test-coverage.md
- **Category**: bug
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

1. **内部情報リーク**: `renderError`（`utils/actions.ts:32-37`）は `error.message` をそのまま UI に返す。Prisma の例外メッセージ（制約名・カラム名・モデル詳細）がエンドユーザーに表示される — 情報開示かつ混乱の元。
2. **クラッシュ**: `createProfileAction` は `user.emailAddresses[0].emailAddress`（`utils/actions.ts:52`）を無ガードで参照。メールを持たない Clerk 認証経路で TypeError になり、その生メッセージがユーザーに返る。
3. **3流派のエラー処理が混在**: (a) `renderError` 経由、(b) `createProfileAction` の独自 `console.error`、(c) API Route の ad-hoc `console.log` + NextResponse。可観測性・メッセージ一貫性が損なわれている。

## Current state

- `utils/actions.ts:32-37`:

```ts
const renderError = (error: unknown): { message: string } => {
    console.log(error);
    return {
        message: error instanceof Error ? error.message : "An error occurred",
    };
};
```

- バリデーションエラーの経路: `utils/schemas.ts:18-30` の `validateWithZodSchema` は Zod エラーを `new Error(errors.join(","))` に変換して throw する。つまり **`renderError` に届く時点で ZodError ではなく素の Error** になっており、「ユーザー向けメッセージ（バリデーション）」と「内部エラー（DB等）」を `instanceof` では区別できない。→ 区別可能にするにはカスタムエラークラスが必要（Step 1）。
- `utils/actions.ts:39-68` — `createProfileAction`: `currentUser()` を直接使い（`getAuthUser` 不使用は意図的 — プロフィール未作成ユーザーが対象のため）、`console.error("createProfileAction エラー発生！", error)` と独自ログ。
- `renderError` は 13 箇所の catch で使用。`getAuthUser` は 22 箇所。
- リポジトリ規約: エラーは握りつぶさない。コメントは日本語可。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0              |
| Tests     | `bun run test:run`   | all pass            |
| Lint      | `bun run lint`       | exit 0              |

## Scope

**In scope**:
- `utils/schemas.ts`（`ValidationError` クラス追加 + `validateWithZodSchema` の throw 型変更）
- `utils/actions.ts`（`renderError` の出し分け、`createProfileAction` のメールガード）
- `utils/__tests__/actions.test.ts` / `utils/__tests__/schemas.test.ts`（テスト更新・追加）

**Out of scope**:
- API Route（`app/api/**`）のエラー処理統一 — 現状の generic 500 は情報リークしていないため優先度低。Maintenance notes に記載。
- `renderError` 13箇所の catch ブロック自体の構造変更（DEBT-01 のボイラープレート統合は Plan 010）。
- ログ基盤の導入（structured logging）— 将来課題。

## Git workflow

- Branch: `advisor/006-error-handling`
- Commit 形式: conventional commits（例: `fix(actions): stop leaking internal error messages to clients`）

## Steps

### Step 1: `ValidationError` を導入

`utils/schemas.ts` に追加し、`validateWithZodSchema` の throw を差し替える:

```ts
export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
    }
}
```

`validateWithZodSchema` 内: `throw new Error(errors.join(","))` → `throw new ValidationError(errors.join(","))`。

**Verify**: `bun run typecheck` → exit 0、`bun run test:run utils/__tests__/schemas.test.ts` → パス（メッセージ内容は不変なので既存テストは通るはず）

### Step 2: `renderError` の出し分け

`utils/actions.ts` の `renderError` を変更:

```ts
const renderError = (error: unknown): { message: string } => {
    console.error(error);
    if (error instanceof ValidationError) {
        return { message: error.message };
    }
    return { message: "An unexpected error occurred. Please try again." };
};
```

注意: Plan 004 が導入した「日付が埋まっている」等の**意図的にユーザーへ見せるメッセージ**が素の `Error` で throw されている場合、この変更で汎用メッセージに化ける。該当箇所（`createBookingAction` 内の throw）を `ValidationError` に変更して意図を保つこと。`grep -n "throw new Error" utils/actions.ts` で全 throw を確認し、「ユーザーに見せるべきもの」だけ `ValidationError` 化する（`getAuthUser` の "must be logged in" はユーザー向けなので `ValidationError` にしてよい）。

**Verify**: `bun run test:run` → Plan 005 の特性テストのうちエラーメッセージをアサートしているものが期待通りか確認。仕様変更としてテスト側の期待値を更新した場合は、その旨をコミットメッセージに明記。

### Step 3: メール取得のガード

`utils/actions.ts:52` を変更:

```ts
const email = user.emailAddresses[0]?.emailAddress;
if (!email) {
    throw new ValidationError("Your account has no email address. Please add one and retry.");
}
```

あわせて `createProfileAction` の `console.error("createProfileAction エラー発生！", error)` は削除（Step 2 で `renderError` が `console.error` するため二重ログになる）。

**Verify**: `bun run typecheck` → exit 0

### Step 4: テスト追加

- `schemas.test.ts`: `validateWithZodSchema` の失敗が `ValidationError` インスタンスを throw すること
- `actions.test.ts`: (a) DB エラー（モックが Prisma 風エラーを reject）時に戻り message が汎用文言で、**元のエラーメッセージを含まない**こと、(b) バリデーション失敗時はその文言がそのまま返ること、(c) メールなしユーザーで createProfileAction が案内メッセージを返すこと

**Verify**: `bun run test:run` → 全パス

## Test plan

Step 4 の5ケース + 既存テストの回帰なし。「リークしないこと」のテストは `expect(result.message).not.toContain("prisma")` のような否定アサーションではなく、汎用文言との完全一致で書く。

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test:run` すべて exit 0
- [ ] `grep -n "ValidationError" utils/schemas.ts utils/actions.ts` が両方でヒット
- [ ] `renderError` が非 ValidationError に対して固定文言を返す（コード目視 + テスト）
- [ ] `grep -n "emailAddresses\[0\]\." utils/actions.ts` の無ガード参照が残っていない
- [ ] in-scope 外のファイル変更なし

## STOP conditions

- Plan 005 の特性テストが存在しない（依存順序違反）。
- エラーメッセージの変更が UI コンポーネント側のメッセージ分岐（もしあれば）を壊す場合 — `grep -rn "message ===" components/` で確認し、ヒットしたら報告。
- `ValidationError` の instanceof 判定が Next.js のバンドル境界で false になる現象が出た場合（`name` プロパティ判定へのフォールバックを検討する前に報告）。

## Maintenance notes

- API Route のエラー統一（confirm/payment/webhook の ad-hoc 処理）は本プランのパターン確立後に小プランで実施可能。
- 将来 structured logging（pino 等）を入れる場合、`renderError` の `console.error` が唯一の差し替え点になるよう保たれている。
- レビュアーの重点: ユーザー向けメッセージの取りこぼし（本来見せるべき文言が汎用化されていないか）。
