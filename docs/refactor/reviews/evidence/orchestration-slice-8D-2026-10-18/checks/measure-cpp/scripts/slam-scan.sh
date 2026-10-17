#!/usr/bin/env bash
# Light include scan on the SLAM workspace copy: light, light-bodies, reference (+ find variants, strict-args).
# Usage: slam-scan.sh <step>   steps: light | bodies | reference | reference-retry | find | strict | all
set -uo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
DB="$HOME/dsh-work/measure-cpp/build/slam-ros2-ws/compile_commands.json"
ROOT="$HOME/dsh-work/measure-cpp/copies/slam-ros2-ws"
OUT="$HOME/dsh-work/measure-cpp/results/slam"
mkdir -p "$OUT"
check_mem() {
  local avail; avail=$(free -m | awk '/^Mem:/{print $7}')
  echo "available_mb=$avail"
  if [ "$avail" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
}
run() { # unit-suffix, args...
  local unit="measure-slam-$1-$$-$RANDOM"; shift
  check_mem
  systemd-run --user --scope -q --unit="$unit" -p MemoryMax=4G python3 -I "$S/light_include_scan.py" "$@"
}
step="${1:-all}"
case "$step" in
  light|all)
    run light --db "$DB" --root "$ROOT" --mode light --out "$OUT/scan.ndjson" --budget-seconds 500 ;;&
  bodies|all)
    run bodies --db "$DB" --root "$ROOT" --mode light-bodies --out "$OUT/scan.ndjson" --budget-seconds 500 ;;&
  reference|all)
    run reference --db "$DB" --root "$ROOT" --mode reference --out "$OUT/scan.ndjson" --budget-seconds 500 ;;&
  find|all)
    run find-light --db "$DB" --root "$ROOT" --mode light --directive-source find --out "$OUT/find.ndjson" --budget-seconds 500
    run find-bodies --db "$DB" --root "$ROOT" --mode light-bodies --directive-source find --out "$OUT/find.ndjson" --budget-seconds 500 ;;&
  strict|all)
    run strict --db "$DB" --root "$ROOT" --mode light --strict-args --out "$OUT/strict.ndjson" --budget-seconds 500 ;;
  raw)
    run raw --db "$DB" --root "$ROOT" --mode reference-raw --out "$OUT/scan.ndjson" --budget-seconds 500 ;;
  reps)
    # timing repetitions (separate files so the resume logic does not skip them)
    for r in 1 2 3; do
      run rep-light-$r --db "$DB" --root "$ROOT" --mode light --out "$OUT/rep$r.ndjson"
      run rep-bodies-$r --db "$DB" --root "$ROOT" --mode light-bodies --out "$OUT/rep$r.ndjson"
      run rep-findlight-$r --db "$DB" --root "$ROOT" --mode light --directive-source find --out "$OUT/repfind$r.ndjson"
    done ;;
  jobs3)
    run jobs3-light --db "$DB" --root "$ROOT" --mode light --jobs 3 --out "$OUT/jobs3.ndjson"
    run jobs3-ref --db "$DB" --root "$ROOT" --mode reference --jobs 3 --out "$OUT/jobs3.ndjson" --budget-seconds 500 ;;
  colcon)
    # colcon-layout simulation: cross-package include dirs point at install/<pkg>/include (git-ignored, not in the VFS)
    python3 -I "$S/slam_colcon_db.py" "$DB" "$OUT/compile_commands.colcon-sim.json" "$ROOT/ros2_ws/src"
    run colcon-light --db "$OUT/compile_commands.colcon-sim.json" --root "$ROOT" --mode light --out "$OUT/colcon.ndjson" ;;
  walltime)
    # whole-process wall clock of one light run (Python start, VFS build, worker start, 23 TUs)
    check_mem
    rm -f "$OUT/walltime.ndjson"
    /usr/bin/time -f "process_wall_s=%e max_rss_kb_parent=%M" python3 -I "$S/light_include_scan.py" --db "$DB" --root "$ROOT" --mode light --out "$OUT/walltime.ndjson" ;;
  reference-retry)
    # TUs that timed out at 20 s in reference mode, retried with 240 s so the reference has a result.
    run reference-retry --db "$DB" --root "$ROOT" --mode reference --timeout 240 --retry-failed --out "$OUT/scan.ndjson" --budget-seconds 290 ;;
esac
echo "lines: $(wc -l < "$OUT/scan.ndjson" 2>/dev/null)"
