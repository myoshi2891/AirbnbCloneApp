# NA-001 Checkout追跡migration 運用指示書

更新日: 2026-07-22

## 目的

`prisma/migrations/20260719000000_add_checkout_session_tracking/migration.sql`を承認済みのPostgreSQL環境へ安全に適用し、既存の予約・決済フローを壊していないことを確認する。

このmigrationが行う変更は、`Booking`テーブルへの次のnullable列の追加だけである。

- `checkoutSessionId TEXT`
- `checkoutSessionExpiresAt TIMESTAMPTZ(3)`

この作業が完了するまで、NA-003のschema変更やアプリケーション実装を開始しない。

## 役割

最低限、次の役割を決める。同じ担当者が複数の役割を兼ねてもよいが、本番環境では実行者以外による事前確認を推奨する。

| 役割 | 責任 |
|---|---|
| 実行者 | 接続先確認、migration適用、結果記録 |
| 承認者 | 対象環境、実施時間、復旧手順、SQL差分の承認 |
| 確認者 | Stripe test modeのスモークテスト |

## 絶対に守ること

- `DATABASE_URL`、`DIRECT_URL`、Stripe/Supabase/Clerkのキーを画面共有、Issue、チャット、ログ、コミットへ貼らない。
- `env`、`printenv`、`set`、`echo $DATABASE_URL`など、環境変数の値を表示するコマンドを使わない。
- Compose確認が必要な場合は`bun run compose:check`だけを使う。オプションなしの`docker compose config`を実行しない。
- 本番相当環境で`prisma migrate dev`、`prisma migrate reset`、`prisma db push`を使わない。
- Prismaコマンドの生出力には接続先情報が含まれる可能性があるため、安全なオペレーター端末だけで確認し、Issue等には下記テンプレートの判定結果だけを記録する。
- migrationファイルを適用直前に編集しない。差分が必要なら作業を停止し、別migrationとしてレビューする。

## STOP conditions

次のいずれかに該当したら`migrate deploy`を実行せず、NA-001を`BLOCKED`として担当者へ連絡する。

- 対象DBを環境名、プロジェクト、リリース設定から一意に特定できない。
- バックアップ、Point-in-Time Recovery、または承認済み復旧手順を確認できない。
- `20260719000000_add_checkout_session_tracking`以外の未適用migrationがある。
- migration履歴にmissing、modified、failed、divergedのいずれかがある。
- `_prisma_migrations`テーブルが存在せず、このDBのbaseline方針が承認されていない。
- `Booking`テーブルが存在しない、または追加対象列の片方だけがすでに存在する。
- 実行中のアプリが参照するDBとmigration対象DBが一致していると確認できない。
- Stripe sandbox/test modeと対象アプリを結び付けられず、決済スモークテストを実施できない。

## Step 1: 変更記録を準備する

秘密情報を含まない運用チケットまたは社内記録へ、次を記入する。接続文字列やキーは記入しない。

```text
NA-001 Checkout migration

対象環境:
対象プロジェクト名または管理ID:
アプリケーションのcommit SHA:
実行者:
承認者:
確認者:
予定日時とタイムゾーン:
バックアップ/PITR確認日時:
復旧手順またはrunbook:
Stripeモード: sandbox/test
監視先:
```

commit SHAはリポジトリルートで次を実行して取得する。この値は秘密情報ではない。

```bash
git rev-parse --short HEAD
git status --short --branch
```

未コミット変更がある場合は、その変更が今回のmigrationと無関係であることを確認する。内容を理解できない変更がある状態では作業を続けない。

## Step 2: 接続先を値を表示せず確認する

1. デプロイ基盤またはSupabase Dashboardで、対象アプリに設定されているDBプロジェクト名・環境名を確認する。
2. `DATABASE_URL`と`DIRECT_URL`が「設定済み」であることだけを確認し、値を開いたりコピーしたりしない。
3. 対象アプリの環境名、DBプロジェクト、運用チケットの対象が一致することを実行者と承認者で確認する。
4. 本番DBのURLを一時的にローカル`.env`へ保存しない。承認済みのCI/CD release job、デプロイrunner、または保護された管理端末から実行する。

一致を確認できなければ停止する。

## Step 3: バックアップと復旧可能性を確認する

次のどちらかを確認する。

- 管理サービスの自動バックアップ/PITRが有効で、今回の実施直前時点へ戻せる。
- 承認済み手順で取得したDBバックアップがあり、保管先と復元担当者が決まっている。

記録にはバックアップの識別情報または管理画面上の確認日時だけを残し、ダウンロードURLや認証情報は残さない。

今回の変更はnullable列の追加だけなので、適用後に問題が見つかった場合の第一選択は「アプリを旧版へ戻し、追加列は残す」である。列削除はデータを失う可能性があるため、通常のrollbackとして実行しない。

## Step 4: migration SQLを再確認する

リポジトリルートで次を実行する。

