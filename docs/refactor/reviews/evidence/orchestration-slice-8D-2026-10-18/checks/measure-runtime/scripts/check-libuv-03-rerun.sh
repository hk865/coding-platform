#!/usr/bin/env bash
# Checker (libuv): run the thing under test (the patched prototype) once more on layout A, with MY OWN material list,
# output into the checker's folder; then my own evaluator and the GCC comparison on that fresh output.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/libuv/libuv-v1.48.0"
DB="$ROOT/build/libuv-out/compile_commands.json"
CK="$ROOT/results/libuv/check"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "available_mb=$AVAIL"
if [ "$AVAIL" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
cd "$CK"
python3 -I -c '
import json, sys
d = json.load(open(sys.argv[1]))
print(len(d["claimed"]))' db.json
python3 -I - "$S" "$CK/not-ignored.z" "$CK/vfs-mine.txt" <<'EOF'
import os, sys
root, listing, out = sys.argv[1:4]
CPP = {'.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc'}
keep = []
for p in sorted(x.decode() for x in open(listing, 'rb').read().split(b'\0') if x):
    name = p.rsplit('/', 1)[-1]
    dot = name.rfind('.')
    ext = name[dot:].lower() if dot > 0 else ''
    full = os.path.join(root, p)
    if os.path.islink(full) or not os.path.isfile(full):
        continue
    if ext in CPP or ext == '.def' or '.' not in name:
        data = open(full, 'rb').read()
        if len(data) <= 2 * 1024 * 1024 and b'\0' not in data:
            keep.append(p)
open(out, 'w').write('\n'.join(keep) + '\n')
print('vfs files', len(keep))
EOF
cmp <(sort "$CK/vfs-mine.txt") <(sort "$ROOT/results/libuv/A.vfs.txt") && echo "my vfs list == measuring agent's A.vfs.txt"
rm -f "$CK/A-light-check.ndjson"
systemd-run --user --scope -q --unit="uv-check-rerun-$$" -p MemoryMax=6G \
  /usr/bin/time -v -o "$CK/A-light-check.time.txt" \
  timeout 900 python3 -I "$SC/uv_light_include_scan.py" --db "$DB" --root "$S" --mode light \
  --out "$CK/A-light-check.ndjson" --file-list "$CK/vfs-mine.txt" --timeout 20 --jobs 1 | tail -c 600
echo
grep -E 'Elapsed|Maximum resident' "$CK/A-light-check.time.txt"
python3 -I "$SC/check_libuv_eval.py" "$CK/A-light-check.ndjson" "$DB" "$S" "$CK/not-ignored.z" "$CK/evalA-rerun.json" | grep -E '"(edges|unresolved|ok|parsed|skipped|failure_diagnostics_count|n|sum|p50|p95|max)"'
python3 -I "$SC/check_libuv_compare.py" "$CK/evalA-rerun.json" "$CK/gcc-dI.json" "$CK/cmpA-rerun.json" | grep -E '"(edges_light|edges_gcc|unresolved_light|units_read_set_differs)"'
python3 -I -c '
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
print("rerun edges == first-run edges:", a["edges"] == b["edges"], "; unresolved equal:", a["unresolved"] == b["unresolved"], "; status equal:", a["status"] == b["status"])' "$CK/evalA.json" "$CK/evalA-rerun.json"
