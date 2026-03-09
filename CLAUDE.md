# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コマンド

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

# Prisma マイグレーション
bun prisma migrate dev
bun prisma generate
bun prisma studio
```

## アーキテクチャ

### ディレクトリ構成

```text
app/                    # Next.js App Router ページ
  api/
    payment/route.ts    # Stripe セッション作成
    confirm/route.ts    # 支払い確認・予約確定
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
全ビジネスロジックは `utils/actions.ts` に集約。クライアントコンポーネントから `import { someAction } from "@/utils/actions"` で直接呼び出す。API Routes は Stripe Webhook 用途のみ（`app/api/`）。

### **認証フロー（Clerk）**

- `middleware.ts`: `/` と `/properties(.*)` のみパブリック。他は Clerk の `protect()` で保護
- 管理者: `ADMIN_USER_ID` 環境変数と Clerk userId を比較
- `getAuthUser()`: Clerk `currentUser()` + `privateMetadata.hasProfile` チェック。未プロフィールなら `/profile/create` リダイレクト

### **Stripe 決済フロー**

1. `app/api/payment/route.ts` → Stripe Checkout セッション作成（`paymentStatus: false` の Booking を作成）
2. `app/api/confirm/route.ts` → Webhook で `paymentStatus: true` に更新

**Profile と clerkId の参照**
`Profile.clerkId` が他モデル（Property, Booking, Review, Favorite）の外部キーとして使われる。`Profile.id`（UUID）ではなく `clerkId` で JOIN する設計に注意。

### Next.js 15 固有の注意点

- `params` / `searchParams` は `Promise` 型 → `await` 必須
- `auth()` (Clerk) は `async` → `await auth()` 必須
- `dynamic({ ssr: false })` は Server Component で使用不可 → `"use client"` ラッパーに抽出
- API Route Handler の第2引数 `res` は廃止

## テスト

- フレームワーク: **Vitest** + `@testing-library/react` + `jsdom`
- テスト場所: `utils/__tests__/` と `app/api/__tests__/`
- パスエイリアス: `@` → プロジェクトルート
- モック規則: `vi.hoisted()` でモック変数をホイスト。Stripe は `class StripeMock { checkout = { sessions: { create: mockFn } } }` 形式

## 環境変数

必須の環境変数（`.env.local`）:

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
docker build -f Dockerfile -t airbnb-clone .
```

`Dockerfile` は multi-stage ビルド。`prisma/schema.prisma` の `binaryTargets` に `linux-musl-openssl-3.0.x` が含まれており Alpine Linux 対応済み。
