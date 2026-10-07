#!/usr/bin/env bash
# scan-text.sh <moves.json> <out-dir>   (run in a copy of H, before the move; cwd = project root)
# Text scans that the import parser does not see (TASK-D-PLAN.md §2 steps 7 and 8):
#   path-places.txt   every line under tests/architecture/, scripts/ and vitest.config.ts that names a work-graph path,
#                     with the moved files marked; and the path strings per moved file in the two data files;
#   path-strings.txt  string literals anywhere in src/, tests/, scripts/ that name a moved file and are NOT a module
#                     specifier or a comment (a test that reads a file by path would break at run time; typecheck
#                     does not see it);
#   stale-by-path.txt comments and test titles in src/ and tests/ that name a moved file by its old directory path
#                     (follow-up list after task D, not part of it);
#   stale-by-name.txt the bare file names of the renamed files (contracts.ts, coverage.ts) without a directory: raw
#                     hits, many name other contracts.ts files, each needs reading in context.
set -euo pipefail
MOVES=$1; OUT=$2
WG=src/core/work-graph/
mapfile -t FROMS < <(node -e 'for (const m of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(m.from)' "$MOVES")
mapfile -t RENAMED < <(node -e 'const p=require("path");for (const m of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) if (p.basename(m.from)!==p.basename(m.to)) console.log(p.basename(m.from))' "$MOVES" | sort -u)
DATA1=tests/architecture/production-reach-allowlist.json
DATA2=tests/architecture/state-writes.test.ts
SPEC_LINE='^[^:]*:[0-9]+:\s*(import\s|export\s.*\sfrom\s|\}\s*from\s)|import\(\s*['"'"'"]|vi\.(mock|doMock|importActual|unmock|importMock)\(\s*['"'"'"]'
alt=$(printf '%s\n' "${FROMS[@]}" | sed 's/\.ts$//; s/[.]/\\./g' | paste -sd'|')

{
  echo "## lines naming a work-graph path under tests/architecture/, scripts/, vitest.config.ts (MOVED = names a moved file)"
  grep -rnE 'work-graph/' tests/architecture scripts vitest.config.ts | while IFS= read -r line; do
    if printf '%s' "$line" | grep -qE "work-graph/($alt)(\.ts|\.js|['\"])"; then echo "MOVED  $line"; else echo "-      $line"; fi
  done | sed -E 's/^(.{240}).*/\1 …/'
  echo
  echo "## path strings per moved file in the two data files (the forms wg-move.mjs rewrites)"
  total=0
  for f in "${FROMS[@]}"; do
    a=$(grep -oF "\"$WG$f\"" "$DATA1" | wc -l || true)
    b=$(grep -oF "'$WG$f'" "$DATA2" | wc -l || true)
    c=$(grep -oF "file: '$f'" "$DATA2" | wc -l || true)
    [ $((a + b + c)) -gt 0 ] && echo "$f	allowlist=$a	state-writes(full)=$b	state-writes(file:)=$c"
    total=$((total + a + b + c))
  done
  echo "total path strings: $total"
} > "$OUT/path-places.txt"

{
  echo "## string literals naming a moved file that are not module specifiers or comments (src/, tests/, scripts/; the two data files excluded)"
  grep -rnE "['\"\`][^'\"\`]*($alt)(\.ts|\.js)?['\"\`]" src tests scripts --include='*.ts' --include='*.mts' --include='*.mjs' --include='*.json' \
    | grep -vE "$SPEC_LINE" | grep -vE "^[^:]*:[0-9]+:\s*(//|/?\*)" | grep -vF -e "$DATA1" -e "$DATA2" | grep -E "work-graph/|['\"\`]\.\.?/" || echo "none"
} > "$OUT/path-strings.txt"

{
  echo "## comments and test titles naming a moved file by its old directory path (import/export/vi.mock lines and the two data files excluded)"
  grep -rnE "(^|[^-[:alnum:]_])($alt)(\.ts|\.js)?([^-[:alnum:]_]|$)" src tests --include='*.ts' \
    | grep -vE "$SPEC_LINE" | grep -vF -e "$DATA1" -e "$DATA2" || true
} > "$OUT/stale-by-path.txt"
echo "lines: $(($(wc -l < "$OUT/stale-by-path.txt") - 1))" >> "$OUT/stale-by-path.txt"

{
  echo "## bare file names of renamed files without a directory: ${RENAMED[*]} (raw hits; each needs reading in context)"
  for name in "${RENAMED[@]}"; do
    n=$(grep -rnE "(^|[^-/[:alnum:]_])${name//./\\.}" src tests --include='*.ts' | grep -vE "$SPEC_LINE" | wc -l || true)
    echo "$name: $n lines"
  done
  for name in "${RENAMED[@]}"; do
    echo; echo "### $name"
    grep -rnE "(^|[^-/[:alnum:]_])${name//./\\.}" src tests --include='*.ts' | grep -vE "$SPEC_LINE" | sed -E 's/^(.{240}).*/\1 …/' || true
  done
} > "$OUT/stale-by-name.txt"
