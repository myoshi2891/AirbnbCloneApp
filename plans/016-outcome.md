# Plan 016 Outcome: レビュー信頼性とメッセージング

## 結論

- 新規レビューは「本人の支払い済み・宿泊完了Booking」に結び付ける。既存レビューは削除せずlegacy扱いで表示する。
- ホスト返信は1レビュー1返信で十分なためReviewのnullable fieldsとして持つ。
- メッセージングv1は1 Booking = 1 Conversationとし、参加者だけがserver action経由で読み書きする。
- 配信は10秒ポーリングから開始し、Supabase RealtimeはClerkとRLSを接続する別アーキテクチャ計画へ送る。

## 1. verified-stayゲート

Plan 014のstatus移行後、`createReviewAction`で次を満たすBookingを要求する。

```ts
const eligibleBooking = await db.booking.findFirst({
  where: {
    profileId: user.id,
    propertyId: validatedFields.propertyId,
    status: "CONFIRMED",
    checkOut: { lt: new Date() },
  },
  orderBy: { checkOut: "desc" },
  select: { id: true },
});
```

Plan 014実装前にレビュー側を先行する場合だけ`paymentStatus: true`を暫定使用し、同じPR内へTODOとstatus移行testを置く。未宿泊、自分の物件、未来のcheckOut、未認証は拒否する。

Reviewへ`bookingId String? @unique`とBooking relationを追加する。新規レビューはbookingIdを必須として保存し、既存行はnullのまま残す。UIはbookingIdありに「Verified stay」badge、nullにはbadgeなしとする。

`@@unique([profileId, propertyId])`を追加する前に、次のqueryで既存重複を検出する。

```sql
SELECT "profileId", "propertyId", COUNT(*)
FROM "Review"
GROUP BY "profileId", "propertyId"
HAVING COUNT(*) > 1;
```

重複がある場合は無条件にmigrationを進めない。各組の`createdAt`が最古、同時刻なら`id`が辞書順で最小の行を代表行とする。残りの行はrating、comment、作成日時、元Review IDを監査用の`ReviewDuplicateArchive`へコピーして内容を保持し、代表行のrating/commentは変更しない。現行schemaにはReviewを参照する子テーブルがないため参照更新は不要だが、先行変更で参照が追加済みなら削除対象Review IDを代表IDへ更新してから、archive済みの重複行だけをReviewから削除する。件数、代表ID、archive件数を検証してからunique migrationを適用する。

`createReviewAction`の事前重複チェックは代表行を含む現行Reviewだけを対象とし、archive行は対象外とする。さらにcompound unique違反も重複レビューとして処理し、並行投稿を防ぐ。migrationがunique制約追加で失敗した場合は再実行を繰り返さず、上記queryと参照整合性で原因を確認し、未整理データをarchive・統合してから再実行する。

整理完了後に`@@unique([profileId, propertyId])`を追加し、現在の事前findだけでなくDBでも1ユーザー1物件1レビューを保証する。Prismaはcompound uniqueをunique queryやupsertへ利用できる。[Prisma compound constraints](https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-composite-ids-and-constraints)

## 2. ホスト返信

推奨fields:

```prisma
model Review {
  // 既存フィールド
  bookingId    String?   @unique
  response     String?
  respondedAt  DateTime?
  booking      Booking?  @relation(fields: [bookingId], references: [id], onDelete: SetNull)

  @@unique([profileId, propertyId])
}
```

別Response modelは複数返信・編集履歴が必要になった時点で導入する。v1は`respondToReviewAction({ reviewId }, formData)`がReviewとPropertyを同時取得し、`review.property.profileId === user.id`を確認する。本文はtrim後1–1000文字、HTMLを受け付けずReactのtext描画だけを使う。初回返信のみ許可し、編集・削除は対象外とする。

## 3. レビューUI

- ReviewCardへVerified stay badge、ホスト返信本文、返信日時を追加する。
- 物件所有者かつresponseがnullの場合だけ返信フォームを表示する。
- 投稿フォームはeligible Bookingがある場合だけ表示する。サーバーアクション側でも必ず再検証する。
- 既存reviewのrating集計と表示は維持し、移行時に件数を減らさない。

