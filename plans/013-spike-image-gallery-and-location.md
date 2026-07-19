# Plan 013: 設計スパイク — 物件画像ギャラリーと実座標マップ

> **Executor instructions**: これは**設計スパイク**であり、本実装プランではない。
> 成果物は調査結果と設計文書（本ファイルへの追記または `plans/013-outcome.md`）。
> プロトタイプコードは使い捨てブランチに限り、main 系へマージしない。
> STOP conditions 発生時は停止して報告。完了時は `plans/README.md` の
> ステータス行を更新すること。
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- prisma/schema.prisma components/properties/ utils/supabase.ts`

## Status

- **Priority**: P3
- **Effort**: M（スパイク自体。本実装は L）
- **Risk**: LOW（スパイクは読み取り + 使い捨て）
- **Depends on**: plans/007-upload-hardening.md（uploadImage のシグネチャ前提）
- **Category**: direction
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters（根拠 — このリポジトリ固有の証拠）

1. **ギャラリーは stated-but-undelivered**: `README.md` は物件詳細の「画像ギャラリー」を明記しているが、`prisma/schema.prisma:33` の `Property.image` は単一 `String`、`components/properties/ImageContainer.tsx` は `<Image>` を1枚描画するのみ。1物件1枚は本家クローンとして最大の見劣り点（寝室・浴室・外観を見せられない）。
2. **マップは国レベルの精度しかない**: leaflet + react-leaflet は導入済みでマップは描画されるが、`Property` には `country` しかなく（住所・緯度経度なし）、`components/properties/PropertyMap.tsx` は**国の重心**にピンを置く。同じ国の全物件が同一地点に表示され、「滞在場所」情報として実質機能していない。宿泊先選びの最重要因子の一つが欠けている。

両者は「スキーマにフィールドを足し、既存の描画基盤に流す」という同型の作業なので1スパイクで扱う。

## Current state

- `prisma/schema.prisma` Property モデル: `image String` / `country String`（city/address/lat/lng なし）
- `components/properties/ImageContainer.tsx` — 単一画像描画
- `components/properties/PropertyMap.tsx` — `findCountryByCode(countryCode)?.location` で国重心を center/marker に使用
- `utils/supabase.ts` の `uploadImage(image: File)` — 1ファイル用（Plan 007 適用後はサーバー生成キー）
- `components/form/ImageInput.tsx` / `ImageInputContainer.tsx` — 単一ファイル入力
- `app/api/payment/route.ts:36` — `property.image` を Stripe の商品画像に使用（スキーマ変更の波及先）
- `fetchProperties` の select に `image` — カードのサムネイル

## スパイクで答えを出す問い

### ギャラリー

1. **データモデル**: `PropertyImage` リレーションテーブル（order カラム付き） vs Postgres `String[]`。Prisma での並び替え・削除操作、既存データのバックフィル（既存 `image` → 先頭画像）の移行 SQL をそれぞれ試作し、推奨を決める。
2. **後方互換**: `Property.image` を残して「サムネイル = 先頭画像」の非正規化を維持するか、完全移行するか。`fetchProperties` / payment route / カードの3消費先の改修コストを見積もる。
3. **UI**: アップロードフォームの複数ファイル対応（`<input multiple>` + 上限枚数・合計サイズ）と、詳細ページのギャラリー UI（shadcn/ui ベースで carousel を自作 or 依存追加）。**外部依存の追加はユーザー確認が必要**（リポジトリ規約）— 候補と費用を列挙するに留める。

### 実座標マップ

4. **スキーマ**: `latitude Float?` / `longitude Float?` / `address String?` の nullable 追加（既存行は国重心フォールバック）で足りるか。
5. **座標の取得方法**: (a) ホストがマップをクリックしてピンを置く（leaflet で実装可、外部 API 不要・推奨候補）、(b) 住所文字列のジオコーディング（Nominatim 等 — 利用規約・レート制限・API キー管理の調査必須）。両案の比較表を作る。
6. **プライバシー**: 正確な座標の公開は実物件では問題になる（本家は予約確定まで概略円表示）。クローンとしてどこまで再現するか方針を1段落で提案。

## 進め方

1. 上記6問それぞれに対し、コード読解 + 必要なら使い捨てブランチ（`spike/013-gallery`）での最小プロトタイプで検証する
2. 成果物: 各問いへの回答・推奨案・本実装のステップ概要（10行程度）・工数見積（S/M/L）を `plans/013-outcome.md` に記録
3. 本実装プランは、この outcome を入力として改めて `plan` 起票する（このスパイクの範囲外）

## Done criteria

- [ ] `plans/013-outcome.md` が存在し、6問すべてに推奨付きで回答している
- [ ] スキーマ移行案に既存データのバックフィル方針が含まれる
- [ ] 依存追加候補（carousel / geocoding）が費用・代替とセットで列挙され、**追加はしていない**
- [ ] main 系ブランチへのコード変更ゼロ（`git status` / spike ブランチのみ）

## STOP conditions

- スパイク中に既存スキーマへ migrate を実行したくなった場合（スパイクでは shadow DB か SQL 素案までに留める）。
- 外部ジオコーディング API の利用に課金・キー登録が必要で、それなしに評価不能な場合（机上比較で済ませて報告）。

## Maintenance notes

- Plan 007 で `uploadImage` のシグネチャが変わっている前提。複数化はこの関数のループ利用が起点。
- 本実装時は Plan 009 のキャッシュタグ（"properties"）への波及（画像更新で revalidateTag）を忘れないこと。
