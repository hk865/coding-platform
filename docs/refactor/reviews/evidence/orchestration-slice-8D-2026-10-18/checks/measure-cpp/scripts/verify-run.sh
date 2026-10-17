#!/usr/bin/env bash
# Adversarial re-check of the SLAM measurement.  Usage: verify-run.sh <step>
set -uo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
DB="$HOME/dsh-work/measure-cpp/build/slam-ros2-ws/compile_commands.json"
ROOT="$HOME/dsh-work/measure-cpp/copies/slam-ros2-ws"
OUT="$HOME/dsh-work/measure-cpp/results/slam-verify"
INJ="$HOME/dsh-work/measure-cpp/results/slam/inject"
FIX="$HOME/dsh-work/measure-cpp/fixtures"
mkdir -p "$OUT"
check_mem() {
  local avail; avail=$(free -m | awk '/^Mem:/{print $7}')
  echo "available_mb=$avail"
  if [ "$avail" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
}
run() { local unit="verify-slam-$1-$$-$RANDOM"; shift; check_mem
  systemd-run --user --scope -q --unit="$unit" -p MemoryMax=4G timeout 540 python3 -I "$S/verify_slam.py" "$@"; }
case "${1:-}" in
  light)
    for rep in 1 2 3; do
      run light$rep scan --db "$DB" --root "$ROOT" --mode light --out "$OUT/light-r$rep.json"
    done
    run bodies scan --db "$DB" --root "$ROOT" --mode light-bodies --out "$OUT/light-bodies.json"
    run colcon scan --db "$HOME/dsh-work/measure-cpp/results/slam/compile_commands.colcon-sim.json" --root "$ROOT" --mode light --out "$OUT/colcon-light.json" ;;
  ref)
    run ref scan --db "$DB" --root "$ROOT" --mode reference-raw --out "$OUT/reference-raw.json" ;;
  misc)
    run args args --db "$DB" --root "$ROOT"
    run macros macros --fixture-dir "$FIX/verify-macros"
    run bodyinc bodyinc --fixture-dir "$FIX/verify-bodyinc"
    run conds conds --root "$ROOT" ;;
  inject)
    for t in ${2:-t00-K1 t01-K2 t02-K3 t05-K3 t12-K1 t15-K2 t20-K1 t21-K3 t29-K3 t30-K1b t35-K1b}; do
      for m in light light-bodies; do
        run inj scan --db "$INJ/$t/compile_commands.json" --root "$INJ/$t/ws" --mode $m --out "$OUT/inj-$t-$m.json"
      done
    done ;;
  inject-ref)
    for t in ${2:-t29-K3 t02-K3 t21-K3}; do
      run injref scan --db "$INJ/$t/compile_commands.json" --root "$INJ/$t/ws" --mode reference-raw --out "$OUT/inj-$t-reference-raw.json"
    done ;;
esac
