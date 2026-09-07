#!/bin/sh
# Vercel "Ignored Build Step" for this repository.
#
# Exit 0  -> skip the build.
# Exit 1  -> run the build.
#
# Why this exists: the repository is connected to ~17 Vercel projects, so a
# single push costs ~17 of the account's 100 daily deployments and regularly
# exhausts the free-plan quota ("api-deployments-free-per-day"). Commits that
# only touch documentation or the Roblox game sources cannot change the Next.js
# output, so building them wastes the quota that real changes need.
#
# Every uncertain case falls through to exit 1 (build). Skipping a build that
# was needed would leave a stale site; running one that was not needed only
# costs a deployment.

set -u

# Paths that cannot affect `next build` output. Everything else triggers a build.
EXCLUDES="
:(exclude)docs
:(exclude)game
:(exclude)scripts
:(exclude)*.md
"

commit_exists() {
    git cat-file -e "$1^{commit}" 2>/dev/null
}

# Prefer the last successfully deployed commit. Vercel exposes this only when an
# Ignored Build Step is configured, and it is the correct base: if a push
# contains both a code commit and a docs commit, the range still covers the code
# commit, so the build runs.
BASE=""
if [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ] && commit_exists "$VERCEL_GIT_PREVIOUS_SHA"; then
    BASE="$VERCEL_GIT_PREVIOUS_SHA"
elif commit_exists "HEAD^"; then
    # First deployment for this branch, or the previous one failed.
    BASE="HEAD^"
fi

# No usable base (first commit, or a shallow clone without the parent): build.
if [ -z "$BASE" ]; then
    echo "vercel-ignore-build: no usable base commit; building."
    exit 1
fi

# shellcheck disable=SC2086
if git diff --quiet "$BASE" HEAD -- . $EXCLUDES; then
    echo "vercel-ignore-build: $BASE..HEAD touches only excluded paths; skipping build."
    exit 0
fi

echo "vercel-ignore-build: $BASE..HEAD changes build-relevant files; building."
exit 1
