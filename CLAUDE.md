# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コマンド

パッケージマネージャーは **Bun 1.3.12**。`bun.lock`だけを依存関係の正本とし、
`package-lock.json`やnpmコマンドを追加しない。CIとDockerのインストールは`bun ci`を使う。

```bash
# 開発サーバー
bun run dev

# ビルド（Prisma client 生成 + Next.js ビルド）
bun run build

# リント
bun run lint

# テスト（ウォッチモード）
bun run test

# テスト（1回実行）
bun run test:run

# 単一テストファイルの実行
bun run test:run utils/__tests__/calculateTotals.test.ts

# Docker Compose設定検証（.envを展開・出力しない）
bun run compose:check

# Prisma マイグレーション
bunx prisma migrate dev
bunx prisma generate
bunx prisma studio
```

Compose設定を検証するときは必ず`bun run compose:check`を使用する。
オプションなしの`docker compose config`は`.env`の値を出力するため実行しない。

## アーキテクチャ

### ディレクトリ構成

```text
app/                    # Next.js App Router ページ
  api/
    payment/route.ts    # Stripe セッション作成
    confirm/route.ts    # return URLの支払い確認・予約確定
    webhook/route.ts    # 署名検証付きの非同期予約確定
  admin/               # 管理ダッシュボード（ADMIN_USER_ID 必須）
  properties/          # 物件詳細・一覧
  bookings/            # 予約一覧
  rentals/             # ホストの物件管理
  ...
utils/
  actions.ts           # 全サーバーアクション（"use server"）
  db.ts                # Prisma クライアントシングルトン
  schemas.ts           # Zod バリデーションスキーマ
  supabase.ts          # 画像アップロード
  calculateTotals.ts   # 予約金額計算
  store.ts             # Zustand ストア
  types.ts             # 共通型定義
components/
  ui/                  # shadcn/ui ベースのプリミティブ
  card/                # 物件カードコンポーネント
  form/                # フォームコンポーネント
  navbar/              # ナビゲーション
  booking/             # 予約関連 UI
  ...
prisma/schema.prisma   # DB スキーマ
```

### 中心的な設計パターン

**Server Actions の集中管理**
主要なビジネスロジックは `utils/actions.ts` に集約。クライアントコンポーネントから `import { someAction } from "@/utils/actions"` で直接呼び出す。Stripe Checkoutの作成、return URL確認、Webhookは`app/api/`のRoute Handlerで扱う。

### **認証フロー（Clerk）**

- `middleware.ts`: `/` と `/properties(.*)` のみパブリック。他は Clerk の `protect()` で保護
- 管理者: `ADMIN_USER_ID` 環境変数と Clerk userId を比較
- `getAuthUser()`: Clerk `currentUser()` + `privateMetadata.hasProfile` チェック。未プロフィールなら `/profile/create` リダイレクト

### **Stripe 決済フロー**

1. `app/api/payment/route.ts` → 認証・Booking所有者を検証し、Stripe Checkout Sessionを作成または再利用
2. `app/api/webhook/route.ts` → raw bodyの署名を検証し、完了・非同期支払い成功イベントで`paymentStatus: true`へ冪等更新
3. `app/api/confirm/route.ts` → return URLからSessionを再取得し、支払い済みなら冪等更新、未確定ならpending画面へ遷移

**Profile と clerkId の参照**
`Profile.clerkId` が他モデル（Property, Booking, Review, Favorite）の外部キーとして使われる。`Profile.id`（UUID）ではなく `clerkId` で JOIN する設計に注意。

### Next.js 15 固有の注意点

- `params` / `searchParams` は `Promise` 型 → `await` 必須
- `auth()` (Clerk) は `async` → `await auth()` 必須
- `dynamic({ ssr: false })` は Server Component で使用不可 → `"use client"` ラッパーに抽出
- API Route Handler の第2引数 `res` は廃止

## テスト

- フレームワーク: **Vitest** + `@testing-library/react` + `jsdom`
- テスト場所: `utils/__tests__/`、`app/api/__tests__/`、各コンポーネント付近の`*.test.tsx`
- パスエイリアス: `@` → プロジェクトルート
- モック規則: `vi.hoisted()` でモック変数をホイスト。Stripe は `class StripeMock { checkout = { sessions: { create: mockFn } } }` 形式

## 環境変数

必須の環境変数（`.env.example`を参照してローカルの`.env`に設定）:

- `DATABASE_URL` / `DIRECT_URL` — Supabase PostgreSQL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL` / `SUPABASE_KEY`
- `ADMIN_USER_ID` — 管理者の Clerk userId

## Docker

```bash
# 開発環境（ホットリロード付き）
docker compose up

# 本番ビルド
docker build \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
  --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
  --build-arg NEXT_PUBLIC_WEBSITE_URL \
  -f Dockerfile -t airbnb-clone .
```

`Dockerfile`は、Bunで依存解決・ビルドし、standalone出力をNode.jsで実行するmulti-stage構成。3つの`NEXT_PUBLIC_*`値はビルド前にexportし、build argとして渡す。サーバー用秘密値をbuild argへ渡さない。`prisma/schema.prisma`の`binaryTargets`に`linux-musl-openssl-3.0.x`が含まれておりAlpine Linux対応済み。