```bash
git diff --check
sed -n '1,80p' prisma/migrations/20260719000000_add_checkout_session_tracking/migration.sql
bunx prisma validate
```

確認結果が次と完全に一致することを確認する。

- 操作対象は`Booking`テーブルだけ。
- `checkoutSessionId TEXT`をnullableで追加する。
- `checkoutSessionExpiresAt TIMESTAMPTZ(3)`をnullableで追加する。
- `DROP`、既存列の型変更、既存行の`UPDATE`、index作成、別テーブル変更がない。

1つでも一致しなければ停止する。

## Step 5: 適用前のDB状態を確認する

安全なオペレーター端末から次を実行する。生出力を公開チケットへ貼らない。

```bash
bunx prisma migrate status
```

Prisma 4.3以降では未適用migrationがある場合に終了コード1となるため、この時点の終了コード1だけでは失敗と判断しない。出力内容が次の期待値と一致することを確認する。

- ローカルで認識される未適用migrationが`20260719000000_add_checkout_session_tracking`だけ。
- failed、modified、missing、diverged migrationがない。
- DB接続エラーがない。

次のSQLをSupabase SQL Editorなどの保護されたDB管理画面で実行し、追加対象列がどちらも存在しないことを確認する。このqueryは列定義だけを確認し、予約データを取得しない。

```sql
SELECT
  "column_name",
  "data_type",
  "is_nullable"
FROM "information_schema"."columns"
WHERE "table_schema" = 'public'
  AND "table_name" = 'Booking'
  AND "column_name" IN (
    'checkoutSessionId',
    'checkoutSessionExpiresAt'
  )
ORDER BY "column_name";
```

期待行数は`0`。1行または2行返った場合は、履歴とschemaの不整合を調査するまで停止する。

## Step 6: migrationを適用する

予定した実施時間に、承認済みrunnerから次だけを実行する。

```bash
bunx prisma migrate deploy
```

このコマンドを複数端末から同時に実行しない。途中で端末を閉じない。失敗した場合は、同じコマンドを直ちに繰り返したり、`migrate resolve`で状態を書き換えたりせず、Step 9へ進む。

成功後、次を実行する。

```bash
bunx prisma migrate status
```

期待結果は「未適用migrationなし」かつ終了コード0である。

## Step 7: schema反映を確認する

Step 5と同じ列確認SQLを実行する。期待結果は次の2行である。

| column_name | data_type | is_nullable |
|---|---|---|
| checkoutSessionExpiresAt | timestamp with time zone | YES |
| checkoutSessionId | text | YES |

さらに、migration履歴をDB管理画面で確認する。

```sql
SELECT
  "migration_name",
  "finished_at" IS NOT NULL AS "finished",
  "rolled_back_at" IS NOT NULL AS "rolled_back"
FROM "_prisma_migrations"
WHERE "migration_name" = '20260719000000_add_checkout_session_tracking';
```

期待結果は1行、`finished=true`、`rolled_back=false`である。時刻、checksum、DB接続情報を公開チケットへ転載しない。

## Step 8: Stripe test modeスモークテスト

### 前提

- 対象アプリがmigrationを適用した同じDBを参照している。
- Stripe Dashboardがsandbox/test modeである。
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`が同じStripe sandbox/test環境に属する。
- ClerkのテストユーザーにProfileがあり、予約可能な物件と未来の日付がある。
- 実カードや実在ユーザーの個人情報を使用しない。

### 8.1 Checkout Session作成と再利用

1. テストユーザーでサインインする。
2. 自分が所有していない物件で、既存予約と重ならない未来の日付を選ぶ。
3. 予約操作を行い、`/checkout/?bookingId=...`へ遷移することを確認する。
4. Embedded Checkoutが表示されることを確認する。
5. 決済前にページを1回再読み込みし、エラーにならず同じ未完了Sessionが再利用されることを確認する。
6. DB管理画面で対象Bookingを確認し、Session IDそのものは記録せず、次だけを判定する。

```sql
SELECT
  "checkoutSessionId" IS NOT NULL AS "has_checkout_session",
  "checkoutSessionExpiresAt" IS NOT NULL AS "has_expiry",
  "checkoutSessionExpiresAt" > CURRENT_TIMESTAMP AS "expiry_is_future"
