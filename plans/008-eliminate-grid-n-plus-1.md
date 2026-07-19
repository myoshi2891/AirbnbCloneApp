# Plan 008: 物件グリッドの N+1 クエリを解消する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 21c0cbf..HEAD -- utils/actions.ts components/card/ components/home/ app/favorites/ app/properties/`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/005-server-actions-test-coverage.md（推奨。特性テストが安全網になる）
- **Category**: perf
- **Planned at**: commit `21c0cbf`, 2026-07-05

## Why this matters

物件グリッド（ホーム/検索/お気に入り）は、カード1枚ごとに (a) レーティング集計 `db.review.groupBy` と (b) ログイン時は `auth()` + `db.favorite.findFirst` を発行する。24件表示なら 1（一覧）+ 24（rating）+ 24（favorite）+ 24（auth 解決）。カタログが増えるほど線形に悪化する、典型的な per-card N+1。加えてホストダッシュボードの `fetchRentals` は物件ごとに aggregate を2回発行し（2×N）、物件詳細は全カラムの `profile` を include して未使用の PII（email 等）までサーバーレンダリングに載せている。

## Current state

- `components/card/PropertyRating.tsx:10` — カードごとに `await fetchPropertyRating(propertyId)`。実体は `utils/actions.ts:387-405` の `db.review.groupBy`（propertyId 1件分）。
- `components/card/FavoriteToggleButton.tsx:14-18` — カードごとに `await auth()` → `fetchFavoriteId({ propertyId })`（`utils/actions.ts:205-221` の `favorite.findFirst`）。
- `components/home/PropertiesList.tsx` — `properties.map(...)` で `PropertyCard` を並べ、`PropertyCard`（`components/card/PropertyCard.tsx`）内で上記2コンポーネントを描画。
- `utils/actions.ts:508-549` — `fetchRentals`: `Promise.all(rentals.map(...))` 内で `db.booking.aggregate` を **totalNights と orderTotal で別々に** 2回/物件。
- `utils/actions.ts:281-298` — `fetchPropertyDetails`: `include: { profile: true }` で全カラム取得。ページ側（`app/properties/[id]/page.tsx`）が使うのは `firstName` / `profileImage` / `clerkId` のみ。
- グリッドは `app/page.tsx`（ホーム）と `app/favorites/page.tsx` で使用。

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0              |
| Tests     | `bun run test:run`   | all pass            |
| Lint      | `bun run lint`       | exit 0              |
| Dev 確認  | `bun run dev`        | ホーム/お気に入り/詳細/rentals が描画される |

## Scope

**In scope**:
- `utils/actions.ts`（`fetchProperties` 拡張、`fetchPropertyRatings`(複数形) 追加、`fetchFavoriteIdsForProperties` 追加、`fetchRentals` の groupBy 化、`fetchPropertyDetails` の select 化）
- `components/card/PropertyCard.tsx` / `PropertyRating.tsx` / `FavoriteToggleButton.tsx`（props 受け取り化）
- `components/home/PropertiesList.tsx`
- `app/favorites/page.tsx` / `app/properties/[id]/page.tsx`（呼び出し調整）
- `utils/__tests__/actions.test.ts`（テスト追加）

**Out of scope**:
- ページネーション・キャッシュ（Plan 009）
- `toggleFavoriteAction`（ミューテーション側は無変更）
- 物件詳細ページの `PropertyRating`（inPage 表示）— 単発ページなので N+1 ではない。バッチ版に乗せてもよいが必須ではない

## Git workflow

- Branch: `advisor/008-grid-n-plus-1`
- Commit 形式: conventional commits（例: `perf(properties): batch rating and favorite queries for grids`）

## Steps

### Step 1: バッチ版フェッチャを追加

`utils/actions.ts` に追加:

```ts
export const fetchPropertyRatings = async (propertyIds: string[]) => {
    const results = await db.review.groupBy({
        by: ["propertyId"],
        _avg: { rating: true },
        _count: { rating: true },
        where: { propertyId: { in: propertyIds } },
    });
    return new Map(
        results.map((r) => [
            r.propertyId,
            { rating: r._avg.rating?.toFixed(1) ?? "0", count: r._count.rating },
        ])
    );
};

export const fetchFavoriteIdsForProperties = async (propertyIds: string[]) => {
    const { userId } = await auth();
    if (!userId) return new Map<string, string>();
    const favorites = await db.favorite.findMany({
        where: { propertyId: { in: propertyIds }, profileId: userId },
        select: { id: true, propertyId: true },
    });
    return new Map(favorites.map((f) => [f.propertyId, f.id]));
};
```

