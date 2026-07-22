# Plan 013 Outcome: 物件画像ギャラリーと実座標マップ

## 結論

- 画像は順序と個別削除を持てる`PropertyImage`リレーションで管理する。PostgreSQLの`String[]`もPrismaで利用できるが、要素単位の識別子・並び順制約・将来のalt textを持てないため採用しない。
- `Property.image`は移行期間だけcover画像として残し、全消費先をrelationへ移した次のmigrationで削除する。
- 座標はホストがLeaflet地図をクリックして入力する。外部geocoding APIはv1で導入しない。
- 正確な座標はDBへ保存するが、未予約の閲覧者には小数第2位へ丸めた概略位置だけを表示する。

## 1. 画像データモデル

推奨schema案:

```prisma
model Property {
  // 既存フィールド
  image      String          // 移行中のcover画像。最終段階で削除
  images     PropertyImage[]
  latitude   Float?
  longitude  Float?
  address    String?
}

model PropertyImage {
  id         String   @id @default(uuid())
  propertyId String
  url        String
  position   Int
  createdAt  DateTime @default(now())
  property   Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@unique([propertyId, position])
  @@index([propertyId])
}
```

`String[]`はPostgreSQLで利用でき、配列全体のsetや単一値のpushは可能。ただし今回必要な並べ替え、特定画像の削除、画像別メタデータにはrelationが適する。[Prisma scalar lists](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-scalar-lists-arrays)

取得は`images: { orderBy: { position: "asc" } }`、並べ替えはtransaction内で一時的な退避positionを使ってunique衝突を避ける。画像は最大10枚、各1 MB、合計10 MBとする。

## 2. 後方互換とバックフィル

段階移行を採る。

1. nullable座標と`PropertyImage`を追加し、既存`Property.image`をposition 0へバックフィルする。
2. 詳細ページは`images`を描画し、カード・Stripe商品画像は先頭画像へ切り替える。作成・更新時は移行期間だけ`Property.image`も先頭URLへ同期する。
3. 全行に画像relationがあり、旧フィールド参照が0件になったことを確認して`Property.image`を削除する。

SQL素案:

```sql
INSERT INTO "PropertyImage" ("id", "propertyId", "url", "position", "createdAt")
SELECT gen_random_uuid()::text, "id", "image", 0, NOW()
FROM "Property"
WHERE "image" <> ''
ON CONFLICT ("propertyId", "position") DO NOTHING;
```

バックフィル前後でProperty件数、空URL件数、position 0件数を照合する。migrationは本スパイクでは実行していない。

## 3. アップロードとギャラリーUI

- `<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif">`を使い、既存`imageSchema`と`validateImageContent`を各ファイルへ適用してから`uploadImage`を順次呼ぶ。
- 1件でも検証に失敗した場合はアップロードを開始しない。storage成功後のDB書き込みはtransaction化し、失敗時のstorage孤児はログへ残して清掃ジョブの対象にする。
- 詳細ページはdesktopで先頭1枚＋最大4枚のgrid、mobileでcarouselとする。
- shadcn CarouselはEmbla依存でswipe・keyboard操作を提供するため第一候補。ただし`embla-carousel-react`は本実装計画で承認を得てから追加する。[shadcn Carousel](https://ui.shadcn.com/docs/components/radix/carousel)
- 依存追加を避ける場合はCSS scroll snapが代替だが、focus管理と前後ボタンを自前実装する分だけ保守費が増える。

## 4. 座標schemaと既存データ

`latitude Float?`、`longitude Float?`、`address String?`をnullableで追加する。既存行はnullのままとし、表示時は現在と同じ国重心へフォールバックする。入力検証はlatitude -90..90、longitude -180..180、address 200文字以下とする。

## 5. 座標取得方式

| 方式 | 費用・制約 | 判断 |
|---|---|---|
| Leaflet地図クリック | 既存依存だけで実装可能。click eventから`latlng`を取得できる | v1で採用 |
| ホストの緯度経度直接入力 | 依存なしだが入力体験が悪い | デバッグ用fallback |
| Nominatim geocoding | 公開サービスは最大1 req/s、識別User-Agent、attributionが必要 | v1では不採用 |
| 商用geocoding | API key、課金、利用規約確認が必要 | 利用規模確定後に再評価 |

Leafletはmap click eventの`latlng`を公開しているため、既存React Leaflet上でMarkerを移動してhidden inputへ反映できる。[Leaflet events](https://leafletjs.com/reference) Nominatim公開APIは容量制約が明確なため、フォーム入力の中核にはしない。[Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/)

## 6. 位置プライバシー

- DBにはホストが指定した正確な座標を保存する。
- 物件所有者と支払い済みBookingを持つゲストだけ正確なMarkerを受け取る。
- その他の閲覧者には緯度経度を小数第2位へ丸めた安定した概略位置を返し、UIへ「予約確定後に正確な場所を表示」と明記する。
- `address`も同じ認可条件で返し、公開レスポンスやカードselectには含めない。

## 本実装の分割案

1. **M**: `PropertyImage`とnullable座標のmigration、既存画像バックフィル、読み取り互換層。
2. **M**: 最大10枚の入力・検証・保存・並び替えとcover同期。
3. **M**: desktop grid/mobile carousel、カードとStripe画像のrelation移行。
4. **S-M**: 地図クリック入力、概略/正確座標の認可付き表示。
5. **S**: 旧`Property.image`削除とキャッシュタグ回帰確認。

全体見積は **L**。本スパイクでは依存追加、schema変更、migration、外部API呼び出しを行っていない。
