#!/bin/bash
# verifier: own scanner, scenario B (root = work dir, VFS = source + build trees), all TUs, light; then aggregate
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
DB=$W/build/cmake-3.30.5/compile_commands.json
R=$W/results/verify-cmsrc
AVAIL=$(free -m | awk '/Mem:/{print $7}'); echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo STOP; exit 3; fi
systemd-run --user --scope -q --unit=vf-fullB-$$ -p MemoryMax=4G \
  timeout 540 python3 -I $S/vf_scan.py --db "$DB" --root "$W" --file-list "$W/results/cmake-src/vfs-files-B.txt" \
  --mode light --out "$R/fullB-light.ndjson" --all --tag fullB
python3 -I $S/vf_aggregate.py "$W" "$W/results/cmake-src/vfs-files-B.txt" "$R/fullB-light.ndjson" > "$R/aggregateB-light.json"
python3 -I -c '
import json,sys; a=json.load(open(sys.argv[1]))
print({k:a[k] for k in a if k.startswith("failed_") or k in ("status","edge_pairs","edge_directives","unresolved_directives_any_tu","unresolved_by_delim","angled_recovered_directives","n_tus_err_before","tus_with_error_before_first_missing","first_missing_rank","macro_directives")})' "$R/aggregateB-light.json"
