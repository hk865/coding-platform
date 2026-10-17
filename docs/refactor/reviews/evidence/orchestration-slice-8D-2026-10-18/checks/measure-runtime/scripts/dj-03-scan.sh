#!/bin/bash
# Light Python import scan of Django 5.1.15 (walk inventory, Django's own config as draft 4 selects), with time/memory.
set -euo pipefail
WS=~/dsh-work/measure-runtime/src/django/tree/django-5.1.15
OUT=~/dsh-work/measure-runtime/results/django
SCRIPTS=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
avail=$(free -m | awk '/^Mem:/{print $7}')
echo "available MB: $avail"
if [ "$avail" -le 2000 ]; then echo "not enough memory"; exit 1; fi
cd /
for run in 1 2 3; do
  systemd-run --user --scope -q -p MemoryMax=6G /usr/bin/time -v -o "$OUT/scan-time-$run.txt" \
    python3 -I "$SCRIPTS/light_import_scan.py" "$WS" --literal-dynamic --out "$OUT/scan-$run.json"
  grep -E 'Elapsed|Maximum resident' "$OUT/scan-time-$run.txt"
done
cmp "$OUT/scan-1.json" "$OUT/scan-2.json" >/dev/null && echo "run1==run2 (byte-identical json except stats?)" || echo "run1 != run2 (stats differ, expected)"
