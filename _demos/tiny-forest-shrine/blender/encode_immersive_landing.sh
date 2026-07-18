#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SOURCE="$REPO_ROOT/_demos/tiny-forest-shrine/source/immersive-landing-plates"
OUTPUT="$REPO_ROOT/assets/demos/tiny-forest-shrine/immersive-landing"

mkdir -p "$OUTPUT/stills" "$OUTPUT/vid"

chapters=(
  "01-threshold"
  "02-lantern-crossing"
  "03-moon-pond"
  "04-ancient-sakura"
  "05-spirit-grotto"
  "06-awakened-shrine"
)

# Each move is intentionally tiny. Keep the desktop master at 1080p and the
# mobile master at 720p so object-fit: cover never has to enlarge a 720p/540p
# video across a high-density viewport. The stills retain the generated plates'
# native resolution instead of throwing away detail before first paint.
drift_x=("0.08" "-0.045" "0.025" "0.05" "-0.035" "0.018")
drift_y=("-0.02" "0.035" "0.02" "-0.028" "0.024" "-0.018")

for index in "${!chapters[@]}"; do
  chapter="${chapters[$index]}"
  desktop="$SOURCE/$chapter.png"
  mobile="$SOURCE/$chapter-mobile.png"

  cwebp -quiet -q 90 -m 6 \
    "$desktop" -o "$OUTPUT/stills/$chapter.webp"

  cwebp -quiet -q 90 -m 6 \
    "$mobile" -o "$OUTPUT/stills/$chapter-mobile.webp"

  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -framerate 24 -i "$desktop" \
    -vf "scale=2048:1152:flags=lanczos,zoompan=z='min(max(zoom,pzoom)+0.00065,1.065)':x='iw/2-(iw/zoom/2)+on*${drift_x[$index]}':y='ih/2-(ih/zoom/2)+on*${drift_y[$index]}':d=1:s=1920x1080:fps=24,unsharp=5:5:0.35:5:5:0,format=yuv420p" \
    -frames:v 96 -an -c:v libx264 -preset slow -crf 18 \
    -g 8 -keyint_min 8 -movflags +faststart \
    "$OUTPUT/vid/$chapter.mp4"

  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -framerate 24 -i "$mobile" \
    -vf "scale=960:1706:flags=lanczos,crop=960:1704,zoompan=z='min(max(zoom,pzoom)+0.00055,1.052)':x='iw/2-(iw/zoom/2)+on*${drift_x[$index]}':y='ih/2-(ih/zoom/2)+on*${drift_y[$index]}':d=1:s=720x1280:fps=24,unsharp=5:5:0.3:5:5:0,format=yuv420p" \
    -frames:v 96 -an -c:v libx264 -preset slow -crf 21 \
    -g 4 -keyint_min 4 -movflags +faststart \
    "$OUTPUT/vid/$chapter-mobile.mp4"
done

echo "Encoded ${#chapters[@]} desktop/mobile scroll chapters in $OUTPUT"
