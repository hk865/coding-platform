#!/usr/bin/env bash
set -euo pipefail
ROOT="$HOME/dsh-work/measure-cpp"
S="$ROOT/downloads/cmake-3.30.5/cmake-3.30.5"
B="$ROOT/build/cmake-3.30.5"
R="$ROOT/results/cmake-3.30.5"
SCR=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
mkdir -p "$R"
cd "$R"
systemd-run --user --scope -q --unit="measure-cmake-inventory-$$" -p MemoryMax=4G \
  /usr/bin/time -f 'inventory_wall_s=%e maxrss_kb=%M' \
  timeout 540 python3 -I "$SCR/cmake_inventory.py" "$B/compile_commands.json" "$S" "$B" "$R" \
  /mnt/d/cc-lead-notes/impl/s8d/measure-cpp/flags-cmake.tsv
