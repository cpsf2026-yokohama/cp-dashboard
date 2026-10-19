# 設定保存401 修復 引継ぎ書（2026-10-19）

## 状況

原因を特定し、WorkerとPagesを本番へ反映済み。Worker側の自動テストは24件成功し、TypeScript型チェックとPagesのビルド・生成も成功している。ユーザーが管理画面で編集中の値を保護するため、この作業では本番に実データを保存する操作をしていない。そのため、ログイン済みブラウザーからの認証通過と設定保存の最終確認は保留。

## 原因

Cloudflare Accessアプリは `/admin` と一部APIを保護していたが、`/api/settings` は保護対象外だった。公開設定の読み込み `GET /api/settings` を保ちつつ、保存の `PUT /api/settings` はWorker内でAccess JWT必須だったため、ブラウザーリクエストに `Cf-Access-Jwt-Assertion` ヘッダーが付かずHTTP 401になっていた。設定データやユーザーロールの保存処理が原因ではない。

## 完了した修正

- Workerは `Cf-Access-Jwt-Assertion` を優先し、未設定時は `CF_Authorization` Cookie内のJWTを同一の署名・発行元・Audience・期限検証へ渡す。ユーザー・管理者ロール検査も従来どおり。
- 管理画面はAPIエラー本文を表示する。
- Accessのパス設定は変更していない。これにより公開GETの挙動を変えない。

## 本番反映

- Worker: `video-api`、Version ID `c5cfa5f0-75a2-4636-9158-ed2b618af15d`
- Pages: `https://c4fd9319.cp-dashboard-13x.pages.dev`（Functionsを含めてデプロイ）

## 検証結果

- Worker: 24 tests passed、`npx tsc --noEmit` 成功。
- Pages: `corepack yarn build` と `corepack yarn generate` 成功。
- `git diff --check` 成功。
- Cookie抽出のテストでは、Cookieの値がJWT検証へ渡され、不正トークンとして拒否されることを確認した。
- 実際のログイン済みブラウザーからの無変更PUT（正常認証後に入力不足で400になる確認）と実設定保存は未実施。したがって本番ブラウザーでの修復完了はまだ確定していない。

## 次の確認

1. 本番 `/admin` を再読み込みし、「端末への反映」または設定値を開いて読み込みが完了することを確認する。
2. 一時的な入力不足の `PUT /api/settings` を認証済みブラウザーから送り、401ではなく入力エラーになることを確認する。これはデータを書き換えない。
3. 管理画面に保存したい値が正しく表示されていることを確認してから、通常の保存を実行し、成功表示と再読込後の値を確認する。

## 関連仕様

詳細は [`shared-settings-admin.md`](shared-settings-admin.md) の「2026-10-19 設定保存401の修正」を参照。
