#!/usr/bin/env bash
# Checker (libuv): my own evaluation of layouts A/B/C from the raw prototype output, and the GCC -dI truth.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/libuv/libuv-v1.48.0"
WB="$ROOT/work/libuv-B"
R="$ROOT/results/libuv"
CK="$R/check"
G2="$ROOT/work/libuv-check-gitdir-B"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
mkdir -p "$CK"
cd "$CK"
[ -d "$G2/.git" ] || git init -q "$G2"
git --git-dir="$G2/.git" --work-tree="$WB" ls-files --others --exclude-standard -z > "$CK/B-not-ignored.z"
python3 -I "$SC/check_libuv_walk.py" "$WB" "$CK/C-nongit.z"
echo "== B"; python3 -I "$SC/check_libuv_eval.py" "$R/B-light.ndjson" "$WB/build/compile_commands.json" "$WB" "$CK/B-not-ignored.z" "$CK/evalB.json" | grep -E '"(edges|unresolved|kept_units|claimed|parsed|skipped|failed|ok|failure_diagnostics_count|directive_sites_project|dir_pairs)"'
echo "== C"; python3 -I "$SC/check_libuv_eval.py" "$R/C-light.ndjson" "$WB/build/compile_commands.json" "$WB" "$CK/C-nongit.z" "$CK/evalC.json" | grep -E '"(edges|unresolved|kept_units|claimed|parsed|skipped|failed|ok|failure_diagnostics_count|directive_sites_project|dir_pairs)"'
echo "== GCC -dI truth (layout A database)"
systemd-run --user --scope -q --unit="uv-check-gcc-$$" -p MemoryMax=6G \
  /usr/bin/time -v -o "$CK/gcc.time.txt" \
  timeout 900 python3 -I "$SC/check_libuv_gcc.py" "$ROOT/build/libuv-out/compile_commands.json" "$S" "$CK/gcc-dI.json"
grep -E 'Elapsed|Maximum resident' "$CK/gcc.time.txt"
