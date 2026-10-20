#!/usr/bin/env python3
"""Build the coverage triage lists (decision 79-4) with the before-T line for each after-T row.

usage: mk-triage-lists.py COV_DIR U0_DIFF OUT_DIR
Groups: A = lost in T (mapped-lost-*), B = uncovered on lines T added or rewrote (mapped-new-branches), C = functions
uncovered before and after T outside src/ui. Columns: group, path, after line, before line ('-' on new lines), kind,
name or branch type, arm index, arm count.
"""
import collections, os, re, sys
d, diff_path, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
hunk = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
files, cur = {}, None
for line in open(diff_path, encoding="utf-8", errors="replace"):
    if line.startswith("+++ "):
        n = line[4:].strip(); cur = None if n == "/dev/null" else n[2:]
        if cur: files.setdefault(cur, [])
    else:
        m = hunk.match(line)
        if m and cur:
            files[cur].append((int(m.group(1)), int(m.group(2) or 1), int(m.group(3)), int(m.group(4) or 1)))

def to_old(path, ln):
    off = 0
    for os_, ol, ns, nl in files.get(path, []):
        if nl and ns <= ln < ns + nl: return None
        if (nl == 0 and ln <= ns) or (nl and ln < ns): return ln - off
        off += nl - ol
    return ln - off

def rows(name):
    return [l.rstrip("\n").split("\t") for l in open(os.path.join(d, name), encoding="utf-8") if l.strip()]

grp = collections.defaultdict(list)
for r in rows("mapped-lost-branches.tsv"): grp["A"].append(["A", r[0], r[1], str(to_old(r[0], int(r[1])) or "-"), "branch", r[2], r[3], r[4]])
for r in rows("mapped-lost-functions.tsv"): grp["A"].append(["A", r[0], r[1], str(to_old(r[0], int(r[1])) or "-"), "function", r[2], "", ""])
for r in rows("mapped-new-branches.tsv"): grp["B"].append(["B", r[0], r[1], "-", "branch", r[2], r[3], r[4]])
lost_f = {(r[0], r[1]) for r in rows("mapped-lost-functions.tsv")}
for r in rows("after-uncovered-functions.tsv"):
    if r[0].startswith("src/ui/") or (r[0], r[1]) in lost_f: continue
    grp["C"].append(["C", r[0], r[1], str(to_old(r[0], int(r[1])) or "-"), "function", r[2], "", ""])
hdr = "group\tpath\tline_after\tline_before\tkind\tname_or_type\tarm\tarms\n"
for g, rs in grp.items():
    with open(os.path.join(out, f"cand-{g}.tsv"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(hdr); [fh.write("\t".join(r) + "\n") for r in sorted(rs, key=lambda r: (r[1], int(r[2])))]
    print(g, len(rs), "rows", len({r[1] for r in rs}), "files")
