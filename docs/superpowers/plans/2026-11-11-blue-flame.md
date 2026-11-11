# Blue Flame Implementation Plan

**Goal:** 選択・保存できる青い炎のテーマを追加し、PR と起動済みローカル環境を提供する。
**Architecture:** daisyUI のカラートークンと装飾コンポーネントを分離。既存 color-mode が有効テーマを決める。
**Tech Stack:** Nuxt 3, Vue 3, TypeScript, Canvas 2D
**Spec:** ../specs/2026-11-11-blue-flame-design.md

## Constraints / Review focus
- 初期 `dash`、既存テーマ、時計・タイマー・設定操作を保つ。
- 装飾は pointer-events:none、aria-hidden。管理画面へ混入しない。
- reduced-motion、テーマ変更、リサイズ、非表示時の描画停止を確認する。
- 4Kでも描画バッファは最大1920px幅・DPR1.5、最大30fps。
- 新しいランタイム依存は追加しない。

## Tasks
- [x] 1. 起動済みの既存画面で `blue-flame` 選択肢がないことを確認する。
- [x] 2. tailwind.config.js と utils/constant.ts にテーマを登録。専用 Canvas コンポーネントと描画ヘルパーを作成し、layouts/default.vue でテーマに応じてマウントする。
- [x] 3. Chrome で見た目・設定保存・切替・動き・静止・リサイズ・操作を確認。build/generate を実行する。
- [ ] 4. 差分レビュー、スクリーンショット、利用説明を追加し、コミット・push・PR 作成。フロントとローカル API を起動したまま完了する。

## Execution notes
新規 clone に未変更ファイルしかないため、この checkout の専用ブランチで実装する。ユーザーから実装・PR作成・ローカル起動の依頼済み。追加承認待ちは設けない。フロントエンドの自動テスト基盤はないため、リポジトリ規約のビルドと実ブラウザ検証を用いる。

## Validation
- Chrome: テーマ選択・保存・再読込、動きと reduced-motion、非表示と解除、テーマ解除後の描画停止、設定ダイアログ、390px/4K、管理画面分離、Canvas 不可時のフォールバックを確認。pageerror 0件。
- 予約動画をローカルのブラウザテストで模擬し、再生中の停止・終了後の再開を確認。
- `yarn build` と `BASE_URL=/cp-dashboard/ yarn generate` 成功。
- Worker: 39/41 成功。`applies separate roles to uploads and schedule changes`、`queues a schedule change without applying it before mentor approval` は失敗。`git diff origin/main -- cloudflare/video-api` は空で、今回のテーマ変更とは別の既存問題。
- レビュー指摘: 動画による被覆は IntersectionObserver で判定できないため、明示的な active prop で停止。再読込時は client-only wrapper の template ref を監視して初期化。両方とも Chrome で再検証済み。
