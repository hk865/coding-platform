#!/usr/bin/env bash
# Error injection on copies of the SLAM workspace (task c).  Usage: slam-inject.sh prepare | run | run-ref
set -uo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
DB="$HOME/dsh-work/measure-cpp/build/slam-ros2-ws/compile_commands.json"
ROOT="$HOME/dsh-work/measure-cpp/copies/slam-ros2-ws"
OUT="$HOME/dsh-work/measure-cpp/results/slam"
DIR="$OUT/inject"
avail=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$avail"
if [ "$avail" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
case "${1:-}" in
  prepare)
    systemd-run --user --scope -q --unit="measure-slam-injprep-$$" -p MemoryMax=4G \
      python3 -I "$S/inject_prepare.py" --db "$DB" --root "$ROOT" --scan "$OUT/scan.ndjson" --vfs "$OUT/scan.ndjson.vfs.json" \
      --out-dir "$DIR" --extra-k1b ;;
  run)
    systemd-run --user --scope -q --unit="measure-slam-injrun-$$" -p MemoryMax=4G \
      python3 -I "$S/inject_run.py" --dir "$DIR" --modes light,light-bodies --budget 480 ;;
  run-ref)
    systemd-run --user --scope -q --unit="measure-slam-injref-$$" -p MemoryMax=4G \
      python3 -I "$S/inject_run.py" --dir "$DIR" --modes reference-raw --budget 500 ;;
esac
