#!/usr/bin/env bash
# measure.sh <out-dir> [<commit>]       (MOVES=<file> uses another move list than ../moves.json)
# Recomputes the task-D numbers for moves.json on a throwaway copy of one commit (default HEAD) and writes them to
# <out-dir>. Run from the root of a git checkout that has node_modules and vendor/coding-agent/node_modules installed
# (the copy is made inside it, in .taskd-scratch/, so node finds typescript there). Nothing in the checkout changes;
# the copy is deleted at the end.
#
# 2026-10-07 run: in the WSL slot of the session wrapper (wslrun.sh), whose HEAD is a snapshot commit on top of the
# real HEAD, so <commit> was HEAD^ (= 4404f4dc) and the snapshot only added this evidence directory.
set -euo pipefail
OUT=$(realpath -m "$1"); C=${2:-HEAD}
HERE=$(cd "$(dirname "$0")" && pwd)
EV=$(dirname "$HERE")
LADDER=$HERE/ladder
SLOT=$(pwd)
H=$(git rev-parse --short=8 "$C")
SCRATCH=$SLOT/.taskd-scratch
COPY=$SCRATCH/copy
rm -rf "$SCRATCH"; mkdir -p "$COPY" "$OUT"
trap 'rm -rf "$SCRATCH"' EXIT
git archive "$C" | tar -x -C "$COPY"
cp "${MOVES:-$EV/moves.json}" "$SCRATCH/moves.json"; cp "$EV/target.json" "$SCRATCH/"
cd "$COPY"
git init -q && git add -A && git -c user.name=taskd -c user.email=taskd@localhost commit -q -m "H $H"
SETUP=$(git rev-parse HEAD)
{ echo "measured commit: $H ($(git -C "$SLOT" log -1 --format='%h %s' "$C"))"; echo "node $(node -v), typescript $(node -p 'require("typescript").version')"; } > "$OUT/commit.txt"

# 0. What changed in src/core/work-graph/ since the 10-02 plan (a22ad30) and the ladder's L3 (bfb6075).
{
  for c in a22ad30 bfb6075 "$C"; do git -C "$SLOT" ls-tree -r --name-only "$c" -- src/core/work-graph | sed 's#src/core/work-graph/##' > "$SCRATCH/files-$c.txt"; done
  echo "## files per directory: 10-02 (a22ad30) / bfb6075 / H ($H)"
  for d in $(cat "$SCRATCH"/files-*.txt | sed -E 's#/.*##' | sort -u); do
    printf '%s\t%s\t%s\t%s\n' "$d" "$(grep -c "^$d\(/\|$\)" "$SCRATCH/files-a22ad30.txt" || true)" "$(grep -c "^$d\(/\|$\)" "$SCRATCH/files-bfb6075.txt" || true)" "$(grep -c "^$d\(/\|$\)" "$SCRATCH/files-$C.txt" || true)"
  done
  printf 'total\t%s\t%s\t%s\n' "$(wc -l < "$SCRATCH/files-a22ad30.txt")" "$(wc -l < "$SCRATCH/files-bfb6075.txt")" "$(wc -l < "$SCRATCH/files-$C.txt")"
  for pair in "a22ad30 $C" "bfb6075 $C"; do
    set -- $pair
    echo; echo "## deleted $1 -> $H (commit that deleted it)"
    comm -23 "$SCRATCH/files-$1.txt" "$SCRATCH/files-$2.txt" | while read -r f; do echo "$f	$(git -C "$SLOT" log --format='%h %s' --diff-filter=D -1 "$1".."$2" -- "src/core/work-graph/$f")"; done
    echo; echo "## added $1 -> $H (commit that added it)"
    comm -13 "$SCRATCH/files-$1.txt" "$SCRATCH/files-$2.txt" | while read -r f; do echo "$f	$(git -C "$SLOT" log --format='%h %s' --diff-filter=A "$1".."$2" -- "src/core/work-graph/$f" | tail -1)"; done
  done
} > "$OUT/files-since-10-02.txt"

# 1. Before the move: import graph, per-move statistics, importer list, text scans.
node scripts/import-graph.mjs --out "$SCRATCH/before" > /dev/null
cp "$SCRATCH/before/import-graph.md" "$OUT/import-graph-before.md"
node "$HERE/submodule-graph.mjs" "$SCRATCH/before/import-graph.json" "$SCRATCH/target.json" > "$OUT/submodule-graph-before.txt" || true
node "$LADDER/move-stats.mjs" . "$SCRATCH/moves.json" > "$OUT/move-stats.txt"
node "$LADDER/importers.mjs" . "$SCRATCH/moves.json" > "$OUT/importers.txt"
bash "$HERE/scan-text.sh" "$SCRATCH/moves.json" "$OUT"

