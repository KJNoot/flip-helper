#!/bin/bash
# Copy a reviewed promo into the app as app/media/intro.mp4, under about 15 MB.
# Usage: tools/import-intro-video.sh [source.mp4]
# Default source: /workspace/flip-helper-video/intro-ready.mp4 (a prepared ~6 MB transcode)
#   or /workspace/flip-helper-video/flip-helper-ad-v1.mp4
# Do not add the result to the service worker precache list. The welcome
# lazy-loads it, and sw.js already skips caching .mp4 files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-/workspace/flip-helper-video/intro-ready.mp4}"
DEST="$ROOT/app/media/intro.mp4"
MAX=$((15 * 1024 * 1024))

if [ ! -f "$SRC" ]; then
  echo "Source video not found: $SRC" >&2
  echo "Pass the approved file: tools/import-intro-video.sh /path/to/approved.mp4" >&2
  exit 1
fi

SIZE=$(stat -c%s "$SRC")
mkdir -p "$ROOT/app/media"

if [ "$SIZE" -le "$MAX" ]; then
  # Remux with faststart so the welcome can start playing quickly.
  ffmpeg -y -i "$SRC" -c copy -movflags +faststart "$DEST" -hide_banner -loglevel error
else
  echo "Source is $SIZE bytes (over 15 MB). Transcoding to 720×1280…"
  ffmpeg -y -i "$SRC" -vf "scale=720:1280" \
    -c:v libx264 -profile:v high -level 3.1 -pix_fmt yuv420p \
    -crf 24 -maxrate 1450k -bufsize 2900k -preset medium \
    -c:a aac -b:a 96k -ac 2 \
    -movflags +faststart "$DEST" -hide_banner -loglevel error
fi

SIZE=$(stat -c%s "$DEST")
if [ "$SIZE" -gt "$MAX" ]; then
  echo "Result is still over 15 MB ($SIZE). Re-encode with a higher CRF and try again." >&2
  exit 1
fi
echo "Wrote $DEST ($SIZE bytes)."
echo "Do not add intro.mp4 to the service worker ASSETS list."

# Tell the welcome screen the file is present, so it will lazy-load it.
INTRO_JS="$ROOT/app/js/core/intro.js"
if [ -f "$INTRO_JS" ]; then
  sed -i 's/export const INTRO_VIDEO_READY = false;/export const INTRO_VIDEO_READY = true;/' "$INTRO_JS"
  echo "Set INTRO_VIDEO_READY = true in js/core/intro.js"
fi
