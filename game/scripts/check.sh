#!/bin/sh
# Every automated gate the specification requires, in one command.
# Run from anywhere: sh game/scripts/check.sh
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$DIR"

fail=0
step() {
    printf '\n=== %s ===\n' "$1"
}
soft() {
    # A tool that is not installed must not silently pass. Report and keep going, so a
    # missing linter is visible rather than mistaken for a clean run.
    printf '  SKIPPED: %s is not installed\n' "$1"
    fail=$((fail + 1))
}

step "rojo build"
if command -v rojo >/dev/null 2>&1; then
    rojo build default.project.json -o /tmp/dreamlayers.rbxl && echo "  ok"
else
    soft rojo
fi

step "stylua --check"
if command -v stylua >/dev/null 2>&1; then
    stylua --check src tests && echo "  ok"
else
    soft stylua
fi

step "selene"
if command -v selene >/dev/null 2>&1; then
    selene src && echo "  ok"
else
    soft selene
fi

step "luau-lsp analyze (strict typecheck)"
if command -v luau-lsp >/dev/null 2>&1; then
    luau-lsp analyze --settings=.luaurc src tests && echo "  ok"
else
    soft luau-lsp
fi

step "lune tests"
if command -v lune >/dev/null 2>&1; then
    lune run tests/run.luau
else
    soft lune
fi

printf '\n'
if [ "$fail" -ne 0 ]; then
    printf 'check.sh: %d step(s) could not run. This is NOT a pass.\n' "$fail"
    exit 1
fi
echo "check.sh: all steps passed."
