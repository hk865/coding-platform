#!/usr/bin/env bash
# Speed round 2 evidence on the real code (R2-5 T2, R2-6): copies of the 20k ledger after round 1.
# r1-before = the round-1 state (full lookup indexes); r2-after = opened once by the round-2 code (migration at open).
set -euo pipefail
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
M=/mnt/d/cc-lead-notes/impl/s4f/r2-measure
OUT=/mnt/d/cc-lead-notes/impl/s4f/r2-real
R=$HOME/dsh-work/r2-measure/real
mkdir -p "$OUT" "$R"
date +%H:%M:%S
[ -e "$R/r1-before" ] || cp -a "$HOME/dsh-work/measure-s4f/full-r1" "$R/r1-before"
[ -e "$R/r2-after" ] || cp -a "$HOME/dsh-work/measure-s4f/full-r1" "$R/r2-after"
echo "copies ready $(date +%H:%M:%S)"
node "$M/01-inventory.mjs" "$R/r1-before/storage/ledger.sqlite" "$OUT/inventory-before.json"
echo "inventory before done $(date +%H:%M:%S)"
cd "$HOME/dsh-work/slices/s4g" && rm -rf dist && node_modules/.bin/tsc -p tsconfig.build.json
echo "s4g dist built $(date +%H:%M:%S)"
node /mnt/d/cc-lead-notes/impl/s4f/measure-s4f.mjs --repo "$HOME/dsh-work/slices/s4g" --data "$R/r2-after" \
  --old /mnt/d/cc-lead-notes/impl/s4b/measure-4b.out.json --out "$OUT/measure-s4g.out.json" > "$OUT/measure-s4g.log" 2>&1
echo "measure (r2 code, first open migrates) done $(date +%H:%M:%S)"
node "$M/01-inventory.mjs" "$R/r2-after/storage/ledger.sqlite" "$OUT/inventory-after.json"
echo "inventory after done $(date +%H:%M:%S)"
node "$M/04-queries-ab.mjs" "$R/r1-before/storage/ledger.sqlite" "$R/r2-after/storage/ledger.sqlite" r1-vs-r2 "$OUT/queries-ab.json" > "$OUT/queries-ab.log" 2>&1
echo "queries ab done $(date +%H:%M:%S)"
