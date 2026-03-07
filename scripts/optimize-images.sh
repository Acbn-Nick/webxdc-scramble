#!/bin/bash
# Resize tile background PNGs to 256px JPEGs (requires ImageMagick)
set -e
cd "$(dirname "$0")/.."
for name in board center dl dw tl tw; do
  src="public/${name}.png"
  dst="public/${name}.jpg"
  if [ -f "$src" ]; then
    convert "$src" -alpha set -channel A -threshold 50% +channel -trim +repage -resize 256x256! -quality 85 -strip "$dst"
    echo "  ${src} -> ${dst}"
  elif [ -f "$dst" ]; then
    echo "  ${dst} already exists (source PNG removed)"
  else
    echo "  WARNING: neither ${src} nor ${dst} found"
  fi
done
echo "Done."