# 2. The reference move (git mv + specifier and path-string rewrite) on the copy, and the per-file expected changes.
node "$LADDER/wg-move.mjs" . "$SCRATCH/moves.json" > "$OUT/wg-move.json"
node "$LADDER/mk-expected.mjs" . "$SCRATCH/moves.json" "$SETUP" > "$SCRATCH/expected.json"
node -p 'JSON.stringify(require(process.argv[1]).counts)' "$SCRATCH/expected.json" > "$OUT/expected-counts.json"
node "$LADDER/expected-listing.mjs" "$SCRATCH/expected.json" > "$OUT/listing-canonical.txt"
node "$LADDER/expected-listing.mjs" "$SCRATCH/expected.json" --literal "$SCRATCH/moves.json" > "$SCRATCH/listing-literal.txt"
diff "$OUT/listing-canonical.txt" "$SCRATCH/listing-literal.txt" > "$OUT/listing-literal-drops.txt" || true
node "$HERE/split-counts.mjs" "$SCRATCH/expected.json" "$SCRATCH/moves.json" > "$OUT/counts.txt"
git -c core.quotepath=off diff -M --stat=200 "$SETUP" > "$OUT/diff-stat.txt" || true

# 3. After the move: import graph, the target check, submodule edges and cycles, for the proposal (target.json) and
#    for the strict 10-02 declaration (variants/target-strict.json: model depends on nothing).
cp "$EV/variants/target-strict.json" "$SCRATCH/target-strict.json"
node scripts/import-graph.mjs --out "$SCRATCH/after" > /dev/null
cp "$SCRATCH/after/import-graph.md" "$OUT/import-graph-after.md"
node "$HERE/assign.mjs" "$SCRATCH/after/import-graph.json" "$SCRATCH/target.json" > "$SCRATCH/check-input.json"
node scripts/import-graph-check.mjs "$SCRATCH/after/import-graph.json" "$SCRATCH/check-input.json" > "$OUT/target-check-after.json" || true
node "$HERE/submodule-graph.mjs" "$SCRATCH/after/import-graph.json" "$SCRATCH/target.json" > "$OUT/submodule-graph-after.txt"
node "$HERE/submodule-graph.mjs" "$SCRATCH/after/import-graph.json" "$SCRATCH/target-strict.json" > "$OUT/submodule-graph-after-strict.txt"
# ... and what is left once the small code steps (code-steps.json, not task D) have also been made:
#     X1 + X2 with the proposal (model -> state declared), and X1 + X2 + A with the strict declaration.
node "$HERE/what-if.mjs" "$SCRATCH/after/import-graph.json" "$EV/code-steps.json" X1,X2 > "$SCRATCH/what-if.json"
node "$HERE/submodule-graph.mjs" "$SCRATCH/what-if.json" "$SCRATCH/target.json" > "$OUT/submodule-graph-after-X1-X2.txt"
node "$HERE/what-if.mjs" "$SCRATCH/after/import-graph.json" "$EV/code-steps.json" X1,X2,A > "$SCRATCH/what-if-strict.json"
node "$HERE/submodule-graph.mjs" "$SCRATCH/what-if-strict.json" "$SCRATCH/target-strict.json" > "$OUT/submodule-graph-after-X1-X2-A-strict.txt"

# 4. Sanity on the moved copy: typecheck, module boundaries, then the boundaries with the submodule fragment written
#    into the copy's module-target.json (proposal, then strict).
ln -s "$SLOT/vendor/coding-agent/node_modules" vendor/coding-agent/node_modules
TSC=$SLOT/node_modules/.bin/tsc
{ "$TSC" --noEmit -p tsconfig.json && "$TSC" --noEmit -p tsconfig.ui.json; echo "typecheck exit=$?"; } > "$OUT/typecheck-after.txt" 2>&1 || echo "typecheck exit=$?" >> "$OUT/typecheck-after.txt"
{ node scripts/check-boundaries.mjs; echo "check:architecture exit=$?"; } > "$OUT/check-architecture-after.txt" 2>&1 || echo "check:architecture exit=$?" >> "$OUT/check-architecture-after.txt"
for t in target target-strict; do
  node "$HERE/with-fragment.mjs" docs/refactor/module-target.json "$SCRATCH/$t.json"
  { node scripts/check-boundaries.mjs; echo "check:architecture exit=$?"; } > "$OUT/check-architecture-with-submodules${t#target}.txt" 2>&1 || echo "check:architecture exit=$?" >> "$OUT/check-architecture-with-submodules${t#target}.txt"
done
echo "done: $OUT"
