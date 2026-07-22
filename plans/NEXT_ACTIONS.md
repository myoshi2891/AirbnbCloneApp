# Remaining Work and Next Actions

更新日: 2026-07-22

## 目的

Plan 001–012の実装とPlan 013–016の設計スパイクは完了している。本書は、その後に残る運用作業、既知の技術課題、スパイクから起票する本実装を、実行順・依存関係・完了条件つきで管理する仕様書である。

Plan 013–016の`DONE`は設計完了を意味し、本実装完了を意味しない。本実装へ着手するときは、本書の各項目を入力に自己完結した実装Planを新規作成し、schema変更、ロールアウト、テスト、ロールバックを明記する。

## 優先順位

| ID | 作業 | 種別 | 優先度 | 依存 | 状態 |
|---|---|---|---|---|---|
| NA-001 | Checkout追跡migrationの適用 | 運用 | P0 | デプロイ先とバックアップ手順の確認 | OPERATOR ACTION |
| NA-002 | Supabase Storageのキー/RLS監査 | セキュリティ運用 | P0 | Supabase管理権限 | OPERATOR ACTION |
| NA-003 | 予約ライフサイクルの本実装 | プロダクト | P1 | NA-001 | READY FOR PLANNING |
| NA-004 | レビュー信頼性とホスト返信 | プロダクト | P1 | NA-003 phase 1 | READY FOR PLANNING |
| NA-005 | ファセット検索 | プロダクト | P2 | NA-003 phase 1–2 | READY FOR PLANNING |
| NA-006 | 画像ギャラリーと実座標マップ | プロダクト | P2 | NA-002 | READY FOR PLANNING |
| NA-007 | 予約メッセージング | プロダクト | P3 | NA-003 phase 1 | READY FOR PLANNING |
| NA-008 | lint警告と依存更新の技術負債 | 保守 | P2 | 個別記載 | READY FOR PLANNING |
| NA-009 | ブランチのCI・デプロイ引き渡し | リリース | P1 | NA-001/002の判断 | NOT STARTED |

状態値は`NOT STARTED`、`READY FOR PLANNING`、`IN PROGRESS`、`OPERATOR ACTION`、`DONE`、`BLOCKED (理由)`を使う。

## 実行順

```text
NA-001 migration適用 ──> NA-003 予約状態 ──┬─> NA-004 レビュー信頼性
                                            ├─> NA-005 ファセット検索
                                            └─> NA-007 メッセージング

NA-002 Storage監査 ─────> NA-006 画像/座標

NA-008 技術負債は、対象のメジャー更新前に個別実施
NA-009 リリースは、NA-001/002の実施方針を確定してから行う
```

予約状態を先行する理由は、レビューの宿泊実績判定、検索の空室判定、メッセージの会話作成条件がすべてBookingの状態を参照するためである。`paymentStatus Boolean`を使った暫定実装は作らない。

## NA-001: Checkout追跡migrationの適用

オペレーター向けの実行前確認、適用、Stripeスモーク、失敗時対応、完了記録は[NA-001 Checkout追跡migration 運用指示書](./NA-001-checkout-migration-runbook.md)に従う。

### 現状

`prisma/migrations/20260719000000_add_checkout_session_tracking/migration.sql`は、Bookingへ次のnullable列を追加するだけのadditive migrationである。

- `checkoutSessionId TEXT`
- `checkoutSessionExpiresAt TIMESTAMPTZ(3)`

2026-07-22時点の`prisma migrate status`では未適用だった。アプリコードとPrisma Clientはこの列を参照するため、デプロイ対象DBへの適用が必要である。

### 手順

1. 接続先が意図した環境であることを、値を出力せず確認する。
2. DBバックアップまたは復旧手順、実施時間、担当者を確定する。
3. migration SQLが上記2列以外を変更しないことを再確認する。
4. 本番相当環境では`prisma migrate dev`を使わず、承認済みデプロイ手順から`bunx prisma migrate deploy`を実行する。
5. `bunx prisma migrate status`で未適用migrationがないことを確認する。
6. Checkout Session作成、confirm、webhookのスモークテストをStripe test modeで行う。

### 完了条件

- 対象環境、実施者、実施日時、復旧手順が記録されている。
- migration statusがcurrentである。
- Checkout Session IDと期限が保存され、決済確認フローに回帰がない。
- シークレットやDB接続文字列をログ、Issue、コミットへ出力していない。

### STOP conditions

- 対象DBを一意に特定できない。
- バックアップまたは復旧手順がない。
- 既存列との衝突、migration drift、想定外の未適用migrationが見つかる。

## NA-002: Supabase Storageのキー/RLS監査

### 現状

