#!/bin/bash
# icon.svg から PNG アイコン一式を作り直す（macOS 標準の sips を使う。追加の道具は不要）
# 使い方: bash tools/make-icons.sh
# PNG は角を丸めない四角で出す。ホーム画面では iOS や Android が自分で角を丸めるので、
# 先に丸めておくと四隅に地の色が出てしまうため。icon.svg（ブラウザのタブ用）は角丸のまま。
set -e
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
sed 's/ rx="114"//g' icon.svg > "$TMP/icon-square.svg"
sips -s format png -z 512 512 "$TMP/icon-square.svg" --out icon-512.png >/dev/null
sips -s format png -z 192 192 "$TMP/icon-square.svg" --out icon-192.png >/dev/null
sips -s format png -z 180 180 "$TMP/icon-square.svg" --out apple-touch-icon.png >/dev/null
rm -rf "$TMP"
echo "アイコンを作り直しました: icon-512.png / icon-192.png / apple-touch-icon.png"
