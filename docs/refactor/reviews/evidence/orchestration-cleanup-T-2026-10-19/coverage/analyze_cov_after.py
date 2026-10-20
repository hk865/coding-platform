#!/usr/bin/env python3
"""Summarise an istanbul coverage-final.json and the vitest log for the T-round 'after' measurement.

usage: analyze_cov.py COPY_ROOT LOG_PATH OUT_DIR META_PATH SAMPLES_PATH BUILD_RC [NOTE]
"""
import json
import os
import re
import shutil
import sys
from collections import defaultdict

copy_root, log_path, out_dir, meta_path, samples_path, build_rc = sys.argv[1:7]
note = sys.argv[7] if len(sys.argv) > 7 else ""
copy_root = os.path.abspath(copy_root)
cov_dir = os.path.join(copy_root, "coverage-after")
os.makedirs(out_dir, exist_ok=True)

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")


def rel(p):
    p = os.path.abspath(p)
    if p.startswith(copy_root + os.sep):
        return p[len(copy_root) + 1:]
    return p


def pct(c, t):
    return 100.0 if t == 0 else 100.0 * c / t


def fmt(c, t):
    return f"{c}/{t} ({pct(c, t):.2f}%)"


def group_of(rp):
    parts = rp.split("/")
    # parts[0] == 'src'
    if len(parts) >= 2 and parts[1] == "core":
        # two levels below src/core/ when the file is deep enough
        if len(parts) >= 5:
            return "/".join(parts[:4])
        if len(parts) == 4:
            return "/".join(parts[:3])
        return "/".join(parts[:2])
    if len(parts) >= 3:
        return "/".join(parts[:2])
    return "src (root files)"


with open(os.path.join(cov_dir, "coverage-final.json"), encoding="utf-8") as fh:
    final = json.load(fh)

tot = {"s": [0, 0], "b": [0, 0], "f": [0, 0], "l": [0, 0]}
groups = defaultdict(lambda: {"files": 0, "s": [0, 0], "b": [0, 0], "f": [0, 0], "l": [0, 0]})
unc_fns = []
unc_br = []
zero_files = []
no_stmt_files = []

for key, fc in final.items():
    rp = rel(fc.get("path", key))
    smap, s = fc.get("statementMap", {}), fc.get("s", {})
    fmap, f = fc.get("fnMap", {}), fc.get("f", {})
    bmap, b = fc.get("branchMap", {}), fc.get("b", {})

    sc = sum(1 for k in smap if s.get(k, 0) > 0)
    st = len(smap)
    fcv = sum(1 for k in fmap if f.get(k, 0) > 0)
    ft = len(fmap)
    bc = bt = 0
    for k, arms in b.items():
        bt += len(arms)
        bc += sum(1 for a in arms if a > 0)
    # istanbul line coverage: line of each statement start, covered if any statement there ran
    lines = {}
    for k, loc in smap.items():
        ln = loc["start"]["line"]
        cnt = s.get(k, 0)
        if ln not in lines or lines[ln] < cnt:
            lines[ln] = cnt
    lc = sum(1 for v in lines.values() if v > 0)
    lt = len(lines)

    g = groups[group_of(rp)]
    g["files"] += 1
    for name, (c, t) in (("s", (sc, st)), ("b", (bc, bt)), ("f", (fcv, ft)), ("l", (lc, lt))):
        tot[name][0] += c
        tot[name][1] += t
        g[name][0] += c
        g[name][1] += t

    if st == 0:
        no_stmt_files.append(rp)
    elif sc == 0:
        zero_files.append(rp)

    for k, fn in fmap.items():
        if f.get(k, 0) == 0:
            line = (fn.get("decl") or {}).get("start", {}).get("line") or fn.get("line") or \
                (fn.get("loc") or {}).get("start", {}).get("line") or 0
            unc_fns.append((rp, int(line), fn.get("name") or "(anonymous)"))

    for k, br in bmap.items():
        arms = b.get(k, [])
        locs = br.get("locations") or []
        bline = br.get("line") or (br.get("loc") or {}).get("start", {}).get("line") or 0
        for i, cnt in enumerate(arms):
            if cnt == 0:
                aline = None
                if i < len(locs) and locs[i] and locs[i].get("start", {}).get("line"):
                    aline = locs[i]["start"]["line"]
                unc_br.append((rp, int(aline or bline), br.get("type") or "?", i, len(arms)))

unc_fns.sort()
unc_br.sort()
zero_files.sort()
no_stmt_files.sort()

with open(os.path.join(out_dir, "after-uncovered-functions.tsv"), "w", encoding="utf-8", newline="\n") as fh:
    for r in unc_fns:
        fh.write(f"{r[0]}\t{r[1]}\t{r[2]}\n")
with open(os.path.join(out_dir, "after-uncovered-branches.tsv"), "w", encoding="utf-8", newline="\n") as fh:
    for r in unc_br:
        fh.write(f"{r[0]}\t{r[1]}\t{r[2]}\t{r[3]}\t{r[4]}\n")
