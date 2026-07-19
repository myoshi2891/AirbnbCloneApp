# Plan 003: 署名検証付き Stripe Webhook を決済確定の正とする

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- app/api/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-verification-baseline.md
- **Category**: security
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

現在、決済の確定（`paymentStatus: true` への更新）は Stripe Checkout の `return_url` から呼ばれる **GET リダイレクトハンドラ** `app/api/confirm/route.ts` だけが行っている。つまり:

- 買い手が支払い完了後にタブを閉じると、**課金されたのに予約が未確定のまま**になる。さらに未確定予約は `createBookingAction` の `deleteMany`（`utils/actions.ts:425-430`）により次回予約時に削除される — 「支払済みなのに予約が消える」実害シナリオ。
- 署名検証がなく、サーバー権威のイベントソースが存在しない。返金・非同期決済・障害リトライは一切反映されない。
- `CLAUDE.md` と `README.md` は confirm route を「Webhook」と説明しており、`STRIPE_WEBHOOK_SECRET` を必須と記載しているが、**コードはこの変数を一度も読んでいない**（`grep -rn "STRIPE_WEBHOOK_SECRET" app utils` は 0 件）。ドキュメントの信頼性問題でもある。

## Current state

- `app/api/confirm/route.ts:8-30`（全体が以下の構造）:

```ts
export const GET = async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const session_id = searchParams.get("session_id") as string;
    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        const bookingId = session.metadata?.bookingId;
        if (session.status !== "complete" || !bookingId) {
            throw new Error("Something went wrong..");
        }
        await db.booking.update({
            where: { id: bookingId },
            data: { paymentStatus: true },
        });
    } catch (error) { ... }
    redirect("/bookings");
};
```

- `app/api/payment/route.ts:60` — `return_url: \`${origin}/api/confirm?session_id={CHECKOUT_SESSION_ID}\``。
- Stripe クライアント初期化（両ルート共通、`route.ts:2`）: `new Stripe(process.env.STRIPE_SECRET_KEY as string)` — `apiVersion` 未指定。
- Stripe SDK: `stripe@^15.12.0`（`package.json`）。この SDK は `stripe.webhooks.constructEvent(rawBody, signature, secret)` を提供する。
- テスト規約: `app/api/__tests__/confirm.test.ts` が `vi.hoisted()` + `class StripeMock` 形式の手本。
- 環境変数 `STRIPE_WEBHOOK_SECRET` は `.env` 運用上すでに存在する前提（`CLAUDE.md` 必須リスト掲載）。**値をコード・プラン・テストに書かないこと。**

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0              |
| Tests     | `bun run test:run`   | all pass            |
| Lint      | `bun run lint`       | exit 0              |

## Scope

**In scope**:
- `app/api/webhook/route.ts`（新規作成）
- `app/api/confirm/route.ts`（更新の冪等化・UX 専用化）
- `app/api/__tests__/webhook.test.ts`（新規作成）
- `middleware.ts`（webhook ルートの認証除外が必要な場合のみ）

**Out of scope**:
- `app/api/payment/route.ts` — `return_url` はそのまま使い続ける（UX ナビゲーション用）。
- Booking の status enum 化・返金フロー — Plan 014 の設計スパイク。
- Stripe SDK のメジャーアップグレード — Plan 009。
- README / CLAUDE.md の記述修正 — Plan 011（本プラン完了後に記述が真実になる）。

## Git workflow

- Branch: `advisor/003-stripe-webhook`
- Commit 形式: conventional commits（例: `feat(payment): add signature-verified Stripe webhook`）

## Steps

### Step 1: webhook ルートを作成

`app/api/webhook/route.ts` を新規作成:

```ts
import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import db from "@/utils/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const POST = async (req: NextRequest) => {
    const signature = req.headers.get("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!signature || !secret) {
        return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
        const rawBody = await req.text();
        event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = session.metadata?.bookingId;
        if (bookingId) {
            await db.booking.updateMany({
                where: { id: bookingId, paymentStatus: false },
                data: { paymentStatus: true },
            });
        }
    }

    return NextResponse.json({ received: true });
};
```

