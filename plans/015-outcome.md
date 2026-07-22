# Plan 015 Outcome: ファセット検索

## 結論

v1は既存schemaだけで実装できる`priceMin`、`priceMax`、`guests`、`country`、`checkIn`、`checkOut`を採用する。bedrooms/beds/bathsは利用状況を見てv2へ送る。全条件をURL searchParamsへ保存し、日程を含む検索だけは物件一覧キャッシュを迂回する。

## 1. フィルタ最小セット

| フィルタ | 型・制約 | Prisma条件 |
|---|---|---|
| priceMin | 0–1,000,000の整数 | `price.gte` |
| priceMax | 0–1,000,000の整数、priceMin以上 | `price.lte` |
| guests | 1–50の整数 | `guests.gte` |
| country | `utils/countries.ts`に存在するcountry code | `country.equals` |
| checkIn/checkOut | 両方指定または両方省略、東京営業日で未来、out > in | Booking relationの`none` |

既存`search`、`category`、`page`も同じZod objectで検証する。空文字はundefinedへ正規化し、不正な個別filterは検索全体を失敗させずそのfilterだけ省略する。日程は片方だけなら両方を無効化し、UIに入力エラーを表示する。

## 2. 日程空きクエリ

現行Boolean schemaで動作確認済みの条件:

```ts
const where: Prisma.PropertyWhereInput = {
  ...(category ? { category } : {}),
  ...(priceMin !== undefined || priceMax !== undefined
    ? { price: { gte: priceMin, lte: priceMax } }
    : {}),
  ...(guests ? { guests: { gte: guests } } : {}),
  ...(country ? { country } : {}),
  ...(checkIn && checkOut
    ? {
        bookings: {
          none: {
            checkIn: { lt: checkOut },
            checkOut: { gt: checkIn },
            paymentStatus: true,
          },
        },
      }
    : {}),
  OR: [
    { name: { contains: search, mode: "insensitive" } },
    { tagline: { contains: search, mode: "insensitive" } },
  ],
};
```

2026-07-22にPrisma Client 6.6.0からSupabaseへ`take: 1`の読み取り専用queryを発行し、`bookings: { none: { overlap, paymentStatus: true } }`が成功することを確認した。データ内容やIDは出力していない。

Plan 014実装後は内側を次へ置換する。

```ts
OR: [
  { status: "CONFIRMED" },
  { status: "PENDING", expiresAt: { gt: now } },
]
```

overlap定義は予約作成と検索で同じ`checkIn < requestedCheckOut && checkOut > requestedCheckIn`を使うため、共有helperへ切り出して境界テストを共用する。

## 3. URL契約

| Parameter | 例 | 省略時 |
|---|---|---|
| `search` | `lake` | 全文言 |
| `category` | `cabin` | 全カテゴリ |
| `priceMin` | `100` | 下限なし |
| `priceMax` | `500` | 上限なし |
| `guests` | `4` | 制限なし |
| `country` | `JP` | 全地域 |
| `checkIn` | `2030-06-20` | 日程filterなし |
| `checkOut` | `2030-06-25` | 日程filterなし |
| `page` | `2` | 1 |

URLは`/?category=cabin&search=lake&priceMax=500&guests=4&country=JP&checkIn=2030-06-20&checkOut=2030-06-25&page=2`の形とする。Apply/Clear、検索文字、カテゴリ変更時は`page`を削除して1へ戻す。未知parameterは保持せず、定義済みparameterだけを再構築する。

## 4. UI

既存のPopover、Select、Input、Calendar、Buttonを再利用し、新規依存は追加しない。

```text
CategoriesList
└─ Filter bar
   ├─ Price: min / max number inputs
   ├─ Guests: Select
   ├─ Country: searchableでない既存Select
   ├─ Dates: Calendar range
   ├─ Apply filters
   └─ Clear filters
```

desktopは横並びボタンからPopoverを開き、mobileは同じPopover contentを画面幅内の縦1列にする。適用済み条件数をFilterボタンへbadge表示する。フォーム送信はGET navigationとし、入力途中にqueryを発行しない。

## 5. キャッシュ整合

- search/category/price/guests/countryだけの結果は、全引数を`fetchPropertiesCached`へ渡して既存`properties`タグと300秒TTLを使う。
- checkIn/checkOutがある場合は`unstable_cache`を通さず直接queryする。予約確定直後に古い空室を見せるリスクを避け、日付ごとの高カーディナリティcacheも作らない。
- 物件変更時の`revalidateTag("properties")`は維持する。Plan 014実装後も日程検索は非cacheなので、Booking mutationを同タグへ結合する必要はない。
- rating/favorite/auth依存データは引き続きcache外で一覧IDに対してbatch取得する。

## 本実装計画

1. **S**: `propertySearchSchema`とURL正規化helper、境界・組み合わせtestを追加。
2. **S-M**: `fetchProperties`へfilter objectとavailability relation条件を追加し、日程有無でcached/direct queryを分岐。
3. **M**: Filter bar、GET navigation、active count、Clear/page reset、mobile配置を実装。
4. **S**: Prisma where、URL保持、cache分岐、空結果、overlap境界の回帰testを追加。

全体見積は **M**。本スパイクではsource変更、依存追加、DB書き込みを行っていない。