with open(os.path.join(out_dir, "after-zero-files.txt"), "w", encoding="utf-8", newline="\n") as fh:
    for r in zero_files:
        fh.write(r + "\n")

# cross-check against vitest's own json-summary
summary_path = os.path.join(cov_dir, "coverage-summary.json")
vsum = None
if os.path.exists(summary_path):
    with open(summary_path, encoding="utf-8") as fh:
        vsum = json.load(fh).get("total")
    shutil.copyfile(summary_path, os.path.join(out_dir, "after-coverage-summary.json"))

out = []
out.append("T round - coverage after (V8, vitest 4.1.10, include src/**)")
out.append(f"copy: {copy_root}  files in report: {len(final)}")
if note:
    out.append(f"note: {note}")
out.append("")
out.append("Totals (computed from coverage-final.json)")
out.append(f"  statements {fmt(*tot['s'])}")
out.append(f"  branches   {fmt(*tot['b'])}")
out.append(f"  functions  {fmt(*tot['f'])}")
out.append(f"  lines      {fmt(*tot['l'])}")
if vsum:
    out.append("Totals (vitest coverage-summary.json)")
    for k in ("statements", "branches", "functions", "lines"):
        v = vsum.get(k, {})
        out.append(f"  {k:<10} {v.get('covered')}/{v.get('total')} ({v.get('pct')}%)")
out.append("")
out.append(f"zero files (statements > 0, none executed): {len(zero_files)}")
out.append(f"files with no statements at all (type-only etc., not in the zero list): {len(no_stmt_files)}")
out.append(f"uncovered functions: {len(unc_fns)}   uncovered branch arms: {len(unc_br)}")
out.append("TSV columns: functions = path, declaration line, name; "
           "branches = path, arm start line (branch line if the arm has none), type, arm index, arm count")
out.append("")
out.append("Per directory (src/<top>; src/core/<a>/<b>), sorted by uncovered statements")
hdr = f"{'directory':<44} {'files':>5} {'unc.stmt':>8}  {'statements':>22}  {'branches':>22}  {'functions':>20}  {'lines':>22}"
out.append(hdr)
out.append("-" * len(hdr))
rows = sorted(groups.items(), key=lambda kv: (-(kv[1]["s"][1] - kv[1]["s"][0]), kv[0]))
for name, g in rows:
    out.append(f"{name:<44} {g['files']:>5} {g['s'][1] - g['s'][0]:>8}  {fmt(*g['s']):>22}  {fmt(*g['b']):>22}  "
               f"{fmt(*g['f']):>20}  {fmt(*g['l']):>22}")
out.append("")
out.append("Files with no statements at all:")
for r in no_stmt_files:
    out.append("  " + r)
with open(os.path.join(out_dir, "after-summary.txt"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(out) + "\n")

# log processing
with open(log_path, encoding="utf-8", errors="replace") as fh:
    clean = ANSI.sub("", fh.read()).replace("\r", "")
clines = clean.split("\n")
with open(os.path.join(out_dir, "after-suite-tail.txt"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(clines[-60:]) + "\n")
summary_lines = [l.strip() for l in clines if re.match(r"^\s*(Test Files|Tests|Duration|Errors)\s", l)]
fail_files = set()
for l in clines:
    m = re.match(r"^\s*FAIL\s+(\S+\.test\.ts)", l)
    if m:
        fail_files.add(m.group(1))
    m = re.match(r"^\s*[❯×✗]\s+(\S+\.test\.ts)\s+\(.*failed", l)
    if m:
        fail_files.add(m.group(1))

meta = open(meta_path, encoding="utf-8").read().strip() if os.path.exists(meta_path) else "(no meta)"
peak = None
sample_count = 0
max_cur = 0
min_avail = None
if os.path.exists(samples_path):
    for l in open(samples_path, encoding="utf-8"):
        m = re.search(r"peak=(\d+) current=(\d+) avail_mb=(\d+)", l)
        if m:
            sample_count += 1
            p, c, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
            peak = p if peak is None or p > peak else peak
            max_cur = max(max_cur, c)
            min_avail = a if min_avail is None or a < min_avail else min_avail
run = []
run.append(f"build (npm run -s build) exit code: {build_rc}")
run.append(meta)
if note:
    run.append(f"note: {note}")
run.append("")
run.append("suite summary lines:")
run.extend("  " + l for l in summary_lines)
run.append("")
run.append(f"failing files ({len(fail_files)}):")
run.extend("  " + f for f in sorted(fail_files))
run.append("")
if peak is not None:
    run.append(f"scope MemoryPeak (max over {sample_count} samples, 10 s apart): {peak} bytes = {peak / 2**20:.0f} MiB")
    run.append(f"max MemoryCurrent sampled: {max_cur / 2**20:.0f} MiB; lowest machine 'available' sampled: {min_avail} MB")
else:
    run.append("scope MemoryPeak: no samples")
with open(os.path.join(out_dir, "after-run.txt"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(run) + "\n")

print("\n".join(out[:20]))
print("\n".join(run))
print(f"rows: functions={len(unc_fns)} branches={len(unc_br)} zero_files={len(zero_files)} no_stmt={len(no_stmt_files)}")
