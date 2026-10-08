#!/usr/bin/env bash
# stale-scan.sh <moves.json> <out-dir>   (cwd = an unmoved copy of H)
# TASK-D-PLAN §2 step 8: the lead's raw stale-name hits. Every line under src/ and tests/ (.ts) that is not a module
# specifier line and not one of the two data files, and that names a moved file
#   by-path: by its old directory path (<dir>/<name> with .ts, .js or no extension), and
#   by-name: by the file name of ANY moved file (renamed or not) with .ts and without a directory, with or without a
#            line reference (`name.ts`, `name.ts:12`, `name.ts:12-20`).
# The by-name hits include other files with the same name (other contracts.ts, agent-runtime's
# execution-history-contracts.ts); each hit is read in context afterwards (stale-list.md).
set -euo pipefail
MOVES=$1; OUT=$2
DATA1=tests/architecture/production-reach-allowlist.json
DATA2=tests/architecture/state-writes.test.ts
SPEC_LINE='^[^:]*:[0-9]+:\s*(import\s|export\s.*\sfrom\s|\}\s*from\s)|import\(\s*['"'"'"]|vi\.(mock|doMock|importActual|unmock|importMock)\(\s*['"'"'"]'
mapfile -t FROMS < <(node -e 'for (const m of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(m.from)' "$MOVES")
mapfile -t NAMES < <(node -e 'const p=require("path");for (const m of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(p.basename(m.from))' "$MOVES" | sort -u)
alt=$(printf '%s\n' "${FROMS[@]}" | sed 's/\.ts$//; s/[.]/\\./g' | paste -sd'|')
{
  echo "## by-path: comments and test titles naming a moved file by its old directory path"
  grep -rnE "(^|[^-[:alnum:]_])($alt)(\.ts|\.js)?([^-[:alnum:]_]|$)" src tests --include='*.ts' \
    | grep -vE "$SPEC_LINE" | grep -vF -e "$DATA1" -e "$DATA2" || true
} > "$OUT/stale-raw-by-path.txt"
{
  echo "## by-name: the file name of every moved file without a directory (${#NAMES[@]} names), raw hits"
  for name in "${NAMES[@]}"; do
    re="(^|[^-/[:alnum:]_])${name//./\\.}"
    n=$(grep -rnE "$re" src tests --include='*.ts' | grep -vE "$SPEC_LINE" | grep -vF -e "$DATA1" -e "$DATA2" | wc -l || true)
    echo "$name: $n"
  done
  for name in "${NAMES[@]}"; do
    re="(^|[^-/[:alnum:]_])${name//./\\.}"
    echo; echo "### $name"
    grep -rnE "$re" src tests --include='*.ts' | grep -vE "$SPEC_LINE" | grep -vF -e "$DATA1" -e "$DATA2" | sed -E 's/^(.{260}).*/\1 …/' || true
  done
} > "$OUT/stale-raw-by-name.txt"