FROM "Booking"
WHERE "id" = '<テストBooking ID>';
```

期待結果は3項目すべて`true`。

### 8.2 成功決済、confirm、webhook

1. Stripeの成功用テストカード`4242 4242 4242 4242`、未来の有効期限、任意の3桁CVCを使用する。
2. 決済を完了し、`/api/confirm`を経由して`/bookings`へ遷移することを確認する。
3. 対象予約が予約一覧に1件だけ表示されることを確認する。
4. Stripe Dashboardで、対象イベントのWebhook deliveryが2xxであることを確認する。
5. DB管理画面で対象Bookingの`paymentStatus`が`true`であることだけを確認する。Booking行全体やSession IDは記録へ貼らない。

### 8.3 非同期成功webhook

1. 8.2とは別に未払いのテストBookingを1件作り、対象Booking IDだけを安全な作業メモへ控える。
2. migrationを適用した環境のWebhook endpointが、対象Stripe sandboxで`checkout.session.async_payment_succeeded`を受信する有効なWebhook destinationとして登録済みであることを確認し、承認済みStripe CLIで次を実行する。`<非同期成功テストBooking ID>`は手順1で控えた値へ置き換える。

   ```bash
   stripe trigger checkout.session.async_payment_succeeded \
     --override checkout_session:"metadata[bookingId]"='<非同期成功テストBooking ID>'
   ```

   この成功イベントでは`data.object.payment_status=paid`となる。`payment_status`はCheckout Session作成時に指定できる入力ではないため、CLIのoverrideには追加せず、次の手順で生成結果を確認する。
3. Stripe Workbenchで生成された`checkout.session.async_payment_succeeded`の`data.object.payment_status`が`paid`、`data.object.metadata.bookingId`が対象Booking IDであり、migrationを適用した環境のWebhook endpointへStripe署名付きで配信されたことを確認する。手書きJSONを直接POSTしない。
4. Stripe DashboardまたはCLIのdelivery結果でWebhook応答が2xxであることを確認する。
5. DB管理画面で次だけを照合し、`payment_status_is_true = true`を確認する。Booking行全体、Session ID、イベントpayloadは記録へ貼らない。

```sql
SELECT "paymentStatus" IS TRUE AS "payment_status_is_true"
FROM "Booking"
WHERE "id" = '<非同期成功テストBooking ID>';
```

### 8.4 Webhook再送の冪等性

1. Stripe Dashboardの対象`checkout.session.completed`イベントと8.3の`checkout.session.async_payment_succeeded`イベントを、それぞれ同じendpointへ再送する。Stripe CLIを承認済みで使用する場合は、公式手順の`stripe events resend`を使う。
2. 両方の再送が2xxとなることを確認する。
3. 予約一覧に重複が増えず、各Bookingが支払い済みのままであることを確認する。

### 8.5 スモークテストの後始末

- テストBookingを削除する場合は、既存UIまたは承認済み管理手順を使う。
- Stripe上のtest objectは実課金を伴わないため、監査要件がなければそのまま残してよい。
- SQLで直接Bookingを削除しない。必要な場合は対象IDと削除理由を明示し、別途承認を得る。

## Step 9: 失敗時の対応

### `migrate deploy`前に異常が見つかった

- DBを変更せず作業を終了する。
- `NEXT_ACTIONS.md`の状態を`BLOCKED (理由)`として更新する場合も、接続文字列や生ログを記載しない。
- status出力は安全な保管先に限定し、共有記録には分類した原因だけを書く。

### `migrate deploy`が失敗した

1. アプリをデプロイせず、DB管理画面で対象2列と`_prisma_migrations`の対象行を確認する。
2. PostgreSQL transactionにより列が追加されていない場合は、原因を解決してから再実行計画を承認してもらう。
3. failed migrationが記録されている場合は、DB担当者とPrismaのproduction troubleshooting手順に従う。
4. `prisma migrate resolve --applied/--rolled-back`を独断で実行しない。
5. 手動で列を追加・削除したり、migration SQLを書き換えたりしない。

### migration成功後にアプリ障害が起きた

- 追加列はnullableで既存アプリと互換なので、まずアプリを直前の正常版へ戻す。
- 追加列は残す。列削除やDB restoreは原則不要。
- DB restoreが必要な別の障害を確認した場合だけ、承認済み復旧手順を実行する。

## Step 10: 完了記録とNA-003への引き渡し

次のテンプレートを秘密値なしで記録する。

```text
NA-001 実施結果

結果: DONE / BLOCKED
対象環境:
適用commit SHA:
実行者:
承認者:
実施日時とタイムゾーン:
バックアップ/PITR確認: 済 / 未
migrate status: current / blocked
適用migration: 20260719000000_add_checkout_session_tracking
列定義確認: OK / NG
Checkout Session作成・再利用: OK / NG
confirmリダイレクト: OK / NG
webhook 2xx: OK / NG
webhook再送の冪等性: OK / NG
既知の問題:
```

すべて`OK`であれば、`plans/NEXT_ACTIONS.md`のNA-001を`DONE`、NA-003を`IN PROGRESS`へ更新し、Plan 017のexpand migrationへ進む。1項目でも`NG`または未確認ならNA-003へ進まない。

## 公式資料

- [Prisma: migrate deploy](https://docs.prisma.io/docs/cli/migrate/deploy)
- [Prisma: migrate status](https://docs.prisma.io/docs/cli/migrate/status)
- [Prisma: development and production workflow](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)
- [Stripe: test card numbers](https://docs.stripe.com/testing)
- [Stripe: receive and resend webhook events](https://docs.stripe.com/webhooks?lang=node)
