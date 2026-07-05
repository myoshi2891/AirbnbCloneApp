# Plan 001: 検証基盤の確立 — typecheck スクリプト・CI・.env.example

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- package.json .github/ .env.example`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

このリポジトリには CI が一切なく（`.github/` ディレクトリ自体が存在しない）、typecheck 専用スクリプトもない。型エラーは `next build` を回すまで検出されず、Dependabot の依存更新 PR も自動ゲートなしでマージされている。後続のすべてのプラン（セキュリティ修正・リファクタ・テスト追加）は「ワンコマンドで壊れていないことを確認できる」基盤を前提にするため、このプランが最優先で先行する。

## Current state

- `package.json` の scripts（現状）:

```json
"scripts": {
    "dev": "next dev",
    "build": "npx prisma generate && next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest",
    "test:run": "vitest run"
}
```

- `typecheck` スクリプトなし。`tsconfig.json` は `strict: true` / `noEmit: true` であり、`npx tsc --noEmit` は監査時点（コミット `21c0cbf`）でエラーゼロで通る（グリーンベースライン確定済み）。
- `.github/` ディレクトリなし → GitHub Actions ワークフローなし。
- `.env.example` なし。必須環境変数は `CLAUDE.md` の「環境変数」セクションに列挙されている: `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_KEY`, `ADMIN_USER_ID`。
- パッケージマネージャーはローカルでは **bun**（`bun.lock`）。ただし Dependabot 用に `package-lock.json` も併存しており、これは意図的な二重管理（削除しないこと）。
- テストは Vitest（38件、`bun run test:run` で全パス）。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Install   | `bun install`        | exit 0              |
| Typecheck | `npx tsc --noEmit`   | exit 0, no errors   |
| Tests     | `bun run test:run`   | 38+ tests pass      |
| Lint      | `bun run lint`       | exit 0              |

## Scope

**In scope** (the only files you should modify/create):
- `package.json`（scripts に `typecheck` 追加のみ — 依存は追加しない）
- `.github/workflows/ci.yml`（新規作成）
- `.env.example`（新規作成）

**Out of scope** (do NOT touch):
- `bun.lock` / `package-lock.json` — 依存を追加しないので変わらないはず
- `.env`（存在するが gitignore 済み。**開かない・読まない・コミットしない**）
- `Dockerfile` / `compose.yaml` — CI での Docker ビルドは本プランの範囲外

## Git workflow

- Branch: `advisor/001-verification-baseline`
- Commit 形式: conventional commits（例: `chore(ci): add GitHub Actions workflow`）。`git log` の既存例: `chore(deps): upgrade next to 15.5.12...`
- push / PR 作成はオペレーターの指示があるまで行わない。

## Steps

### Step 1: typecheck スクリプトを追加

`package.json` の `scripts` に追加:

```json
"typecheck": "tsc --noEmit"
```

**Verify**: `bun run typecheck` → exit 0、エラーなし

### Step 2: CI ワークフローを作成

`.github/workflows/ci.yml` を新規作成。push（main）と pull_request で lint / typecheck / test を実行する:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx prisma generate
      - run: bun run lint
      - run: bun run typecheck
      - run: bun run test:run
```

注意: `prisma generate` は typecheck の前に必要（生成型 `@prisma/client` に依存するため）。CI ではデータベース接続は不要（generate はスキーマファイルのみ参照）。

**Verify**: ローカルで同じシーケンスを実行 — `bunx prisma generate && bun run lint && bun run typecheck && bun run test:run` → すべて exit 0

### Step 3: .env.example を作成

`.env.example` を新規作成。**値はすべてプレースホルダー**（実値を書かない）:

```bash
# Supabase PostgreSQL
DATABASE_URL="postgresql://user:password@host:5432/dbname?pgbouncer=true"
DIRECT_URL="postgresql://user:password@host:5432/dbname"

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Supabase Storage
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_KEY="your-anon-or-service-key"

# Admin (Clerk userId of the admin user)
ADMIN_USER_ID="user_..."
```

**Verify**: `grep -cE '=(""|"[a-z_]*\.\.\."|"postgresql://user|"https://your-project)' .env.example` が全行プレースホルダーであることを目視確認。実際のキー・実 URL・実 userId が含まれていないこと。

## Test plan

新規テストなし（インフラのみ）。既存 38 テストが `bun run test:run` で全パスすることが回帰確認。

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test:run` exits 0（38+ tests）
- [ ] `bun run lint` exits 0
- [ ] `.github/workflows/ci.yml` が存在し、lint / typecheck / test:run を含む
- [ ] `.env.example` が存在し、実値（実キー・実ホスト名・実ID）を一切含まない
- [ ] `git status` で in-scope 以外の変更がない

## STOP conditions

- `npx tsc --noEmit` がベースラインでエラーを出す（プラン作成時はグリーンだった → コードがドリフトしている）。
- `.env.example` 作成時に実値をコピーしたくなった場合 — 実値は絶対に書かない。`.env` を開くこと自体が不要。
- `bun install` が lockfile 変更を要求する場合。

## Maintenance notes

- 以後のプラン（002〜）はすべて Done criteria に `bun run typecheck` / `bun run test:run` を含む。この CI がそれらのゲートになる。
- Dependabot PR にもこの CI が自動適用され、依存更新の安全性が上がる。
- 将来 `STRIPE_WEBHOOK_SECRET` を実際に使うのは Plan 003（webhook 実装）。現状コードはこの変数を読んでいないが、`.env.example` には先行して含めてよい。
