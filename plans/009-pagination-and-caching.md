# Plan 009: 一覧クエリのページネーションと読み取りキャッシュ戦略

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- utils/actions.ts app/page.tsx components/home/`
> Plan 008 による fetchProperties 周辺の差分は想定内。

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/008-eliminate-grid-n-plus-1.md
- **Category**: perf
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

すべての一覧クエリ（物件カタログ・お気に入り・予約・レビュー・reservations）が `findMany` を **`take`/`skip`/cursor なし**で発行し、テーブル全件を取得して全件レンダリングする。データ量に比例してレスポンスとメモリが劣化する。また読み取り側のキャッシュ指示（`unstable_cache` / route `revalidate`）がリポジトリ全体でゼロであり、安定データ（物件一覧・レーティング）も毎リクエスト Postgres に到達する。

## Current state

- 無制限 `findMany` の箇所（`utils/actions.ts`）:
  - `fetchProperties`: 174-203（ホーム/検索 — 最優先）
  - `fetchFavorites`: 258-279
  - `fetchBookings`: 468-489
  - `fetchPropertyReviews`: 326-347
  - `fetchReservations`: 631-656
- キャッシュ: `grep -rn "unstable_cache\|revalidate =" utils/ app/` → 0件。ミューテーション側の `revalidatePath` のみ存在（`utils/actions.ts` 内 8箇所以上）。
- ホームの消費側: `app/page.tsx` → `components/home/PropertiesContainer.tsx` → `PropertiesList`。searchParams（`category`, `search`）は既にスレッドされている（Next 15 なので `searchParams` は Promise — `await` 済みのはず）。

## Design decision

- ページングは **「Load more」方式（offset ベース、`take`/`skip`）** を採用。カーソルよりシンプルで、`orderBy: createdAt desc` の既存並びと相性が良く、この規模で十分。ページサイズは 24。
- キャッシュは**匿名・安定データのみ**対象: `fetchProperties`（検索/カテゴリキー付き）に `unstable_cache` + タグ `"properties"` を付け、物件の create/update/delete アクションで `revalidateTag("properties")`。**ユーザー固有データ（favorites/bookings/reservations/auth 依存の Map）はキャッシュしない** — Clerk コンテキスト混入は事故の元。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0              |
| Tests     | `bun run test:run`   | all pass            |
| Dev 確認  | `bun run dev`        | ホームで Load more が機能 |

## Scope

**In scope**:
- `utils/actions.ts`（一覧フェッチャ5つへの `take`/`skip` 引数追加、`fetchProperties` のキャッシュ化、mutation への `revalidateTag` 追加）
- `app/page.tsx`（`page` search parameter を `PropertiesContainer` に渡す）
- `components/home/PropertiesContainer.tsx` / `PropertiesList.tsx`（Load more UI）
- `utils/schemas.ts` / `utils/__tests__/schemas.test.ts`（page parameter の検証）
- 各一覧ページ（`app/favorites/page.tsx`, `app/bookings/page.tsx`, `app/reservations/page.tsx`）— 初期ページサイズ適用のみでも可
- `utils/__tests__/actions.test.ts`（テスト追加）

**Out of scope**:
- レビュー一覧の UI ページング（`fetchPropertyReviews` は `take` デフォルト適用のみ）
- 検索インデックス・全文検索（Plan 015 の設計スパイク側）
- admin ダッシュボードのクエリ

## Git workflow

- Branch: `advisor/009-pagination-caching`
- Commit 形式: conventional commits（例: `perf(list): add pagination to unbounded findMany queries`）

## Steps

### Step 1: フェッチャに take/skip を追加

`fetchProperties` のシグネチャを拡張（後方互換 — デフォルト値で既存呼び出しは無変更で動く）:

```ts
export const fetchProperties = async ({
    search = "",
    category,
    take = 24,
    skip = 0,
}: { search?: string; category?: string; take?: number; skip?: number }) => {
    const properties = await db.property.findMany({
        where: { ... 既存 ... },
        select: { ... 既存 ... },
        orderBy: { createdAt: "desc" },
        take: take + 1,   // hasMore 判定のため 1 件多く取る
        skip,
    });
    const hasMore = properties.length > take;
    return { properties: properties.slice(0, take), hasMore };
};
```

**戻り値の形が変わる**ため、呼び出し元（`PropertiesContainer` 等）を同時に更新する。他の4フェッチャ（favorites/bookings/reviews/reservations）は `take = 50` デフォルトの引数追加のみ（戻り値形は不変）。

**Verify**: `bun run typecheck` → exit 0

### Step 2: Load more UI

`app/page.tsx` で raw `searchParams` 全体を正規化し、raw `page` と現行 query を `PropertiesContainer` に渡す。リポジトリ既存の Zod validation approach に従い、`utils/schemas.ts` に `z.coerce.number().int().min(1).max(100)` を用いる page schema を追加する。`PropertiesContainer` は `safeParse` し、失敗時（空、非数、少数、0以下、100超）は page 1 にフォールバックしてから `skip = (sanitizedPage - 1) * 24` を計算する。これにより最大 skip は 2,376 に制限される。`hasMore && sanitizedPage < 100` のときだけ「Load more」リンクを表示し、`<Link href={{ query: { ...query, page: sanitizedPage + 1 } }}>` で `category`・`search` を含む現行 query を維持する。これにより page 100 で page 101 を生成して page 1 へ戻るループを防ぐ。サーバーコンポーネントのみで完結させ、クライアント状態は持たない（このリポジトリの Server-first 規約に合わせる）。

注記: 「追記型の無限スクロール」はクライアント化が必要になるため採らない。ページ置き換え型で十分。

**Verify**: `bun run dev` → 物件が24件超あるとき Load more が表示され、クリックで次ページに切り替わる（テストデータが少ない場合は `take` を一時的に 2 にして手元確認し、戻す）

### Step 3: fetchProperties をキャッシュ化

```ts
import { unstable_cache } from "next/cache";