要点: 署名検証には**生ボディ**（`req.text()`）が必須。`updateMany` + `paymentStatus: false` 条件で冪等（Stripe はイベントを再送する）。未処理のイベントタイプも 200 を返す（Stripe のリトライ嵐を防ぐ）。

**Verify**: `bun run typecheck` → exit 0

### Step 2: middleware の扱いを確認

`middleware.ts:4` のパブリックルートは `"/", "/properties(.*)"` のみ。Stripe からの webhook POST は Clerk セッションを持たないため、`clerkMiddleware` が `/api/webhook` をブロックしないか確認する。現在の実装は `isPublicRoute` 以外で `protect()` を呼ぶため、**`/api/webhook(.*)` を public route matcher に追加する必要がある**:

```ts
const isPublicRoute = createRouteMatcher(["/", "/properties(.*)", "/api/webhook(.*)"]);
```

（署名検証がこのルートの認証である。Clerk 保護は不要かつ有害。）

**Verify**: `bun run typecheck` → exit 0

### Step 3: confirm route を冪等・UX 専用に整える

`app/api/confirm/route.ts` の `db.booking.update` を `updateMany` + `where: { id: bookingId, paymentStatus: false }` に変更（webhook と同じ冪等パターン）。役割は「ユーザーを `/bookings` へ戻す + 即時反映のベストエフォート更新」に格下げされ、webhook が正となる。削除はしない（webhook 遅延時の UX を担保）。

**Verify**: `bun run typecheck` → exit 0

### Step 4: テスト追加

`app/api/__tests__/webhook.test.ts` を新規作成。`confirm.test.ts` の構造（`vi.hoisted` でモック変数、`class StripeMock`）を踏襲し、`StripeMock` に `webhooks = { constructEvent: mockConstructEvent }` を持たせる:

- 署名ヘッダなし → 400、`db.booking.updateMany` 未呼び出し
- `constructEvent` が throw（署名不正）→ 400
- `checkout.session.completed` + metadata.bookingId あり → `updateMany` が `{ where: { id, paymentStatus: false }, data: { paymentStatus: true } }` で呼ばれ 200
- 無関係のイベントタイプ → 200、DB 未呼び出し

**Verify**: `bun run test:run` → 全パス（新規4件含む）

## Test plan

上記 Step 4 の4ケース。環境変数はテスト内で `vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_dummy")` のようにダミー値を使う（実値を書かない）。

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test:run` すべて exit 0
- [ ] `grep -n "constructEvent" app/api/webhook/route.ts` がヒット
- [ ] `grep -rn "STRIPE_WEBHOOK_SECRET" app/` が webhook route でヒット（0件でなくなる）
- [ ] confirm / webhook 両方の更新が `paymentStatus: false` 条件付き（冪等）
- [ ] in-scope 外のファイル変更なし

## STOP conditions

- Next.js App Router で `req.text()` の生ボディが Stripe 署名と一致しない問題に2回の修正試行で解決しない場合（bodyParser 干渉の可能性 — 報告して指示を仰ぐ）。
- `middleware.ts` の変更が既存のミドルウェアテスト or 手動確認で他ルートの保護を壊すと判明した場合。
- Stripe SDK v15 に `constructEvent` が存在しない・シグネチャが異なる場合（ドキュメント上は存在するはずだが、型エラーが出たら報告）。

## Maintenance notes

- **デプロイ後の運用手順（コード外）**: Stripe ダッシュボードで webhook エンドポイント（`<本番URL>/api/webhook`）を登録し、`checkout.session.completed` を購読、発行された signing secret を `STRIPE_WEBHOOK_SECRET` に設定する。ローカル検証は `stripe listen --forward-to localhost:3000/api/webhook`。
- Plan 014（予約ライフサイクル）はこの webhook を `CONFIRMED`/`REFUNDED` 状態遷移の受け口として拡張する。
- レビュアーは「生ボディを一度しか読んでいないか」「全パスで HTTP レスポンスを返すか」を重点確認。