コードから`SUPABASE_KEY`がanon keyかservice role keyかを判別できず、`home-away-app`バケットのRLS/Storage policyもリポジトリ外にある。値を出力せず、Supabase Dashboardでオペレーターが確認する必要がある。

### 手順

1. `SUPABASE_KEY`の種別をDashboardのキー情報と照合する。キー値自体は端末出力や記録へ残さない。
2. `home-away-app`の公開/非公開設定、`storage.objects`のSELECT/INSERT/UPDATE/DELETE policyを確認する。
3. service role keyを通常アップロードに使っている場合、次のいずれかへ移行する。
   - anon keyと、対象bucket/pathへ限定したINSERT policy
   - サーバーが発行する短命の署名付きアップロードURL
4. service role keyがブラウザbundle、ログ、履歴へ露出していないことを確認する。露出の可能性があればローテーションする。
5. 認証済みユーザーの正常アップロードと、未認証/別ユーザー/不正MIME/過大ファイルの拒否を確認する。

### 完了条件

- 採用した認証方式と最小権限policyが、秘密値を含めず運用文書へ記録されている。
- ブラウザへservice role keyが渡らない。
- 許可ケースと拒否ケースの確認結果が残っている。
- 画像表示に必要な読み取り方式（public URLまたはsigned URL）と保存方式が一致する。

### STOP conditions

- key種別またはpolicyを確認できる管理権限がない。
- policy変更が既存画像の表示を止める可能性があり、段階移行手段がない。

## NA-003: 予約ライフサイクルの本実装

詳細仕様は[Plan 014 Outcome](./014-outcome.md)を正とする。1つの大規模変更にせず、次の3 Planへ分割する。

### Phase 1: 状態enum移行（M）

- `BookingStatus`と`BookingCancelledBy`をadditiveに導入する。
- 既存行を`paymentStatus`と期限からバックフィルする。
- 二重読み書き期間を置き、fetcher、payment/confirm/webhook、集計をstatus基準へ移す。
- 全消費箇所の移行を確認してから旧Booleanと重複期限列を削除する。
- 各schema変更はexpand/migrate/contractを別コミットまたは別デプロイ境界にする。

完了条件: 既存データが欠落せず、CONFIRMEDのみが売上・宿泊実績へ含まれ、旧列参照が`rg`とtestでゼロになる。

### Phase 2: holdとexpiry（M）

- 仮expiry、Stripe expiry同期、期限切れPENDINGのlazy cleanupを実装する。
- 予約競合は`CONFIRMED`または有効な`PENDING`だけを対象にする。
- 境界時刻、並行作成、Session作成失敗、期限切れ解放をテストする。

完了条件: 未払い予約が永久に在庫を塞がず、並行リクエストでも重複予約を作らない。

### Phase 3: キャンセルと返金（L）

- ゲスト/ホストの認可、48時間ポリシー、`REFUND_PENDING`、Stripe idempotency key、refund webhook同期を実装する。
- PaymentIntent未保存、API timeout、webhook再送を回復可能にする。
- Stripe test modeで全額返金を統合確認する。部分返金は対象外とする。

完了条件: 同一Bookingへの再試行で二重返金が起きず、失敗時は`REFUND_PENDING`から安全に再開できる。

## NA-004: レビュー信頼性とホスト返信

詳細仕様は[Plan 016 Outcome](./016-outcome.md)のreview trustを正とする。

- NA-003 phase 1完了後に着手し、`status: CONFIRMED`かつcheck-out済みの本人Bookingを要求する。
- Reviewへnullable `bookingId`を追加して既存レビューをlegacy表示のまま維持する。
- 新規レビューはBooking必須、1ユーザー1物件をDB uniqueでも保証する。
- verified-stay badgeと、所有者だけが1回投稿できるプレーンテキストのホスト返信を追加する。

完了条件: 未宿泊、自分の物件、未来の宿泊、他人のBooking、重複レビュー、他人の返信がサーバー側で拒否される。既存レビュー件数とrating集計は変わらない。

## NA-005: ファセット検索

詳細仕様は[Plan 015 Outcome](./015-outcome.md)を正とする。

- URLを唯一の検索状態とし、`propertySearchSchema`でcategory、country、guest数、価格帯、日付を正規化する。
- フィルターなしの一覧は既存cacheを維持し、動的フィルターは直接queryする。
- 日付検索の空室判定はNA-003 phase 2の有効なPENDING/CONFIRMED条件を使う。
- desktop/mobileのFilter UI、clear、pagination時のquery維持を実装する。

完了条件: 無効queryが安全な既定値へ正規化され、組み合わせfilter、空室境界、URL復元、paginationがtestで保証される。

