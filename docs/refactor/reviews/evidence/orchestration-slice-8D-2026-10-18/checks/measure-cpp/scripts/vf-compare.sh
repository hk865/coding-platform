#!/bin/bash
# verifier: compare own sample scans with the agent's raw NDJSON
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
R=$W/results/verify-cmsrc
C=$W/results/cmake-src
python3 -I $S/vf_compare.py "$SRC" "$R/sample-light.ndjson" "$C/light-A.ndjson" "$R/sample-ref.ndjson" "$C/ref-A.ndjson" > "$R/compare-light.json"
python3 -I $S/vf_compare.py "$SRC" "$R/sample-bodies.ndjson" "$C/lbodies-A.ndjson" > "$R/compare-bodies.json"
echo done
