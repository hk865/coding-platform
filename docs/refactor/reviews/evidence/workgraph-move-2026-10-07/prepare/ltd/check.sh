#!/usr/bin/env bash
# LTd checker (task D at H = 58ea2fdc): prints ONE JSON line {verdict, score, details}.   bash ~/dsh-work/ladder/LTd/check.sh <copy-dir>
# Judges a throwaway clone of the copy (never the copy). score = files exactly right / files that must change
# (data/expected.json: the 18 moved files, the 145 importer files, the 2 architecture data files = 165). verdict pass =
# score 1 AND every move a git rename with content identical except import specifiers and allowlist/state-writes path
# strings and the same exported names AND canonical specifier spelling AND typecheck 0 AND check:architecture 0 AND no
# other file added/deleted/changed (ignored leftovers such as dist/ or .toolchain/ included) AND no commit AND the full
# test suite with the same test ids and no baseline-passing test failing (a failing test is rerun once alone). ~6-7 min.
set -uo pipefail
. "$HOME/dsh-work/ladder/_common/env.sh"
[ $# -ge 1 ] || { echo '{"verdict":"fail","score":0,"details":{"error":"usage: check.sh <copy-dir>"}}'; exit 0; }
node "$COMMON/check-move.mjs" "$1" "$LADDER/LTd" "${@:2}"
