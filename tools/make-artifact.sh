#!/bin/bash
# index.html から Claude Artifact に載せる版を作る
# Artifact は <html> や <head> を自動で付けるため、index.html の「@artifact-start」から「@artifact-end」までを抜き出し、
# 間にある </head> と <body> の行を外す。PWA 用のタグ（manifest・アイコン・Service Worker の登録）は印の外にあるので入らない。
# 使い方: bash tools/make-artifact.sh 出力先.html
set -e
cd "$(dirname "$0")/.."
OUT="${1:?出力先のファイル名を指定してください}"
sed -n '/<!-- @artifact-start -->/,/<!-- @artifact-end -->/p' index.html \
  | sed -e '/<!-- @artifact-start -->/d' -e '/<!-- @artifact-end -->/d' -e '/^<\/head>$/d' -e '/^<body>$/d' > "$OUT"
echo "作成しました: $OUT（$(wc -c < "$OUT" | tr -d ' ') バイト）"
