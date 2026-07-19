# Implementation Plans

improve スキルによるコードベース監査（effort: standard、全9カテゴリ）から生成。
生成日: 2026-07-05 / 基準コミット: `21c0cbf`。

各プランは**このセッションの文脈を知らない実行者**向けに自己完結で書かれている。
実行者へ: プランを最後まで読んでから着手し、STOP conditions を尊重し、完了時に自分の行を更新すること。
下の順序で実行する（依存が許す範囲で並べ替え可）。

監査範囲の注記: `components/ui/`（shadcn 生成コード）と `node_modules` は監査対象外。
effort=standard のためホットスポット重点であり、`components/` の全 UI コンポーネントの網羅精査はしていない。

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | 検証基盤（typecheck・CI・.env.example） | P1 | S | — | DONE |
| 002 | 決済 API 所有者チェック + 予約入力検証 | P1 | S | 001 | DONE |
| 003 | 署名検証付き Stripe Webhook | P1 | M | 001 | DONE |
| 004 | 重複予約のサーバー側防止 | P1 | M | 002 | DONE |
| 005 | サーバーアクションのテストカバレッジ | P1 | L | 001 | DONE |
| 006 | エラーハンドリング統一・リーク遮断 | P2 | M | 005 | DONE |
| 007 | 画像アップロード強化 | P2 | S | 001 | TODO |
| 008 | 物件グリッドの N+1 解消 | P2 | M | 005(推奨) | TODO |
| 009 | ページネーションとキャッシュ | P3 | M | 008 | TODO |
| 010 | 依存整合（残: Prisma / ESLint / Stripe。Bun・Clerkは完了） | P2 | M | 001 | TODO |
| 011 | アクションのボイラープレート統合 | P3 | M | 005, 006 | TODO |
| 012 | ドキュメント精度（README/CLAUDE.md） | P2 | S | 003(推奨) | TODO |
| 013 | スパイク: 画像ギャラリー + 実座標マップ | P3 | M | 007 | TODO |
| 014 | スパイク: 予約ライフサイクル（enum/返金） | P3 | M | 003 | TODO |
| 015 | スパイク: ファセット検索 | P3 | S-M | 009(推奨) | TODO |
| 016 | スパイク: レビュー信頼性 + メッセージング | P3 | M | — | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

## Dependency notes

- **001 が全プランの前提**: typecheck スクリプトと CI がないと、どのプランも Done criteria を機械検証できない。
- 2026-07-19以降、依存管理はBun 1.3.12と`bun.lock`へ一本化。Plan 001/010の二重ロックファイル記述は廃止済み。
- 004 は 002 の後: 重複チェックは検証済みの日付入力（`createBookingSchema`）を前提にする。
- 006 と 011 は 005 の後: `utils/actions.ts` のリファクタは特性テストという安全網を先に敷く（テストなしのリファクタは盲目出荷）。
- 012 は 003 の後が効率的: webhook 実装後なら「Webhook で確定」という既存ドキュメント記述が真実になり、修正が小さい。003 を実施しない決定をした場合は 012 を先行させ「webhook ではない」旨に修正する。
- 014 は 003 必須: サーバー権威の確定イベント（webhook）なしに状態機械は設計できない。
- direction スパイク（013-016）の成果物は設計文書。本実装プランは各 outcome を入力に改めて起票する。

## 監査サマリー（vetted findings の出典）

| カテゴリ | 主な発見 → プラン |
|----------|------------------|
| security | webhook 不在(→003)、決済 IDOR + 予約入力未検証 + favorite 削除 IDOR(→002)、重複予約(→004)、アップロード(→007) |
| correctness | エラーメッセージリーク、email 無ガード参照(→006) |
| perf | グリッド N+1 ×2、rentals の 2N aggregate、over-fetch(→008)、無制限 findMany・キャッシュ不在(→009) |
| tests | actions.ts テストゼロ、課金額アサーションなし、typecheck/CI なし(→001, 005) |
| tech-debt | 13×ボイラープレート、3流派のエラー処理、デッド設定(→006, 011) |
| deps | Prisma CLI v5 × client v6、Stripe apiVersion 未指定、ESLint 8 EOL ほか(→010) |
| dx | CI なし、typecheck なし、.env.example なし(→001) |
| docs | 「Webhook」「multi-stage」記述が実装と不一致、バージョン表ズレ(→012) |
| direction | ギャラリー・実座標(→013)、予約ライフサイクル(→014)、ファセット検索(→015)、レビュー信頼性・メッセージング(→016) |

## Findings considered and rejected

- **`utils/actions.ts` への全ロジック集中**: CLAUDE.md に記録された設計判断（by-design）。内部品質の問題（ボイラープレート）のみ 011 で扱う。
- **`.env` がリポジトリに存在**: gitignore 済みで git 追跡なし（`git ls-files` 確認済み）。コミット済みシークレットの所見なし。
- **`https_proxy` 等の環境変数尊重系**: 該当なし（確認済み）。
- **API Route テストのモック依存（TESTS-05）**: 妥当な指摘だが、実 DB 統合テスト基盤の導入は費用対効果と CI 複雑性から今回は見送り。005 の Maintenance notes に将来課題として記録。
- **admin ダッシュボードのクエリ最適化**: 管理者1名のみが使う低頻度画面であり、レバレッジ不足。not worth doing。
- **`SUPABASE_KEY` の権限種別**: コードから判別不能（LOW confidence）。007 の Step 3 で調査項目化（オペレーター確認事項）。
- **README の「今後の拡張計画」（i18n / React Native / AI 推奨）**: リポジトリ内の実装痕跡がなく、direction の grounding rule（汎用提案は noise）により今回はプラン化せず。維持者が優先すると決めれば 013-016 と同様のスパイクとして起票可能。
