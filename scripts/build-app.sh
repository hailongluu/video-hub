#!/bin/bash
# Dựng ~/Applications/Video Hub.app (biểu tượng trên thanh menu để bật/tắt nhà máy). Chạy lại sau khi sửa app/VideoHub.swift
# hoặc đổi bản node/uv. App không tự chạy khi đăng nhập.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Video Hub.app"
NODE="$(command -v node)"
UV="$(command -v uv)"
FFDIR="$(dirname "$(command -v ffmpeg)")"
PATHV="$(dirname "$NODE"):$FFDIR:$(dirname "$UV"):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -o "$APP/Contents/MacOS/VideoHub" "$ROOT/app/VideoHub.swift"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Video Hub</string>
  <key>CFBundleIdentifier</key><string>com.luuhailong.video-hub</string>
  <key>CFBundleExecutable</key><string>VideoHub</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>VHRoot</key><string>$ROOT</string>
  <key>VHNode</key><string>$NODE</string>
  <key>VHUv</key><string>$UV</string>
  <key>VHPath</key><string>$PATHV</string>
</dict></plist>
EOF
codesign --force --sign - "$APP" 2>/dev/null || true
echo "đã dựng: $APP"