## NA-006: 画像ギャラリーと実座標マップ

詳細仕様は[Plan 013 Outcome](./013-outcome.md)を正とする。

- NA-002で決めたStorage認証方式を前提に、PropertyImage relationとnullable座標をadditive migrationで導入する。
- 最大10枚、cover同期、並び替え、desktop grid、mobile carouselを段階実装する。
- 地図クリック入力と、権限に応じた概略/正確位置の表示を実装する。
- 旧`Property.image`はbackfillと読み取り互換期間を経て最後に削除する。

完了条件: 既存画像が消えず、新旧データを移行中も表示でき、未認可ユーザーへ正確な座標を返さない。

## NA-007: 予約メッセージング

詳細仕様は[Plan 016 Outcome](./016-outcome.md)のmessagingを正とし、次の2 Planへ分割する。

1. messaging core（L）: Conversation/Message schema、Bookingからの参加者決定、participant認可、送信、既読、50件cursor pagination。
2. entry/unread（M）: bookings/reservationsの入口、Inbox、batch unread、画面表示中だけの10秒polling。

NA-003 phase 1完了後、CONFIRMED Bookingだけが会話を作成できるようにする。クライアント指定のguest/host IDは信用しない。v1ではRealtime、添付、編集、削除、メール/Push通知を実装しない。

完了条件: 参加者以外は会話の存在を含めて取得できず、未読集計がN+1にならず、重複Conversationを作らない。

## NA-008: lint警告と依存更新の技術負債

### A. React Hooks警告の解消

現時点でlintは成功するが、次の既知warningが3件ある。

- `components/booking/BookingCalender.tsx`: `useEffect`の`toast`、`unavailableDates`
- `components/booking/BookingWrapper.tsx`: `useEffect`の`bookings`、`price`、`propertyId`
- `components/navbar/NavSearch.tsx`: dependency array内の複雑な式

挙動を変えず、参照の安定化またはeffect責務の整理で解消する。eslint disableによる隠蔽はしない。完了条件は`bun run lint`がwarning 0、関連component testが成功すること。

### B. ESLint 9 / flat config

Next.js 16へ上げる前に、`.eslintrc.json`を`eslint.config.mjs`へ移し、`next lint`依存をESLint CLIへ切り替える。現行ruleとwarning 0を維持し、CIの`bun run lint`を通す。Next.js更新とは別コミットにする。

### C. Prisma 7準備

Prisma 7へ上げる前にgeneratorの明示的なoutput pathを決め、生成clientのimportとsingletonを移行する。schema/client/CLIを同じPlanで同一versionへ更新し、migration適用作業とは分離する。

### D. Stripe SDK次期メジャー

API versionを明示したまま1メジャーずつ更新し、Checkout Sessionのcreate/retrieve、raw bodyの`constructEvent`、PaymentIntent/refund型を各境界で回帰確認する。NA-003 phase 3と同時にメジャー更新しない。

## NA-009: CI・デプロイ引き渡し

本書のコミット後、リモートへ反映・デプロイする担当者は次を順番に行う。

1. 現在のブランチのcommit rangeと差分をレビューする。
2. `bun run compose:check`、`bun run lint`、`bun run typecheck`、`bun run test:run`を再実行する。
3. ブランチをpushし、`.github/workflows/ci.yml`の全job成功を確認する。
4. NA-001/002を誰がいつ実行するかを明記する。未実施なら、アプリデプロイとの順序と既知リスクをリリース記録へ残す。
5. migrationを必要とするアプリ版は、NA-001完了前に本番へ切り替えない。

Compose設定の検証はリポジトリ規約どおり`bun run compose:check`だけを使用し、`.env`を展開するオプションなしの`docker compose config`は実行しない。

## 共通Done criteria

各実装Planは、個別条件に加えて次をすべて満たす。

- schema変更にはforward migration、既存データ移行、rollbackまたはroll-forward手順がある。
- 認可はUI表示ではなくserver action/Route Handler内で再検証する。
- 新しい状態遷移、境界値、失敗時の再試行を自動テストする。
- `bun run compose:check`、`bun run lint`、`bun run typecheck`、`bun run test:run`が成功する。
- シークレット、個人情報、接続文字列をログやコミットへ含めない。
- 仕様変更、運用手順、環境変数変更をREADMEまたは対応Planへ反映する。

## 今回の対象外

- Supabase RealtimeとClerk JWT/RLSの統合
- メッセージの添付、編集、削除、メール/Push通知
- 予約の部分返金
- 管理画面の低頻度query最適化
- 実DBを使う全面的な統合テスト基盤

対象外項目は、利用量、障害、プロダクト優先度など具体的なトリガーが発生した時点で再評価する。
