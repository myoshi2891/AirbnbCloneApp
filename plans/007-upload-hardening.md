# Plan 007: 画像アップロードの強化 — サーバー生成キーと実体検証

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- utils/supabase.ts utils/schemas.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: security
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

アップロード処理は (1) **クライアント指定のファイル名をそのままストレージのオブジェクトパスに使用**しており、`/` や `..` を含む名前でバケット内パスを操作できる。(2) MIME 検証はクライアント申告の `File.type` が `"image/"` で始まるかだけで、偽装可能 — 非画像コンテンツが public URL 配下に置ける。サイズ上限 1MB は既に有効で被害半径は限定的だが、両方とも小工数で塞げる。

あわせて **investigate 項目**: `SUPABASE_KEY` が service_role キーか anon キーか、コードからは判別できない。service_role なら RLS を全バイパスするため、バケットポリシー確認が必要（Step 3）。

## Current state

- `utils/supabase.ts`（全18行）:

```ts
const bucket = "home-away-app";
const url = process.env.SUPABASE_URL as string;
const key = process.env.SUPABASE_KEY as string;
const supabase = createClient(url, key);

export const uploadImage = async (image: File) => {
    const timestamp = Date.now();
    const newName = `${timestamp}-${image.name}`;
    const { data } = await supabase.storage
        .from(bucket)
        .upload(newName, image, { cacheControl: "3600" });
    if (!data) throw new Error("Image upload failed");
    return supabase.storage.from(bucket).getPublicUrl(newName).data.publicUrl;
};
```

- `utils/schemas.ts:36-50` — `validateFile()`: サイズ ≤ 1MB と `file.type.startsWith("image/")` のみ。
- 呼び出し元: `utils/actions.ts` の `createPropertyAction` / `updateProfileImageAction` / `updatePropertyImageAction`（すべて `validateWithZodSchema(imageSchema, ...)` → `uploadImage` の順）。
- エラーハンドリング注意: `upload` の戻りの `error` オブジェクトを読まず `!data` だけで判定している（失敗理由が失われる）。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0              |
| Tests     | `bun run test:run`   | all pass            |
| Lint      | `bun run lint`       | exit 0              |

## Scope

**In scope**:
- `utils/supabase.ts`
- `utils/schemas.ts`（`validateFile` の型検証強化）
- `utils/__tests__/schemas.test.ts`（テスト追加）

**Out of scope**:
- 画像のマジックバイト（ファイル先頭バイト列）検証 — File API でも可能だが、拡張子/正確な MIME allowlist で費用対効果は十分。将来強化として Maintenance notes に記載。
- 複数画像対応（Plan 013 の設計スパイク）。
- Supabase バケットのポリシー変更そのもの（コード外の運用作業 — Step 3 は調査と報告まで）。

## Git workflow

- Branch: `advisor/007-upload-hardening`
- Commit 形式: conventional commits（例: `fix(upload): generate server-side object keys`）

## Steps

### Step 1: オブジェクトキーをサーバー生成にする

`utils/supabase.ts` の `uploadImage` を変更。クライアントのファイル名は使わず、拡張子だけ MIME から導出:

```ts
const EXTENSIONS: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
};

export const uploadImage = async (image: File) => {
    const ext = EXTENSIONS[image.type];
    if (!ext) throw new Error("Unsupported image type");
    const newName = `${crypto.randomUUID()}.${ext}`;
    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(newName, image, { cacheControl: "3600", contentType: image.type });
    if (error || !data) throw new Error(`Image upload failed: ${error?.message ?? "unknown"}`);
    return supabase.storage.from(bucket).getPublicUrl(newName).data.publicUrl;
};
```

（`crypto.randomUUID()` は Node 19+/Next.js サーバーで利用可。error を握りつぶさない修正も同時に行う。）

**Verify**: `bun run typecheck` → exit 0

### Step 2: MIME allowlist と画像コンテンツを検証

`utils/schemas.ts` の `validateFile` を prefix マッチから完全一致 allowlist に変更:

```ts
const acceptedFilesTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
...
return !file || acceptedFilesTypes.includes(file.type);
```

エラーメッセージも "File must be a JPEG, PNG, WebP, or GIF image." に更新。

さらに `utils/schemas.ts` に、先頭バイトを検査する非同期 `validateImageContent(file)` を追加する。JPEG (`FF D8 FF`)、PNG（8-byte signature）、GIF (`GIF87a` / `GIF89a`)、WebP（`RIFF` + offset 8 の `WEBP`）だけを認め、検出した形式が `file.type` と一致しない場合も拒否する。`utils/supabase.ts` の `uploadImage` で、この検証を `supabase.storage.upload` より前に必ず `await` するため、将来の呼び出し元も含めて未検証のバイト列を公開バケットへ保存しない。

**Verify**: `bun run test:run utils/__tests__/schemas.test.ts` → 既存 imageSchema テストの期待値更新が必要なら更新してパス

### Step 3: Supabase キー種別の調査（コード変更なし・報告のみ）

`SUPABASE_KEY` の**値は読まない・出力しない**。以下を確認して結果を報告に含める:

- Supabase ダッシュボード（オペレーター確認事項として報告に記載）: 使用中キーが anon か service_role か、バケット `home-away-app` の RLS/ポリシー設定
- service_role の場合の推奨: アップロード専用の最小権限構成（anon キー + INSERT ポリシー、または署名付きアップロード URL）への移行を推奨として記録

**Verify**: 報告文に「キー種別の確認はオペレーター作業」と明記されていること

### Step 4: テスト追加

`utils/__tests__/schemas.test.ts`:

- `image/svg+xml`（XSS ベクタになりやすい）が **reject** されること
- `application/pdf` が reject、`image/png` が accept されること
- 1MB 超が reject（既存テストがあれば重複不要）
- PNG MIME type だが JPEG ヘッダーのファイル、および PNG MIME type だが任意テキストのファイルが `validateImageContent` で reject されること
- 正しい PNG ヘッダーの `image/png` ファイルが `validateImageContent` で accept されること

**Verify**: `bun run test:run` → 全パス

## Test plan

Step 4 の3ケース + 既存回帰なし。`new File([...], "name", { type: "..." })` でフィクスチャ作成（jsdom 環境で可）。

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test:run` すべて exit 0
- [ ] `grep -n "image.name" utils/supabase.ts` が 0 件（クライアント名不使用）
- [ ] `grep -n "randomUUID" utils/supabase.ts` がヒット
- [ ] `grep -n 'startsWith' utils/schemas.ts` の MIME prefix 判定が残っていない
- [ ] SVG reject と、MIME type を偽装した無効バイト列 reject のテストが存在しパスする
- [ ] `uploadImage` が `supabase.storage.upload` の前に `validateImageContent` を await する

## STOP conditions

- 既存のアップロード済み画像 URL の表示が壊れる変更を要求された場合（本プランは**新規アップロードのみ**変更。既存 URL には触れない）。
- `crypto.randomUUID` が実行環境で未定義（Node バージョン問題 — 報告）。
- プロフィール画像に GIF/WebP 以外の形式（HEIC 等）が実運用で必要と判明した場合は allowlist を広げず報告。

## Maintenance notes

- 将来の強化候補: 画像の再エンコード（sharp）による完全なコンテンツ無害化、古い孤児オブジェクトの清掃ジョブ。
- Plan 013（画像ギャラリー）はこの `uploadImage` を複数ファイルでループ利用する予定 — シグネチャを変えた場合は Plan 013 の前提を更新すること。
- Step 3 の調査結果（キー種別）は `plans/README.md` の該当行に一行で追記する。