const fetchPropertiesCached = unstable_cache(
    async (args: { search: string; category: string | undefined; take: number; skip: number }) => {
        /* 既存のクエリ本体 */
    },
    ["fetch-properties"],
    { tags: ["properties"], revalidate: 300 }
);
```

物件を変更する3アクション（`createPropertyAction`, `updatePropertyAction`, `updatePropertyImageAction`, `deleteRentalAction`）に `revalidateTag("properties")` を追加（`next/cache` から import）。

**Verify**: `bun run typecheck` → exit 0。`bun run dev` で物件作成→ホームに即反映されること（revalidateTag の動作確認）

### Step 4: テスト

- `fetchProperties`: `take+1` 件返るモックで `hasMore: true` と `properties.length === take` になること / ちょうど `take` 件で `hasMore: false`
- mutation テスト（Plan 005 のもの）に `revalidateTag` 呼び出しのアサーション追加
- page schema: `1` と `100` を accept、`0`、負数、少数、非数、`101` を reject すること
- `PropertiesContainer`: `hasMore: true` でも page 100 では Load more リンクを表示しないこと、および page 99 のリンクが `category`・`search` を保持して page 100 を設定すること

**Verify**: `bun run test:run` → 全パス

## Test plan

Step 4 の4ケース + 既存回帰なし。`next/cache` の共有モックは `vi.hoisted()` で先に定義し、`vi.mock` の factory とアサーションの両方で同じ関数を参照する:

```ts
const { mockRevalidatePath, mockRevalidateTag } = vi.hoisted(() => ({
    mockRevalidatePath: vi.fn(),
    mockRevalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
    unstable_cache: (fn: <T>(...args: T[]) => unknown) => fn,
    revalidatePath: mockRevalidatePath,
    revalidateTag: mockRevalidateTag,
}));
```

各 mutation テストでは inline の `vi.fn()` ではなく `mockRevalidateTag` と `mockRevalidatePath` をアサートする。

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test:run` すべて exit 0
- [ ] `utils/actions.ts` の一覧フェッチャ5つすべてに `take` が存在（`grep -n "take" utils/actions.ts`）
- [ ] `grep -n "unstable_cache" utils/actions.ts` がヒットし、対象が `fetchProperties` のみ
- [ ] `grep -c "revalidateTag" utils/actions.ts` ≥ 4
- [ ] page parameter が 1–100 の整数以外なら page 1 へフォールバックし、skip が 2,376 を超えないテストがパスする
- [ ] ホームの Load more が dev で動作（手動確認記録）

## STOP conditions

- `unstable_cache` 内で Clerk の `auth()`/`currentUser()` に依存するコードパスが混入してしまう構造だと判明した場合（Plan 008 適用後の `fetchProperties` は auth 非依存のはず。依存があれば設計が変わっているので停止）。
- `fetchProperties` の戻り値形変更の影響が3ファイルを超えて波及する場合（呼び出し元が増えている — 報告）。
- Next.js のバージョンで `unstable_cache` の API が変わっている場合。

## Maintenance notes

- Plan 015（ファセット検索スパイク）が確定したら、キャッシュキーにフィルタ引数を必ず含めること（`unstable_cache` はクロージャ引数を自動でキーに含める — シグネチャ経由で渡す限り安全）。
- `revalidate: 300` は「タグ失効に加えた保険の TTL」。レーティング（レビュー投稿）はタグ対象外なので最大5分古い可能性がある — 許容と判断。厳密化するなら `createReviewAction` にも `revalidateTag("properties")` を足す。
- レビュアーの重点: キャッシュ境界にユーザー固有データが入っていないこと。
