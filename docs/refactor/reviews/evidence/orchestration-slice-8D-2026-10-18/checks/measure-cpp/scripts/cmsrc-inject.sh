#!/bin/bash
# cmake-src fault injection: cmsrc-inject.sh select|run|report
set -euo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
R=$HOME/dsh-work/measure-cpp/results/cmake-src
AVAIL=$(free -m | awk '/Mem:/{print $7}')
echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo "STOP: available < 2000 MB"; exit 3; fi
mkdir -p "$R/inject"
cd "$R/inject"
df -h "$R" | tail -1
systemd-run --user --scope -q --unit=cmsrc-inject-$1-$$ -p MemoryMax=4G \
  timeout 560 python3 -I $S/cmsrc_inject.py "$@"
