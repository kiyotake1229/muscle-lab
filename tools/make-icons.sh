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
echo "アイコンを作り直しました: icon-512.png / icon-192.png / apple-touch-icon.png"

# iOS アプリ用の元画像（ios-app/ がある場合）。
# このあと ios-app/ で npm run icons を実行すると、ここからアプリのアイコンと起動画面を作る。
if [ -d ios-app ]; then
  mkdir -p ios-app/assets
  # アイコン（1024×1024）: 上と同じ、角を丸めない四角。
  # sips は「大きさと viewBox が違う SVG」だとグラデーションの位置がずれるので、viewBox ごと 1024 にして中身を2倍に広げる
  sed -e 's|width="512" height="512" viewBox="0 0 512 512">|width="1024" height="1024" viewBox="0 0 1024 1024"><g transform="scale(2)">|' \
      -e 's|</svg>|</g></svg>|' "$TMP/icon-square.svg" > "$TMP/icon-1024.svg"
  if ! grep -q 'scale(2)' "$TMP/icon-1024.svg"; then
    echo "エラー: icon.svg の先頭（<svg … width=\"512\" height=\"512\" viewBox=\"0 0 512 512\">）が変わっていて、1024px のアイコンを作れません。tools/make-icons.sh を見直してください" >&2
    rm -rf "$TMP"; exit 1
  fi
  sips -s format png "$TMP/icon-1024.svg" --out ios-app/assets/icon.png >/dev/null
  # 起動画面（2732×2732）: アプリの地の色（#080D18）の中央に、フラスコの絵だけを置く（アイコンの四角い地は入れない）。
  # 地は1色にする。ぼかした光を入れると PNG が1枚 1MB を超え、アプリに6枚入るので重くなる
  {
    cat <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">
  <rect width="2732" height="2732" fill="#080D18"/>
EOF
    # 絵で使う色の定義（培養液のグラデーションなど）と、絵の本体を icon.svg から取り出す
    sed -n '/<defs>/,/<\/defs>/p' icon.svg
    sed -n '/<g id="art"/,/^  <\/g>/p' icon.svg \
      | sed 's|translate(256 262) scale(0.84) translate(-256 -262)|translate(1366 1366) scale(1.64) translate(-256 -265)|'
    echo '</svg>'
  } > "$TMP/splash.svg"
  if ! grep -q 'scale(1.64)' "$TMP/splash.svg"; then
    echo "エラー: icon.svg の絵（<g id=\"art\" …>）が見つからず、起動画面を作れません。tools/make-icons.sh の取り出し方を見直してください" >&2
    rm -rf "$TMP"; exit 1
  fi
  sips -s format png "$TMP/splash.svg" --out ios-app/assets/splash.png >/dev/null
  cp ios-app/assets/splash.png ios-app/assets/splash-dark.png
  echo "iOS アプリ用の元画像を作り直しました: ios-app/assets/icon.png / splash.png / splash-dark.png"
fi
rm -rf "$TMP"
