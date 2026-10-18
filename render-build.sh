#!/usr/bin/env bash
set -e

echo "=== Shazam API: Checking Render Environment ==="
echo "Node version: $(node -v)"

# Check if ffmpeg and ffprobe are already installed in system
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  echo "✔ System FFmpeg and FFprobe found: $(ffmpeg -version | head -n 1)"
  exit 0
fi

BIN_DIR="$(pwd)/bin"
mkdir -p "$BIN_DIR"

if [ -f "$BIN_DIR/ffmpeg" ] && [ -f "$BIN_DIR/ffprobe" ]; then
  echo "✔ Local FFmpeg binaries found in $BIN_DIR"
  chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"
  exit 0
fi

echo "Downloading static FFmpeg build for Linux x86_64..."
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
TMP_DIR=$(mktemp -d)

curl -sSL "$FFMPEG_URL" -o "$TMP_DIR/ffmpeg.tar.xz"
tar -xf "$TMP_DIR/ffmpeg.tar.xz" -C "$TMP_DIR"
FFMPEG_EXTRACTED=$(find "$TMP_DIR" -maxdepth 1 -type d -name "ffmpeg-*-amd64-static" | head -n 1)

cp "$FFMPEG_EXTRACTED/ffmpeg" "$BIN_DIR/ffmpeg"
cp "$FFMPEG_EXTRACTED/ffprobe" "$BIN_DIR/ffprobe"
chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"

rm -rf "$TMP_DIR"
echo "✔ FFmpeg and FFprobe installed successfully to $BIN_DIR"
