# GitHub Pages で公開

- 管理番号: #0002
- 種類: DPL（デプロイ関連）
- 対象: 全体（ALL）
- 作成日: 2026-11-19
- 関連: #0001（現状の仕様と構成）

## 概要

マッスルラボ v1.0.0 を GitHub の公開リポジトリ `kiyotake1229/muscle-lab` に置き、GitHub Pages で一般公開した。公開URLは https://kiyotake1229.github.io/muscle-lab/ 。スマホのブラウザで開くだけで試せて、ホーム画面に追加すればオフラインでも使える。App Store 申請のサポートURLにも使える。

## 対象ファイル

パスは `マッスルラボ/` からの相対パス。

- `.gitignore` — 新規。git に入れないもの（iOS 化したときの `ios-app/node_modules/` など）
- `README.md` — 公開URL・ファイル構成・残作業の更新
- GitHub 側の設定（リポジトリと Pages）。アプリ本体（`index.html`）は変えていない

## 変更内容

### 1. git の初期化と最初のコミット

- `マッスルラボ/` で `git init -b main` を実行した（これまで git 管理はしていなかった）
- `.gitignore` は兄弟アプリ（土地開拓ゲーム）と同じ内容にした。`.DS_Store`、`ios-app/node_modules/`、`ios-app/www/`、`ios-app/ios/App/Pods/`、`ios-app/ios/App/App/public/`、Xcode の個人設定（xcuserdata）、`.claude/settings.local.json` を入れない
- 初版の18ファイルを `[#0001] マッスルラボ v1.0.0: 初版` としてコミットした（コミット `6644e99`）。コミットの直前に、`index.html` が確認済みの初版と同じ内容であることを確かめている

### 2. GitHub のリポジトリ

```bash
gh repo create kiyotake1229/muscle-lab --public --source=. --remote=origin --push
```

- 公開（public）のリポジトリ。ほかのアプリと同じ扱いで、GitHub Pages を無料で使うため
- リポジトリには、アプリ本体と PWA 用のファイルのほか、README・docs・tools・`.claude/`（ドキュメント規則とローカル確認用サーバの設定）も入る。使う人の記録は各自の端末の中にしかなく、リポジトリには含まれない

### 3. GitHub Pages

```bash
gh api -X POST repos/kiyotake1229/muscle-lab/pages -f 'source[branch]=main' -f 'source[path]=/'
```

- main ブランチのルートをそのまま配信する（ビルドなし）。HTTPS のみ
- 以後は、main に push すると自動で反映される

## 更新のしかた

1. `index.html` などを直し、`node tools/check.mjs` とブラウザで確かめる
2. docs を1本書いて `bash docs/manager/generate_docs_json.sh`
3. `git add` → `git commit`（メッセージは `[#連番] 内容`）→ `git push`

反映は push から数十秒〜数分。`sw.js` の作り（保存してある版をすぐ返し、裏で新しい版を取りに行く）により、すでに開いたことのある端末では、更新後の最初の1回は前の版が出て、次に開いたときに新しい版になる。

## 確認

2026-11-19 に確認した。

- Pages の状態が `built`、HTTPS のみになっていること（`gh api repos/kiyotake1229/muscle-lab/pages`）
- 公開URLの `/`・`index.html`・`manifest.json`・`sw.js`・アイコン4つがすべて 200 で返ること。公開された `index.html` が手元の初版と1バイトも違わないこと（`cmp`）
- Claude の内蔵ブラウザ（375×812、音は消して操作）で公開URLを開き、はじめての設定 → ホーム（分身と6部位のチップ）→ 実験を最後まで（15セット）→ 結果 → 食事の目安 → 記録 と操作できること。`manifest.json` が読めること、記録が端末内に保存されること、横スクロールやエラーが出ないこと
- **この確認で、Service Worker が同じドメインのほかのアプリのキャッシュを消してしまう不具合を見つけた。** 直した内容は #0003 に書いた（公開から修正の反映までに公開URLを開いたのは、この確認のブラウザだけ）
- **未確認**: スマホ実機での表示と操作、ホーム画面への追加（アイコンと全画面表示）

## 確認URL

| 環境 | URL |
|------|-----|
| 本番（GitHub Pages） | https://kiyotake1229.github.io/muscle-lab/ |
| リポジトリ | https://github.com/kiyotake1229/muscle-lab |
| 開発確認用（Claude Artifact） | https://claude.ai/artifact/432oUJhnLEvRjkd4Y1PGbL |
| ローカル | http://localhost:8821/ （`マッスルラボ/` で `python3 -m http.server 8821 --bind 127.0.0.1`） |

## 作業概要と概算費用

| 項目 | 内容 | 工数 |
|------|------|------|
| 実装 | git の初期化、リポジトリの作成、Pages の設定 | 0.3h |
| テスト | 公開URLでの動作確認 | 0.3h |
| 文書 | この文書、README の更新 | 0.2h |
| 合計 | | 0.8h（0.1人日） |

概算費用: 人日単価が未設定のため金額は書かない。GitHub の利用料はかからない（公開リポジトリの Pages は無料）。
