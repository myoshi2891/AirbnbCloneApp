# Plan 016: 設計スパイク — レビューの信頼性強化とゲスト・ホスト間メッセージング

> **Executor instructions**: これは**設計スパイク**であり、本実装プランではない。
> 成果物は設計文書（`plans/016-outcome.md`）。プロトタイプは使い捨てブランチ限定。
> STOP conditions 発生時は停止して報告。完了時は `plans/README.md` を更新。
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- prisma/schema.prisma utils/actions.ts components/reviews/`

## Status

- **Priority**: P3（direction 内では最後発 — 013/014/015 より independent）
- **Effort**: M（スパイク。本実装はレビュー側 M / メッセージング L）
- **Risk**: LOW
- **Depends on**: none（014 の status enum が入ると「宿泊完了」判定が綺麗になる — 参照のこと）
- **Category**: direction
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters（根拠 — このリポジトリ固有の証拠）

### レビューの信頼性（2つの非対称）

- **宿泊実績と無関係にレビュー可能**: レビュー投稿のゲートは `findExistingReview`（`utils/actions.ts:407-417`、1ユーザー1件）と「自分の物件でない」（`app/properties/[id]/page.tsx` 側の判定）のみ。Booking の存在チェックがなく、**泊まっていないユーザーが評価できる** — レーティングの信頼が構造的に弱い。
- **ホストが返信できない**: `Review` モデル（`prisma/schema.prisma:61-71`）は `rating`/`comment` のみで返信フィールドがなく、`components/reviews/ReviewCard.tsx` にも返信 UI がない。ホスト側から見ると一方的な評価システム。

### メッセージング（surface asymmetry）

- ホストは第一級の表示対象（`components/properties/UserInfo.tsx` が名前・写真を表示）で、`Booking` がゲスト Profile とホストの Property を既に結んでいるのに、**両者が連絡する手段がアプリ内に存在しない**（`Message`/`Conversation` モデルなし、grep でも UI 痕跡ゼロ）。チェックイン方法の確認等、予約には必然的に会話が伴う。データモデル上、会話スレッドは Booking キーの自然な拡張。

## Current state

- `prisma/schema.prisma:61-71` — Review: id/profileId/propertyId/rating/comment/timestamps
- `utils/actions.ts:300-324` — `createReviewAction`（Zod 検証あり、Booking チェックなし）
- `utils/actions.ts:407-417` — `findExistingReview`
- `components/reviews/ReviewCard.tsx` — 表示 + 削除のみ
- メッセージング: モデル・アクション・UI いずれも不存在
- 認可の既存規約: 所有者スコープは `where: { id, profileId: user.id }` 複合条件（`deleteReviewAction` 参照）

## スパイクで答えを出す問い

### レビュー信頼性（本実装 M — 先行して切り出し可）

1. **verified-stay ゲート**: `createReviewAction` に「チェックアウトが過去の支払済み Booking を持つこと」を要求する条件（`db.booking.findFirst({ where: { profileId, propertyId, paymentStatus: true, checkOut: { lt: new Date() } } })`）で十分か。既存レビュー（ゲートなし時代）の扱い（残す/バッジ分け）。
2. **ホスト返信**: `Review` に `response String?` + `respondedAt DateTime?` を足す案 vs 返信を別モデルにする案。1返信/レビューで足りる（本家同等）なら前者が安い — 決める。返信権限は「その物件の profileId == user.id」。
3. **UI**: ReviewCard への返信表示 + 物件オーナーにのみ返信フォームを出す条件分岐の設計。

### メッセージング（本実装 L — 独立プラン化前提）

4. **モデル**: `Conversation`（guestId, hostId, propertyId?, bookingId?, 一意制約）+ `Message`（conversationId, senderId, body, readAt?）。既存の `Profile.clerkId` FK 規約に合わせる。スレッドの一意性（同じゲスト×物件で1スレッド?）を決める。
5. **アクセス制御**: 参加者のみ read/write。サーバーアクションでの検証パターン（authedAction + participant チェック）を設計。**メッセージ本文は外部入力 — Zod 必須、XSS はプレーンテキスト描画で回避**。
6. **配信**: v1 はポーリング（一覧ページの revalidate）で足りるか。リアルタイム（Supabase Realtime は既存依存で可能）は v2 に送る判断でよいか — 費用比較を3行で。
7. **入口 UI**: bookings / reservations の行から「メッセージ」ボタン、navbar に受信箱。未読カウントのクエリコスト（Plan 008 の N+1 教訓を踏まえ、一覧で集計1回）。

## 進め方

1. 問い1-3（レビュー側）は読解のみで設計確定 — 出力に「本実装プラン即起票可」の粒度のステップ概要を含める
2. 問い4-7 はモデル素案（Prisma schema 断片）+ 画面遷移のテキストワイヤーまで
3. 成果物を `plans/016-outcome.md` に記録: レビュー側は実装ステップ概要付き、メッセージング側はモデル・認可・配信方針と分割案（推奨: ①モデル+送受信 ②入口UI+未読 の2プラン）

## Done criteria

- [ ] `plans/016-outcome.md` が存在し、7問すべてに回答している
- [ ] レビュー側に verified-stay 条件の確定形（Prisma where）が含まれる
- [ ] メッセージングのモデル素案が既存 FK 規約（clerkId 参照）に従っている
- [ ] main 系へのコード・スキーマ変更ゼロ

## STOP conditions

- Plan 014 の status enum 移行が並行して進んでいる場合、`paymentStatus: true` 依存の verified-stay 条件が二重設計になる — 014 の outcome を先に読み、整合させてから続行。
- メッセージングの要件がリアルタイム必須と判断される場合（Supabase Realtime の採用はアーキテクチャ判断 — ユーザー確認事項として報告）。

## Maintenance notes

- verified-stay ゲートはレーティングの意味を変える（件数が減る）。既存デモデータで review が全部非表示にならないか、ゲート適用は「新規投稿のみ」が安全。
- メッセージングは通知（メール/プッシュ)への将来接続点。v1 では作らないが、`Message` 作成箇所を単一アクションに集約しておくと後付けが容易。
