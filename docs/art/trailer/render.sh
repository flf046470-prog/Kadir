#!/bin/sh
# Renders the Dream Layers trailer to WebM. Needs node and a chromium binary.
#   FPS=24 QUALITY=92 OUT=dream-layers-trailer.webm sh docs/art/trailer/render.sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$DIR/render.mjs"
