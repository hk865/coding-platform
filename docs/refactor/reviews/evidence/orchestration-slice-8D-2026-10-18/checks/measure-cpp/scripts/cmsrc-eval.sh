#!/bin/bash
# cmake-src: evaluate the three scenario-A runs (rules R0-R3, edges, diffs, truth = reference:R1).
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
R=$W/results/cmake-src
cd "$R"
python3 -I $S/evaluate_rules.py --root "$SRC" --out "$R/eval-A.json" --text "$R/eval-A.txt" --list-limit 2000 \
  "$R/light-A.ndjson" "$R/lbodies-A.ndjson" "$R/ref-A.ndjson" | head -80
