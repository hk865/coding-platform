#!/bin/bash
set -euo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
R=$HOME/dsh-work/measure-cpp/results/cmake-src
free -m | awk '/Mem:/{print "available MB", $7}'
cd "$R"
systemd-run --user --scope -q --unit=cmsrc-analyze-$$ -p MemoryMax=4G \
  timeout 560 python3 -I $S/cmsrc_analyze.py --out "$R/analysis-A-B.json" --text "$R/analysis-A-B.txt"