## 4. メッセージモデル

v1は予約後の連絡に限定し、同一ゲストが同一物件を複数回予約した場合も履歴を分離する。

```prisma
model Conversation {
  id            String    @id @default(uuid())
  bookingId     String    @unique
  propertyId    String
  guestId       String
  hostId        String
  lastMessageAt DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  booking       Booking   @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  property      Property  @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  guest         Profile   @relation("ConversationGuest", fields: [guestId], references: [clerkId], onDelete: Cascade)
  host          Profile   @relation("ConversationHost", fields: [hostId], references: [clerkId], onDelete: Cascade)
  messages      Message[]

  @@index([guestId, lastMessageAt])
  @@index([hostId, lastMessageAt])
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  senderId       String
  body           String
  readAt         DateTime?
  createdAt      DateTime     @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         Profile      @relation(fields: [senderId], references: [clerkId], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@index([conversationId, readAt])
}
```

Profile、Property、Bookingへ対応するback relationを追加する。Conversation作成はCONFIRMED Bookingだけを対象に`bookingId` uniqueを使うupsertとし、Bookingのguest profileIdとPropertyのhost profileIdから参加者をサーバー側で設定する。クライアント指定のguestId/hostIdは受け付けない。

## 5. アクセス制御とI/O

- `conversationParticipant(userId, conversationId)`は`OR: [{ guestId: userId }, { hostId: userId }]`を含むfindFirstで毎回確認する。
- `sendMessageAction`は本文をtrimし1–2000文字でZod検証し、participant確認、Message作成、`lastMessageAt`更新をtransactionで行う。
- `fetchConversationMessages`はparticipant確認後、50件のcursor paginationで返す。senderは表示名・画像だけselectする。
- `markConversationReadAction`は`senderId != user.id AND readAt IS NULL`だけをupdateManyする。
- v1ではメッセージ編集・削除・添付・メール通知を実装しない。本文はMarkdown/HTMLへ変換せずプレーンテキスト表示する。

## 6. 配信方式

| 方式 | 長所 | 費用・リスク | 判断 |
|---|---|---|---|
| 10秒ポーリング | Clerk認証とserver action規約をそのまま使用、実装・テストが小さい | 閲覧中に定期readが発生 | v1 |
| Supabase Postgres Changes | 既存supabase-jsで低遅延 | Clerk JWTとSupabase RLSの接続、publication、接続数管理が必要 | v2候補 |
| Supabase Broadcast | 高接続数で推奨される構成 | DB trigger、private channel、Realtime Authorizationが必要 | 規模拡大時 |

message画面を表示中かつ`document.visibilityState === "visible"`の間だけ10秒ごとに`router.refresh()`し、送信成功時は即refreshする。Realtimeはメッセージ数とpeak connectionに基づく課金があり、private channelにはRLS設定が必要なため、v1の必須要件にしない。[Supabase Realtime pricing](https://supabase.com/docs/guides/realtime/pricing) [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)

## 7. 入口UIと未読集計

```text
Navbar
└─ Inbox (未読合計badge)
   └─ /messages
      ├─ Conversation list (相手、物件、最終文、時刻、未読数)
      └─ /messages/[id]
         ├─ Message history
         └─ Composer

/bookings       guest側 Message button
/reservations   host側 Message button
```

各一覧のMessage buttonはbookingIdからConversationをupsertして遷移する。InboxはConversationを1queryで取得し、未読は`message.groupBy({ by: ["conversationId"], _count: { _all: true }, where: { readAt: null, senderId: { not: user.id }, conversation: participantWhere } })`の1queryで集約してMap化する。行ごとのcountを発行しない。

## 本実装の分割案

1. **M — review trust**: additive migration、既存review維持、eligible Booking gate、DB unique、badge、host response、認可test。
2. **L — messaging core**: Conversation/Message migration、participant helpers、send/read/pagination actions、message画面。
3. **M — messaging entry/unread**: bookings/reservations入口、Inbox、batch unread、10秒polling、UI test。
4. **別スパイク — realtime/notifications**: Clerk-Supabase JWT、RLS、private Broadcast、メール/プッシュ通知を評価。

本スパイクではschema、migration、依存、Supabase設定を変更していない。
