# Campus Dashboard

日本語 | [English](README.en.md)

キャンパスの大型ディスプレイに、時計・タイマー・天気・行事のカウントダウンをまとめて表示するWebアプリです。このリポジトリでは、CoreNionによるダッシュボードに、イベント動画のアップロード・再生予約・ユーザー管理を追加しています。

[表示画面](https://cp-dashboard-13x.pages.dev/) · [動画管理画面](https://cp-dashboard-13x.pages.dev/admin/) · [ダッシュボードのWiki](https://github.com/CoreNion/cp-dashboard/wiki)

![ダッシュボードの表示例（2024年の画面）](public/ogp.png)

## 主な機能

- 大きなデジタル時計、カウントダウンタイマー、チャイム・予鈴、行事までの日数表示。
- 気象庁の天気・外気温・気圧の表示。センサー接続時は室温・湿度・気圧の表示と記録。
- スクロールするお知らせ、バナー画像、テーマ・フォント・音源・画面エフェクトの変更。
- PWA対応と画面幅に応じたレイアウト。
- 動画ライブラリ、日時を指定する再生予約、未使用動画の削除、担当者の権限管理。

時計やタイマーなどの基本機能はブラウザーで動作します。動画機能にはCloudflare上のAPIと保存先が必要です。

| ページ | 用途 |
| --- | --- |
| `/` | 通常のダッシュボードと予約動画の再生 |
| `/admin` | 動画・スケジュール・ユーザーの管理 |
| `/player` | 開発用の動画再生・シーク確認。動画一覧の取得には認証が必要 |

## ダッシュボードの操作

表示端末でトップページを開き、最初に画面を一度クリックしてください。音声の読み込みとスリープ抑止を試みる処理が動き、短い確認音が鳴ります。ブラウザーや端末によって、音声再生やスリープ抑止の動作は異なります。

タイマーは「+5分」「+1分」「+10秒」で時間を追加し、「スタート」で開始します。「一時停止」で止め、「clear」でリセットできます。設定画面から、チャイムの時刻・音源、天気の地域、行事、フォント、バナーなどを変更できます。

センサー情報には対応ハードウェアとWeb Serial対応ブラウザーが必要です。[センサーの技術情報](https://github.com/CoreNion/cp-dashboard/wiki/測定センサーの技術的情報)と `arduino-sender/` を参照してください。

## 動画の運用手順

### ログインと権限

[動画管理画面](https://cp-dashboard-13x.pages.dev/admin/)を開き、Cloudflare AccessからGoogleアカウントでログインします。この運用環境では学園の `@nnn.ed.jp` アカウントを使用します。Access側のアクセス許可と、アプリ側のユーザー登録の両方が必要です。別の環境に導入する場合は、その環境のAccessポリシーに従ってください。

| 役割 | できる管理操作 |
| --- | --- |
| `producer`（動画制作担当） | 動画のアップロード、自分がアップロードした未使用動画の削除 |
| `operator`（運用担当） | 再生予約の追加・キャンセル |
| `admin`（管理者） | 上記すべて、他の担当者の未使用動画の削除、ユーザー登録・役割変更 |

動画と予約の一覧は各役割で確認できます。「ユーザー管理」は管理者向けです。そこでユーザーを登録しても、Cloudflare Accessの許可リストは自動更新されません。

### 動画をアップロードする

1. 「動画ライブラリ」タブを開きます。
2. 担当者が内容を判断できる動画名を入力します。例：`20261014_ステージ_オープニング_v1`。元のファイル名も分かりやすい名前にしてください。
3. 「動画ファイル」のファイル選択ボタンで動画を選び、サイズと形式を確認します。**1ファイルの上限は100 MiB**です。APIは空のファイルとMIMEタイプが `video/` で始まらないファイルを受け付けません。
4. 「アップロード」を押し、処理が終わるまで待ちます。
5. ライブラリに動画が追加されたことを確認します。本番と同じ表示端末で映像・音声の再生も確認してください。

アップロード時に動画を変換する機能はありません。実際に再生できる形式・コーデックは表示端末のブラウザーに依存します。

### 再生を予約する

1. 「スケジュール」タブの「＋ 予定を追加」を押します。
2. 動画・日付・開始時刻を選び、「予定を追加」で保存します。
3. 一覧に動画名と日時が追加されたことを確認します。入力日時は操作端末のタイムゾーンで解釈され、一覧は日本時間（`Asia/Tokyo`）で表示されます。日本での運用では操作端末も日本時間に設定してください。
4. 表示端末で `/` を開いたままにします。予定を検出すると動画が画面全体に表示され、再生終了後は通常のダッシュボードに戻ります。自動再生が止められた場合は「再生を開始する」を押します。

予約は1回ごとに登録します。繰り返し予約、端末ごとの配信先指定、端末の稼働監視は実装していません。各表示端末が約2秒ごとに予定を確認し、開始時刻から60秒以内の予定を再生対象にします。通信断や端末のスリープでこの時間を過ぎた場合は取り逃すことがあり、端末間の同時再生も保証しません。

### 予約と動画を削除する

予約の「キャンセル」はその予約を削除します。動画を削除するには、その動画を参照する予約を先にすべて削除してください。過去の予約も自動削除されません。

動画ライブラリの「未使用」絞り込みを使い、不要な動画を削除できます。削除は元に戻せません。保存ファイルの削除に失敗した旨の表示が出た場合は、管理者がR2側の残存ファイルを確認してください。

## 認証とデータの扱い

管理APIではCloudflare AccessのJWTについて署名・発行元・対象アプリ・有効期限を検証し、D1に登録されたユーザーの役割で操作を制限します。Pages FunctionsはAccessの認証ヘッダーや動画のRangeヘッダーをAPI Workerへ転送します。

一方、API実装上は `GET /api/schedule` と `GET /api/stream/videos/:id/stream`（互換経路 `/api/videos/:id/stream`）に認証を要求しません。配信URLを知る人が動画を取得できる設計です。実際の公開範囲はデプロイ先のAccess設定にも依存しますが、登録する動画は公開可能なものにしてください。

| 保存先 | 主な内容 |
| --- | --- |
| 表示端末のlocalStorage・OPFS | ダッシュボード設定、カスタム音源・フォント・バナー、センサー記録 |
| Cloudflare R2 | アップロードした動画ファイル |
| Cloudflare D1 | ユーザーのメールアドレスと役割、動画情報、再生予約、管理操作のログ |

天気やフォントなどの外部サービスへの通信もあります。ブラウザーのサイトデータを消すと端末内の設定やファイルが失われます。

### 保存容量と料金

**アップロード前にファイルサイズと登録済み容量を確認してください。** 管理画面の合計容量は登録動画のサイズの合計で、Cloudflareの請求額や残存ファイルを含む実使用量の表示ではありません。無料枠に達した時点でアップロードを自動停止する機能もありません。

2026年10月14日確認時点で、R2のStandardストレージの無料枠は月あたり **10 GB-month**です。保存容量は期間を含めて集計され、読み書きのリクエストにも月間無料枠があります。超過分は料金条件に従って課金されるため、不要動画の整理とCloudflare側の使用量確認を行ってください。最新の条件は[Cloudflare R2の料金表](https://developers.cloudflare.com/r2/pricing/)を参照してください。

## ローカル開発

フロントエンドはYarn 4.4.1、Workerはnpmを使用します。フロントエンドのCIはNode.js 20ですが、ロックファイル内のWrangler 4.149.0は**Node.js 22以上**を要求します。両方を動かす以下の例ではNode.js 24のコンテナを使います。

### フロントエンドを起動する

リポジトリのルートで実行します。

```sh
docker run --rm -it --name cp-dashboard-dev \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:8787:8787 \
  -v "$PWD":/workspace -w /workspace node:24-bookworm-slim bash

# コンテナ内
corepack enable
yarn install --immutable
yarn dev --host 0.0.0.0
```

ブラウザーで `http://localhost:3000` を開きます。動画APIの開発時の既定値は `http://localhost:8787/api` です。

### ローカルの動画APIを起動する

`cloudflare/video-api/.dev.vars` を次の内容で作成します。これはローカル検証専用で、Gitの追跡対象外です。[Wranglerのローカル環境変数](https://developers.cloudflare.com/workers/local-development/environment-variables/)も参照してください。

```dotenv
LOCAL_AUTH_BYPASS="true"
ACCESS_TEAM_DOMAIN=""
ACCESS_AUD=""
```

別のホスト側ターミナルから同じコンテナに入り、ローカルDBを初期化します。

```sh
docker exec -it cp-dashboard-dev bash
cd /workspace/cloudflare/video-api
npm ci
npx wrangler d1 migrations apply event-videos-db --local
npx wrangler d1 execute event-videos-db --local --command \
  "INSERT OR IGNORE INTO users (id, email, role) VALUES ('local-test-admin', 'local-test-admin@example.invalid', 'admin');"
npm run cf-typegen
npm run dev -- --ip 0.0.0.0
```

`http://localhost:3000/admin` から操作を確認できます。`--local` はローカルDBを対象にします。認証省略は `LOCAL_AUTH_BYPASS=true`、Access設定が両方空、リクエストURLのホストがループバック、固定IDのローカル管理者が存在する場合に限られます。本番環境では有効にしないでください。

### ビルドと検証

| 実行場所 | コマンド | 用途 |
| --- | --- | --- |
| ルート | `yarn build` | 本番ビルド |
| ルート | `yarn preview` | ビルド結果のプレビュー |
| ルート | `yarn generate` | 静的ファイル生成 |
| `cloudflare/video-api/` | `npm test -- --run` | VitestとCloudflareテストプラグインによるテスト |
| `cloudflare/video-api/` | `npm run cf-typegen` | Wranglerのバインディング型を生成 |

フロントエンドの自動テストとlintスクリプトはありません。Nuxtの自動型検査も無効です。UI変更時は表示幅、タイマー、音声、設定の再読み込みを確認し、動画機能の変更時は権限別の操作と表示端末での予約再生を確認してください。

## デプロイの構成

フロントエンドはNuxt 3のクライアント描画アプリ（`ssr: false`）です。静的ダッシュボードは単独でホストできます。動画機能を有効にする場合は、次の接続が必要です。

1. `cloudflare/video-api/wrangler.jsonc` のD1（`DB`）とR2（`VIDEO_BUCKET`）を導入先のリソースに合わせます。
2. D1のマイグレーションを適用し、初回管理者のAccessログインに使うメールアドレスを `users` に `admin` として登録します。**`0002_update_schedules.sql` は予約テーブルを作り直し、既存予約を削除します。** 既存DBへの適用前にバックアップと移行内容を確認してください。
3. API Workerの `ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` を対象のAccessアプリに合わせ、管理ページと管理APIのAccessポリシーを設定します。
4. `cloudflare/video-api/` で `npm run deploy` を実行してWorkerをデプロイします。Cloudflare Pagesでは `functions/` を含めてデプロイし、サービスバインディング `VIDEO_API` をAPI Worker（既定名 `video-api`）に接続します。プレビュー環境にも必要なバインディングを設定してください。

静的生成の出力先は `.output/public/` です。`NUXT_PUBLIC_VIDEO_API_BASE` はフロントエンド生成時にAPI URLを指定し、未指定の本番ビルドでは `/api` を使用します。`BASE_URL` はアプリの配置パスを指定します。例：`BASE_URL=/cp-dashboard/ yarn generate`。GitHub Pagesなどで動画機能を使う場合は別のAPI接続が必要で、別オリジンへの接続ではCORSと認証構成も合わせて調整してください。

## リポジトリ構成

```text
pages/                 ダッシュボード、動画管理、再生確認
components/            時計、タイマー、設定画面
composables/           共有状態とAPI接続先
plugins/ · workers/    時計・タイマー・天気・センサー処理
utils/                 日時計算、ファイル保存、センサー記録
public/                アイコン、PWA素材、音源
cloudflare/video-api/  API Worker、D1マイグレーション、テスト
functions/api/         Cloudflare PagesからWorkerへのプロキシ
arduino-sender/        センサー送信側のファームウェア
```

開発時の規約は [AGENTS.md](AGENTS.md) と [Workerのガイド](cloudflare/video-api/AGENTS.md)を参照してください。

## 開発の経緯と不具合報告

- 2024年：CoreNionによる時計・タイマー・天気・センサー・行事表示の開発。音声の初回クリック対応、モバイル表示、PWAなどを改善。
- 2026年10月：このリポジトリで動画配信API、予約再生、権限管理を追加（[03b5ce8](https://github.com/cpsf2026-yokohama/cp-dashboard/commit/03b5ce8bc2e2b4de59c18ce2f6f75fdec270529a)）。管理画面のデモ用端末表示を削除（[00000d3](https://github.com/cpsf2026-yokohama/cp-dashboard/commit/00000d38aea860d99f37cefa2c86d3098b4fb3e2)）。
- 2026年10月14日：タイマーの数字が切り替わるアニメーションの方向を修正（[7c2c470](https://github.com/cpsf2026-yokohama/cp-dashboard/commit/7c2c47048c35e5ff7a72f8a23333837d4fa7096a)）。

運用中の不具合は、運用チームのSlackで担当者へ連絡してください。再現手順・ブラウザー・端末・期待した動作を添えると確認しやすくなります。認証トークンや個人情報は添付しないでください。

## ライセンスと出典

- アプリのソースコード：[MIT License](LICENCE)。Copyright © 2024 CoreNion。
- 気象データ：[気象庁](https://www.jma.go.jp/bosai/)。利用条件は[気象庁ウェブサービス利用規約](https://www.jma.go.jp/jma/kishou/info/coment.html)を参照してください。
- フォント：Inter（Copyright 2020 The Inter Project Authors）とM PLUS Rounded 1c。[SIL Open Font License 1.1](https://scripts.sil.org/OFL)。
- 同梱の効果音：[OtoLogic](https://otologic.jp/)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）。
