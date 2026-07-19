# Plan 010: 依存関係の整合 — Prisma メジャー不一致の解消と段階的アップグレード方針

> **2026-07-19 partial supersession**: Bun単独運用、Clerk v6移行、React 19移行、脆弱な推移依存の更新は実施済み。
> `package-lock.json`同期手順は廃止し、今後は`package.json`と`bun.lock`だけを更新する。
> このプランに残る作業はPrisma、eslint-config-next、Stripe API versionの整合に限定する。

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- package.json bun.lock`
> Dependabot による bump が入っている可能性が高い。バージョン番号は「現在の実値」を
> `package.json` で確認し直してから作業すること（本プランの番号は 21c0cbf 時点）。

## Status

- **Priority**: P2
- **Effort**: M（Step 1-3。Step 4 の大型アップグレードは別途）
- **Risk**: MED
- **Depends on**: plans/001-verification-baseline.md（CI が回帰ゲート）
- **Category**: migration
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

- **Prisma CLI（v5.22）とクライアント（v6.6）がメジャー不一致**。`bun run build` は `npx prisma generate` を実行するため、v5 の CLI が v6 のクライアントを生成するという非サポート構成で毎ビルド動いている。
- Stripe SDK は v15（最新 ~v18）で `apiVersion` 未指定 — Stripe アカウント既定に暗黙依存し、ダッシュボード変更でリクエスト/レスポンス形状が静かに変わり得る。**決済コードの土台として不安定**。
- ESLint 8 は EOLで、`eslint-config-next`（15.5.12）と`next`（15.5.18）にもパッチ差がある。Clerk 6とReact 19の整合は完了済みで、残る依存更新を放置するほどアップグレード費用が増える。

## Current state

`package.json`（21c0cbf 時点）:

```json
"dependencies": {
    "@clerk/nextjs": "^5.7.6",
    "@prisma/client": "^6.6.0",
    "next": "15.5.18",
    "react": "^18.3.1",
    "stripe": "^15.12.0",
    ...
},
"devDependencies": {
    "eslint": "^8",
    "eslint-config-next": "15.5.12",
    "prisma": "^5.22.0",
    ...
}
```

- Stripe 初期化（`app/api/payment/route.ts:2`, `app/api/confirm/route.ts:2`）: `new Stripe(process.env.STRIPE_SECRET_KEY as string)` — `apiVersion` なし。
- パッケージマネージャー: **Bun 1.3.12**。`bun.lock`が唯一のロックファイルで、DependabotもBunエコシステムを監視する。
- `overrides`セクションは脆弱性対応を含むため、本プランでは触らない。

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Install   | `bun install`                            | exit 0              |
| Generate  | `bunx prisma generate`                   | exit 0              |
| Typecheck | `bun run typecheck`                      | exit 0              |
| Tests     | `bun run test:run`                       | all pass            |
| Frozen install | `bun ci`                          | exit 0              |

## Scope

**In scope**:
- `package.json` / `bun.lock`（依存バージョンのみ）
- `app/api/payment/route.ts` / `app/api/confirm/route.ts`（`apiVersion` 指定の1行）
- Prisma v6 CLI 化に伴う `prisma/migrations` の差分が出た場合のみその確認

**Out of scope**:
- ESLint 9 / Stripe 18 への**実アップグレード** — Step 4 で「調査と分割プラン化」までに留める（Clerk 6とReact 19は実施済み）。
- `overrides` セクションの変更。
- アプリコードのロジック変更。

## Git workflow

- Branch: `advisor/010-deps-alignment`
- Commit は**ステップごとに分ける**こと（例: `chore(deps): align prisma CLI with client v6`、`fix(payment): pin Stripe apiVersion`）。ロールバック単位を保つ。

## Steps

### Step 1: Prisma CLI を v6 に揃える

```
bun add -d prisma@^6.6.0
bunx prisma generate
```

`bunx prisma migrate status` で既存マイグレーションに警告が出ないか確認（DB 接続が必要 — 接続不可環境なら generate + build 確認のみで可、その旨を報告）。

**Verify**: `bunx prisma generate` → exit 0、`bun run typecheck` → exit 0、`bun run test:run` → 全パス

### Step 2: eslint-config-next を next に揃える

```
bun add -d eslint-config-next@15.5.18
```

（`next` の実バージョンが drift していたらそちらに合わせる。）

**Verify**: `bun run lint` → exit 0

### Step 3: Stripe の apiVersion を明示

両ルートの初期化を変更:

```ts
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
    apiVersion: "2024-04-10",
});
```

バージョン文字列は **stripe@15 の型が要求するリテラル**に合わせる（`node_modules/stripe/types/lib.d.ts` の `LatestApiVersion` を確認。型エラーが出る値を勘で書かない）。webhook ルート（Plan 003 実施済みの場合）も同様に揃える。

**Verify**: `bun run typecheck` → exit 0、`bun run test:run` → payment/confirm テスト全パス

### Step 4: 大型アップグレードの調査レポート（コード変更なし）

以下を調査し、`plans/README.md` の Dependency notes に3行ずつで追記する（実施は将来の個別プラン）:

1. **ESLint 9 + flat config**: `eslint-config-next` の flat config 対応状況、`.eslintrc.json` からの移行手順の要点
2. **Stripe v18**: Checkout Sessions API の互換性、`constructEvent` の変更有無

React 19移行では`react-day-picker@8.10.2`、`react-leaflet@5.0.0`、`next-themes@0.4.6`、`@stripe/react-stripe-js@3.10.0`までpeer dependencyを整合済み。StripeサーバーSDKのメジャー更新はPlan 003/014の完了後に行う。

**Verify**: `plans/README.md` に2項目の追記が存在する

## Test plan

依存変更のみのため新規テストなし。各 Step 後の `typecheck` + `test:run` + `lint` が回帰ゲート。最後に `bun run build` を1回通す（Prisma generate 含む統合確認）。

## Done criteria

- [ ] `package.json` で `prisma` と `@prisma/client` のメジャーが一致
- [ ] `eslint-config-next` と `next` のバージョンが一致
- [ ] `grep -n "apiVersion" app/api/payment/route.ts app/api/confirm/route.ts` が両方ヒット
- [ ] `bun run build` exits 0
- [ ] `bun run test:run` / `bun run lint` / `bun run typecheck` すべて exit 0
- [ ] `bun ci`がロックファイル変更なしで成功する

## STOP conditions

- Prisma v6 CLI が既存マイグレーションの再生成・schema 変更を要求する場合（`migrate dev` を勝手に実行しない — DB 状態に触るため必ず停止・報告）。
- Step 1 で生成クライアントの型が変わり、アプリコードに2ファイル以上の修正が必要になる場合。
- Stripe の `apiVersion` 型に現行コードと互換のリテラルが存在しない場合。

## Maintenance notes

- Dependabot がこのリポジトリで有効なため、本プランの番号は着手時点で古い可能性が高い。**方針（メジャーを揃える・apiVersion を明示・大型は分割）だけが本体**で、番号は都度読み替える。
- Dependabotは`.github/dependabot.yml`のBunエコシステム設定により`bun.lock`を直接更新する。
- レビュアーの重点: `package-lock.json`を再導入せず、`bun ci`が成功すること。
