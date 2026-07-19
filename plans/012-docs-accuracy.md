# Plan 012: ドキュメントを実装と一致させる（README / CLAUDE.md）

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Set `PLAN_ROOT` to the selected plan root (for
> example, `plans`) and update this plan's status row in `$PLAN_ROOT/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- README.md CLAUDE.md app/api/ Dockerfile package.json`
> **Plan 003（webhook）の実施状況で記述内容が変わる**。着手前に
> `ls app/api/webhook/route.ts` を確認し、存在するなら「webhook 実装済み」前提で書くこと。

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none（ただし Plan 003 の後に実施するのが最も効率的）
- **Category**: docs
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

「間違ったドキュメントは無いより悪い」。現在3点が実装と食い違っており、いずれも読者（人間・AI エージェント双方）の判断を誤らせる:

1. **決済フロー**: `CLAUDE.md` と `README.md` は `app/api/confirm/route.ts` を「Webhook で paymentStatus を更新」と説明するが、実体は `return_url` から呼ばれる GET リダイレクトハンドラで、`STRIPE_WEBHOOK_SECRET` はコードのどこからも読まれていない。webhook 由来の信頼性（再送・冪等・サーバー権威）があると誤認させる。
2. **Docker**: `CLAUDE.md` は「Dockerfile は multi-stage ビルド」と記載するが、実際の `Dockerfile` は `FROM node:20-alpine` 1段のみ。
3. **バージョン表**: `README.md` の技術スタック表が Next.js 15.5.12（実: 15.5.18）、Clerk 5.1.4（実: ^5.7.6）、Prisma 6.6.0（実: クライアント 6.6.0 / CLI 5.22.0 の不一致）と3点ズレている。

## Current state

- `app/api/confirm/route.ts:8-30` — GET ハンドラ。`stripe.checkout.sessions.retrieve(session_id)` → `session.status === "complete"` なら `paymentStatus: true` 更新 → `/bookings` へ redirect。署名検証なし。
- `grep -rn "STRIPE_WEBHOOK_SECRET\|constructEvent" app utils` → 0件（21c0cbf 時点）。
- `Dockerfile:2` — `FROM node:20-alpine`（唯一の FROM）。
- `CLAUDE.md` 該当箇所: 「### **Stripe 決済フロー**」セクションと「## Docker」セクション。
- `README.md` 該当箇所: 技術スタック表と決済処理の説明部。
- 実バージョンの正: `package.json`（着手時点の値を必ず読み直す — Dependabot で動く）。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| 実装確認  | `ls app/api/webhook/route.ts` | Plan 003 実施済みなら存在 |
| バージョン確認 | `grep -E -e '"next"' -e '"@clerk/nextjs"' -e '"@prisma/client"' -e '"prisma"' -e '"stripe"' package.json` | 実値取得 |
| Lint      | `bun run lint`       | exit 0（docs のみだが habit として） |

## Scope

**In scope**:
- `README.md`
- `CLAUDE.md`
- `$PLAN_ROOT/README.md`（本プランの status row 更新のみ）

**Out of scope**:
- コードの変更一切（webhook 実装は Plan 003、multi-stage 化は将来プラン）
- `$PLAN_ROOT/README.md` 以外の選択した plan root 配下
- README の構成再編・翻訳 — 事実の修正のみ

## Git workflow

- Branch: `advisor/012-docs-accuracy`
- Commit 形式: `docs: ...`（既存例: `docs: update README and add CLAUDE.md`）

## Steps

### Step 1: 決済フローの記述を実装に合わせる

Plan 003 **未実施**の場合 — `CLAUDE.md` の Stripe セクションを:

```markdown
### Stripe 決済フロー

1. `app/api/payment/route.ts` → Stripe Checkout セッション作成（`paymentStatus: false` の Booking を作成）
2. `app/api/confirm/route.ts` → Checkout の return_url から GET で呼ばれ、セッション状態を
   `sessions.retrieve` で確認して `paymentStatus: true` に更新（注意: 署名検証付き webhook では
   ない。ブラウザがリダイレクトを完了しない場合は未確定のままになる既知の制約）
```

に修正し、`STRIPE_WEBHOOK_SECRET` を必須環境変数リストから「予約（webhook 実装時に使用）」へ移す。README の対応箇所も同様。

Plan 003 **実施済み**の場合 — webhook ルート（`app/api/webhook/route.ts`、署名検証、冪等更新）と confirm の UX 役割分担を記述する。

**Verify**: `grep -n "Webhook で" CLAUDE.md` が実装と矛盾する形で残っていない

### Step 2: Docker 記述の修正

`CLAUDE.md` の Docker セクション「multi-stage ビルド」→「single-stage ビルド（node:20-alpine）」に修正。`binaryTargets` の記述は正しいので残す。

**Verify**: `grep -n "multi-stage" CLAUDE.md` → 0件

### Step 3: README のバージョン表を package.json から再生成

技術スタック表の各行を `package.json` の現在値で更新。Prisma は CLI とクライアントのバージョンが異なる間は**2行に分けて明記**する（Plan 010 実施済みなら1行でよい）。

**Verify**: 表の全バージョンが `package.json` と一致（目視 + `grep` で突合）

### Step 4: 記述と実装の突合を一巡

README の主要な機能記述（決済・認証・テスト数など）を現状と突合し、明白に古い数値（例: テスト数）があれば同時に直す。**事実修正のみ** — 新しい約束を書き足さない。

**Verify**: `bun run lint` → exit 0（変更なしでも実行）

## Test plan

ドキュメントのみのため自動テストなし。Done criteria の grep 群が機械検証。

## Done criteria

- [ ] `grep -n "multi-stage" CLAUDE.md` → 0件
- [ ] CLAUDE.md / README.md の決済フロー記述が `app/api/` の実装と一致（webhook の有無を正しく反映）
- [ ] README のバージョン表が `package.json` の現在値と一致
- [ ] コードファイルの変更ゼロ（`git status` が README.md / CLAUDE.md / `$PLAN_ROOT/README.md` のみ）

## STOP conditions

- README に本プランが把握していない大規模な記述変更が入っており、修正箇所が特定できない場合。
- 決済フローが Plan 003 とも 21c0cbf 時点とも異なる第三の形になっている場合（実装を読み直しても判断がつかなければ報告）。

## Maintenance notes

- バージョン表は Dependabot で恒常的に古くなる。「メジャーのみ記載」または「バージョン列を削除しリンクに置換」を検討する価値がある（本プランでは現状形式を維持して値だけ直す）。
- CLAUDE.md はエージェントの前提知識になるため、実装変更を伴うプラン（003/010）の Done criteria に「CLAUDE.md 更新」を含める運用が望ましい — 今後のプラン作成時の教訓。
