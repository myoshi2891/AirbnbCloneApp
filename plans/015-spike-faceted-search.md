# Plan 015: 設計スパイク — ファセット検索（価格・人数・国・日程で絞り込み）

> **Executor instructions**: これは**設計スパイク**であり、本実装プランではない。
> 成果物は設計文書（`plans/015-outcome.md`）。プロトタイプは使い捨てブランチ限定。
> STOP conditions 発生時は停止して報告。完了時は `plans/README.md` を更新。
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- utils/actions.ts components/navbar/ components/home/`
> Plan 009（ページネーション）実施済みなら fetchProperties の形が変わっている — 想定内。

## Status

- **Priority**: P3
- **Effort**: S-M（スパイク。本実装は M）
- **Risk**: LOW
- **Depends on**: plans/009-pagination-and-caching.md（推奨 — クエリ形状が確定してから）
- **Category**: direction
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters（根拠 — このリポジトリ固有の証拠）

- 検索は `fetchProperties`（`utils/actions.ts:174-203`）の `name`/`tagline` に対する `contains` + カテゴリのみ。`components/navbar/NavSearch.tsx` は単一フリーテキスト入力。
- 一方、**絞り込みに必要なフィールドはスキーマに全部ある**: `price`, `guests`, `bedrooms`, `beds`, `baths`, `country`（`prisma/schema.prisma:37-41`）。日程の空き判定も `Booking` の期間クエリで可能（Plan 004 と同じ overlap 条件の反転）。
- `README.md` は「検索・フィルタリング可能な物件カタログ」を謳っており、空一覧の `EmptyList` コンポーネントは存在しないフィルタの変更を促す文言を出す。**stated-but-undelivered** かつ、データモデル的に不釣り合いに安い価値。宿探しの中核ループ（条件で絞る）が欠けている。

## Current state

- `fetchProperties` の where（21c0cbf 時点）:

```ts
where: {
    ...(category ? { category } : {}),
    OR: [
        { name: { contains: search, mode: "insensitive" } },
        { tagline: { contains: search, mode: "insensitive" } },
    ],
},
```

- searchParams の配管は既に存在: `app/page.tsx` → `PropertiesContainer` が `category`/`search` を受けて `fetchProperties` に渡す（Next 15 なので `searchParams` は `await` される Promise）
- カテゴリ UI: `components/home/CategoriesList.tsx` が searchParams ベースのリンクで実装済み — **フィルタ UI の手本パターン**
- `use-debounce` 導入済み（NavSearch で使用中）— 価格スライダー等に再利用可
- 国データ: `utils/countries.ts`（world-countries ラッパー）が选択肢ソースになる

## スパイクで答えを出す問い

1. **フィルタの最小セット**: v1 は `priceMin/priceMax`, `guests`, `country`, `checkIn/checkOut`（日程空き）で足りるか。bedrooms/beds/baths は v2 に送るか。
2. **日程フィルタのクエリ**: 「期間が空いている物件」= `NOT EXISTS (booking WHERE overlap AND paid)` を Prisma で表現する形（`bookings: { none: { checkIn: { lt }, checkOut: { gt }, paymentStatus: true } }`）の動作確認と、Plan 014 の status enum 移行後の書き換え箇所の特定。
3. **URL 設計**: すべて searchParams（`?category=&search=&priceMax=&guests=&country=&checkIn=&checkOut=&page=`）で表現し、既存の category/search/page と衝突しない命名。共有可能な URL になること。
4. **UI 配置**: CategoriesList の下にフィルタバー（Popover + フォーム、shadcn/ui の既存プリミティブで構成可能か部品棚卸し）。モバイル表示の扱い。
5. **キャッシュ整合**: Plan 009 の `unstable_cache` キーにフィルタ引数が全部乗るか（シグネチャ経由なら自動 — 確認のみ）。日程フィルタ付き結果はキャッシュ対象にしてよいか（予約発生で無効化されないと古い空きを見せる — `revalidateTag("properties")` を booking 確定にも張る案の評価）。

## 進め方

1. 問い2 のクエリは使い捨てブランチ `spike/015-search` で `bunx prisma studio` + 手元データで検証（migrate 不要 — 既存スキーマで完結するのがこのスパイクの強み）
2. 問い4 は `components/ui/` の棚卸し（popover, select, checkbox は存在確認済み）とワイヤー1枚（テキストで可）
3. 成果物を `plans/015-outcome.md` に記録: フィルタ最小セットの決定、Prisma where の確定形、URL スキーマ、UI 部品リスト、本実装プラン1本分のステップ概要と工数（M 想定）

## Done criteria

- [ ] `plans/015-outcome.md` が存在し、5問すべてに回答している
- [ ] 日程空きクエリの Prisma 表現が動作確認済みの形で記載されている
- [ ] URL パラメータ表が含まれる
- [ ] main 系へのコード変更ゼロ

## STOP conditions

- `bookings: { none: ... }` 形式が Prisma クライアントのバージョン都合で期待通り動かない場合（raw query 案に切り替えて評価し、報告）。
- Plan 009 未実施で fetchProperties の戻り値形が不確定なまま設計が二重化する場合（009 を先に、と報告してよい）。

## Maintenance notes

- 本実装時は `fetchProperties` の引数が7個を超える — オブジェクト引数 + Zod スキーマ（searchParams 検証。外部入力なので必須）で受けること。
- 日程フィルタは Plan 004（重複判定）と同じ overlap 述語の反転 — 定義を共有ユーティリティに切り出すと二重管理を防げる。
