#!/usr/bin/env bash
# Self-test of light_include_scan.py + evaluate_rules.py on the synthetic fixture.
set -euo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
R="$HOME/dsh-work/measure-cpp/fixtures/selftest"
OUT="$HOME/dsh-work/measure-cpp/results/selftest"
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
bash "$S/selftest-make-fixture.sh"
rm -rf "$OUT"; mkdir -p "$OUT"
run() { # unit-suffix, args...
  local unit="measure-selftest-$1-$$"; shift
  systemd-run --user --scope -q --unit="$unit" -p MemoryMax=4G python3 -I "$S/light_include_scan.py" "$@"
}
for mode in light light-bodies reference; do
  echo "--- scan $mode"
  run "$mode" --db "$R/compile_commands.json" --root "$R" --mode "$mode" --out "$OUT/scan.ndjson"
done
for mode in light reference; do
  echo "--- scan $mode with --directive-source find (separate file)"
  run "find-$mode" --db "$R/compile_commands.json" --root "$R" --mode "$mode" --directive-source find --out "$OUT/find.ndjson"
done
echo "--- light with --body-extents on (separate file)"
run light-body-on --db "$R/compile_commands.json" --root "$R" --mode light --body-extents on --out "$OUT/light-bodyextents.ndjson"
echo "--- injection: hang healthy.c, crash vec.cpp, 3 s timeout, 2 workers"
run inject --db "$R/compile_commands.json" --root "$R" --mode light --timeout 3 --jobs 2 \
  --inject hang=src/healthy.c --inject crash=src/vec.cpp --out "$OUT/inject.ndjson"
echo "--- resumability: first 5, then all, then again (expect scheduled 0)"
run resume1 --db "$R/compile_commands.json" --root "$R" --mode light --to 5 --out "$OUT/resume.ndjson"
run resume2 --db "$R/compile_commands.json" --root "$R" --mode light --out "$OUT/resume.ndjson"
run resume3 --db "$R/compile_commands.json" --root "$R" --mode light --out "$OUT/resume.ndjson"
echo "lines in resume.ndjson: $(wc -l < "$OUT/resume.ndjson")"
echo "--- strict args"
run strict --db "$R/compile_commands.json" --root "$R" --mode light --strict-args --out "$OUT/strict.ndjson"
echo "=== evaluate (expected vs got)"
python3 -I "$S/evaluate_rules.py" --root "$R" --expect "$S/selftest_expected.json" --out "$OUT/eval.json" --text "$OUT/eval.txt" "$OUT/scan.ndjson"
echo "=== evaluate find runs against the same expectations (light, reference)"
python3 -I "$S/evaluate_rules.py" --root "$R" --expect "$S/selftest_expected.json" --out "$OUT/eval-find.json" "$OUT/find.ndjson" | grep -E "^== (expected|diff)|mismatches|NO \|"
python3 -I - "$OUT/scan.ndjson" "$OUT/find.ndjson" <<'PY'
import json, sys
def directives(path):
    out = {}
    for line in open(path):
        r = json.loads(line)
        if r['mode'] in ('light', 'reference'):
            out[(r['mode'], r['tu_index'])] = sorted((x['file'], x['line'], x['spelled'], x['resolved'] or '') for x in r.get('inclusions', []))
    return out
a, b = directives(sys.argv[1]), directives(sys.argv[2])
print('visit vs find: TUs compared', len(a), 'identical directive lists', sum(a[k] == b.get(k) for k in a))
PY
echo "=== evaluate injection run"
python3 -I "$S/evaluate_rules.py" --root "$R" --out "$OUT/eval-inject.json" "$OUT/inject.ndjson" | head -12
