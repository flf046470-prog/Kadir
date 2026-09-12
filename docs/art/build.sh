#!/bin/sh
# Renders every SVG in src/ to a PNG at its intrinsic pixel size.
#
# Roblox wants raster uploads, so the SVGs are the editable source and the PNGs
# are the artefact you actually upload. Re-run this after editing any source.
#
# Requires a Chromium binary. Set CHROME to override the default lookup.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT="$DIR"
SRC="$DIR/src"
WORK=${TMPDIR:-/tmp}/dreamlayers-art.$$
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

CHROME=${CHROME:-}
if [ -z "$CHROME" ]; then
    for c in /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
             /opt/pw-browsers/chromium-*/chrome-linux/chrome \
             "$(command -v chromium 2>/dev/null || true)" \
             "$(command -v chromium-browser 2>/dev/null || true)" \
             "$(command -v google-chrome 2>/dev/null || true)"; do
        [ -n "$c" ] && [ -x "$c" ] && CHROME=$c && break
    done
fi
[ -n "$CHROME" ] || { echo "build.sh: no chromium binary found; set CHROME=/path/to/chrome" >&2; exit 1; }

render() {
    src=$1; name=$2; w=$3; h=$4; transparent=$5
    printf '<style>html,body{margin:0;padding:0;background:%s}svg{display:block}</style>\n' \
        "$([ "$transparent" = yes ] && echo transparent || echo '#000')" > "$WORK/$name.html"
    cat "$src" >> "$WORK/$name.html"

    set -- --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
           --screenshot="$OUT/$name.png" --window-size="$w,$h"
    [ "$transparent" = yes ] && set -- "$@" --default-background-color=00000000

    "$CHROME" "$@" "file://$WORK/$name.html" >/dev/null 2>&1
    printf '  %-34s %sx%s\n' "$name.png" "$w" "$h"
}

echo "Rendering Dream Layers art with $CHROME"
render "$SRC/icon.svg"                    icon-512                     512  512  no
render "$SRC/wordmark.svg"                wordmark                    1600  560  yes
render "$SRC/thumb-01-dream-stack.svg"    thumbnail-01-dream-stack    1920 1080  no
render "$SRC/thumb-02-waking-room.svg"    thumbnail-02-waking-room    1920 1080  no
render "$SRC/thumb-03-corridor.svg"       thumbnail-03-corridor       1920 1080  no
echo "Done."
