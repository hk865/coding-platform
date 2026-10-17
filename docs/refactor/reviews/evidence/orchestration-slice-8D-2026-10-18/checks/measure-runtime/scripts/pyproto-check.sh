#!/usr/bin/env bash
# Rebuild the prototype's own fixtures (A-20, A-21, X1-X6) and check light_import_scan.py against them.
# Run in WSL:  bash /mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts/pyproto-check.sh
set -euo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
F="$HOME/dsh-work/measure-runtime/fixtures/python-prototype"
R="$HOME/dsh-work/measure-runtime/results/python-prototype/fixtures"
OUT=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/prototype/validation.txt
cd /
rm -rf -- "$F"          # only this prototype's own fixture directory
mkdir -p "$R"
python3 -I "$S/pyproto_check.py" "$F" "$R" | tee "$OUT"
