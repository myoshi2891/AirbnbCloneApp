# Plan 014: 設計スパイク — 予約ライフサイクル（ステータス enum・キャンセル・返金）

> **Executor instructions**: これは**設計スパイク**であり、本実装プランではない。
> 成果物は設計文書（`plans/014-outcome.md`）。プロトタイプは使い捨てブランチ限定。
> STOP conditions 発生時は停止して報告。完了時は `plans/README.md` を更新。
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- prisma/schema.prisma utils/actions.ts app/api/`
> Plan 003（webhook）実施済みであることが望ましい（`ls app/api/webhook/route.ts`）。

## Status

- **Priority**: P3
- **Effort**: M（スパイク。本実装は L）
- **Risk**: LOW（スパイク自体は）
- **Depends on**: plans/003-stripe-webhook-confirmation.md
- **Category**: direction
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters（根拠 — このリポジトリ固有の証拠）

予約の状態は `paymentStatus Boolean`（`prisma/schema.prisma:81`）の1ビットしかない。この表現力不足が複数の実問題の根になっている:

- **キャンセル = 物理削除**: `deleteBookingAction`（`utils/actions.ts:491-506`）は Booking 行を hard delete する。Stripe への返金は発生せず、ホストへの通知も履歴も残らない。「支払済み予約の削除」が返金なしで成立するのは、ゲスト視点では金銭事故である。
- **未払い予約の一括削除**: `createBookingAction` は新規予約のたびに自ユーザーの未払い予約を `deleteMany`（`utils/actions.ts:425-430`）— 「チェックアウト中」と「放棄」を区別できないための力技。
- **Plan 004 の残課題**: 重複予約チェックは `paymentStatus: true` としか衝突判定できず、「支払い中」の数分間に他者が同日程を確定できる隙間が残っている（Plan 004 の Design decision に明記）。expiry 付きホールド状態が解決策だが、それには状態機械が要る。
- 返金・非同期決済・disputes を受ける口（webhook, Plan 003）ができても、それを記録する状態が Boolean にはない。

## Current state

- `prisma/schema.prisma:73-86` — Booking: `paymentStatus Boolean @default(false)` のみ
- `paymentStatus` の消費箇所（すべて要改修対象になる）: `fetchBookings`（473行）, `createBookingAction` の deleteMany, `fetchRentals` の aggregate 条件, `fetchReservations`（636行）, `fetchStats`(665行), `fetchChartsData`(679行), `app/api/confirm/route.ts`, Plan 003 の webhook, Plan 004 の重複チェック
- Stripe SDK v15 — Refunds API は `stripe.refunds.create({ payment_intent })`。Checkout Session から `payment_intent` を取得して Booking に保存する必要がある（**現在保存していない** — 返金には新フィールドが要る）

## スパイクで答えを出す問い

1. **状態機械の設計**: 最小の enum は何か。候補: `PENDING`（作成直後・在庫ホールド）→ `CONFIRMED`（webhook 確定）→ `CANCELLED_BY_GUEST` / `CANCELLED_BY_HOST` / `REFUNDED`、および `EXPIRED`（ホールド期限切れ）。各遷移の許可条件・トリガー（ユーザー操作 / webhook / 期限）を状態遷移表にする。
2. **移行**: `paymentStatus Boolean` → `status BookingStatus` の Prisma migration と既存データ変換（true→CONFIRMED, false→PENDING or EXPIRED）。上記消費箇所全部の書き換え一覧を作り、blast radius を実測（ファイル数・行数）する。
3. **ホールドと expiry**: PENDING に `expiresAt` を持たせて Plan 004 の隙間を塞ぐ設計。期限切れ処理を (a) 読み取り時のフィルタで済ませる（cron 不要・推奨候補）か (b) 定期ジョブで EXPIRED に遷移させるか比較する。
4. **返金**: `paymentIntentId` を Booking に保存する箇所（webhook の `checkout.session.completed` イベントに含まれる）と、`cancelBookingAction` での `stripe.refunds.create` 呼び出し・部分返金ポリシー（キャンセル期限）の要否。ポリシーは「チェックイン48時間前まで全額」の単純案を出発点にする。
5. **UI 影響**: bookings / reservations 一覧に status バッジとキャンセルボタンを出す改修の見積り。

## 進め方

1. 状態遷移表と移行対象一覧（問い1-2）は読解のみで作成
2. 問い3-4 は Stripe のテストモードでの検証が必要なら使い捨てブランチ `spike/014-lifecycle` で最小検証（**実際の migrate は実行しない** — SQL 素案まで）
3. 成果物を `plans/014-outcome.md` に記録: 状態遷移表、migration SQL 素案、改修対象ファイル一覧、本実装の分割案（推奨: ①enum移行 ②ホールド/expiry ③キャンセル+返金 の3プラン）と各工数

## Done criteria

- [ ] `plans/014-outcome.md` が存在し、5問すべてに回答している
- [ ] 状態遷移表（状態×イベント）が含まれる
- [ ] `paymentStatus` 全消費箇所の一覧と書き換え方針が含まれる
- [ ] 本実装の3分割案と依存順序が明記されている
- [ ] main 系へのコード・スキーマ変更ゼロ

## STOP conditions

- Plan 003 が未実施で、webhook なしでは設計の前提（サーバー権威の確定イベント）が成立しない場合 — 003 を先に、と報告。
- Stripe テストモードのアカウント/キーがなく返金 API の挙動検証ができない場合（ドキュメントベースの設計に切り替えて続行し、その旨を outcome に明記）。

## Maintenance notes

- この outcome は Plan 004 の Maintenance notes（DB 排他制約）と合流する: enum 化後、EXCLUDE 制約の対象は `status IN ('PENDING','CONFIRMED')` になる。
- `fetchChartsData` 等の admin 集計は CONFIRMED 基準に揃える — 集計定義の変更はダッシュボードの数値を変えるため、移行時に管理者へ周知が必要。