注意: `fetchFavoriteIdsForProperties` は `getAuthUser()` ではなく `auth()` を使う — 未ログイン閲覧者もグリッドを見るため、throw/redirect してはならない（既存の `FavoriteToggleButton` が `auth()` で分岐している設計に合わせる）。

**Verify**: `bun run typecheck` → exit 0

### Step 2: リスト→カードへ props で流す

`PropertiesList.tsx` を async 化し、`properties` の id 配列で両バッチフェッチャを1回ずつ呼び、`PropertyCard` に `rating={ratings.get(property.id)}` / `favoriteId={favorites.get(property.id) ?? null}` / `isSignedIn` を渡す。`PropertyRating` と `FavoriteToggleButton` は fetch をやめて props 描画専用にする（`FavoriteToggleButton` は `isSignedIn` false なら `CardSignInButton`）。

物件詳細ページ（inPage 用途）で `PropertyRating` を単発利用している箇所は、`fetchPropertyRating`（単数形・既存）を**ページ側で**呼んで props を渡す形に揃える。

**Verify**: `bun run typecheck` → exit 0、`bun run dev` でホームグリッドの rating/ハートが従来どおり表示される

### Step 3: `fetchRentals` を groupBy 1回に

`utils/actions.ts:521-547` の `Promise.all` ループを置き換え:

```ts
const sums = await db.booking.groupBy({
    by: ["propertyId"],
    where: { propertyId: { in: rentals.map((r) => r.id) }, paymentStatus: true },
    _sum: { totalNights: true, orderTotal: true },
});
const sumMap = new Map(sums.map((s) => [s.propertyId, s._sum]));
return rentals.map((rental) => ({
    ...rental,
    totalNightsSum: sumMap.get(rental.id)?.totalNights ?? null,
    orderTotalSum: sumMap.get(rental.id)?.orderTotal ?? null,
}));
```

（戻り値の形は既存と同一に保つ — `app/rentals/page.tsx` の消費側を壊さない。）

**Verify**: `bun run typecheck` → exit 0

### Step 4: `fetchPropertyDetails` の profile を select 化

`include: { profile: true }` → `include: { profile: { select: { firstName: true, profileImage: true, clerkId: true } }, bookings: {...既存} }`。ページ側の型エラーが出た場合、使用フィールドが本当にこの3つだけか `grep -n "profile\." app/properties/[id]/page.tsx components/properties/` で確認して select に追加する。

**Verify**: `bun run typecheck` → exit 0

### Step 5: テスト

`utils/__tests__/actions.test.ts` に追加:

- `fetchPropertyRatings`: groupBy が `propertyId: { in: [...] }` で1回だけ呼ばれ、Map が正しく引ける
- `fetchFavoriteIdsForProperties`: 未ログインで DB 未呼び出し・空 Map
- `fetchRentals`: `booking.groupBy` が1回、`booking.aggregate` が呼ばれない

**Verify**: `bun run test:run` → 全パス

## Test plan

Step 5 の3ケース + 既存回帰なし。最終確認として `bun run dev` でホーム / お気に入り / 物件詳細 / rentals の4画面を目視。

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test:run` すべて exit 0
- [ ] `grep -n "fetchPropertyRating(" components/card/PropertyRating.tsx` が 0 件（カード内 fetch 消滅）
- [ ] `grep -n "fetchFavoriteId(" components/card/FavoriteToggleButton.tsx` が 0 件
- [ ] `grep -c "booking.aggregate" utils/actions.ts` が `fetchRentals` 内で 0（`fetchReservationStats` の1件は残る）
- [ ] `grep -n "profile: true" utils/actions.ts` が 0 件

## STOP conditions

- `PropertyCard` が Client Component であることが判明し、Map をシリアライズして渡せない場合（設計を props のプリミティブ値に変えて続行してよいが、報告すること）。
- 物件詳細ページで profile の追加フィールドが3つ以上必要と判明し、select が事実上 include と同じになる場合。
- Step 2 で Suspense 境界（`components/home/` にローディング UI がある場合）の挙動が変わる場合。

## Maintenance notes

- Plan 009 のページネーション導入時、バッチフェッチャはページ内の id 配列に対してのみ動くため相性が良い（設計済み）。
- レビュアーの重点: 未ログイン時のグリッド表示（favorite ボタンがサインインボタンになるか）、rating 0 件物件の非表示挙動（`count === 0 → null`）が維持されているか。
