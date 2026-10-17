#!/usr/bin/env bash
# SLAM copy (no download): Python light import scan (draft 4 section 11.3 prototype) with --literal-dynamic,
# plus a cheap rerun of the C/C++ light include scan (same DB as measure-cpp) to get the include edge list.
set -uo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
ROOT="$HOME/dsh-work/measure-cpp/copies/slam-ros2-ws"
DB="$HOME/dsh-work/measure-cpp/build/slam-ros2-ws/compile_commands.json"
OUT="$HOME/dsh-work/measure-runtime/results/slam"
mkdir -p "$OUT"
cd /
avail=$(free -m | awk '/^Mem:/{print $7}'); echo "available_mb=$avail"
if [ "$avail" -le 2000 ]; then echo "ABORT: WSL available <= 2000 MB"; exit 5; fi
# Python: whole copy (= git tracked + 1 untracked file, so no --file-list), and the ros2_ws/ subtree as a second view
/usr/bin/time -f "py_wall_s=%e max_rss_kb=%M" python3 -I "$S/light_import_scan.py" "$ROOT" --literal-dynamic --pretty --out "$OUT/py-scan.json"
# file-list variant: exactly the files git would list (all files of the copy), to show the result does not change
(cd "$ROOT" && find . -type f -printf '%P\n' | sort) > "$OUT/copy-files.txt"
python3 -I "$S/light_import_scan.py" "$ROOT" --file-list "$OUT/copy-files.txt" --literal-dynamic --pretty --out "$OUT/py-scan-filelist.json"
# C/C++: light mode rerun (0.4 s in measure-cpp), own output file
rm -f "$OUT/cpp-light.ndjson"
systemd-run --user --scope -q -p MemoryMax=6G python3 -I "$S/light_include_scan.py" --db "$DB" --root "$ROOT" --mode light --out "$OUT/cpp-light.ndjson" --budget-seconds 120
echo "cpp lines: $(wc -l < "$OUT/cpp-light.ndjson")"
