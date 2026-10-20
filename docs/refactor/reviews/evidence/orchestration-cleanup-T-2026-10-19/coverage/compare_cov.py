#!/usr/bin/env python3
"""Compare the T-round coverage before and after (decision 79-4).

usage: compare_cov.py COV_DIR
Reads COV_DIR/before-uncovered-functions.tsv, after-uncovered-functions.tsv, before-/after-uncovered-branches.tsv,
before-/after-zero-files.txt and the two coverage-summary json files; writes COV_DIR/compare-*.{txt,tsv}.

Functions are matched by (path, name), not line (T moved most lines). Anonymous functions are matched by
(path, name, n-th occurrence) and are reported separately because their names shift. Branch arms are compared as
counts per file; the after list is the candidate list.
"""
import collections
import json
import os
import sys

d = sys.argv[1]


def rows(name):
    out = []
    with open(os.path.join(d, name), encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line:
                out.append(line.split("\t"))
    return out


def fn_keys(rs):
    seen = collections.Counter()
    keys = {}
    for r in rs:
        path, line, name = r[0], r[1], r[2]
        k = (path, name)
        seen[k] += 1
        keys[(path, name, seen[k])] = int(line)
    return keys


bf, af = fn_keys(rows("before-uncovered-functions.tsv")), fn_keys(rows("after-uncovered-functions.tsv"))
anon = lambda k: k[1].startswith("(anonymous")
still = sorted(k for k in af if k in bf)
new = sorted(k for k in af if k not in bf)
gone = sorted(k for k in bf if k not in af)

bb = collections.Counter(r[0] for r in rows("before-uncovered-branches.tsv"))
ab = collections.Counter(r[0] for r in rows("after-uncovered-branches.tsv"))


def zero(name):
    with open(os.path.join(d, name), encoding="utf-8") as fh:
        return [l.strip() for l in fh if l.strip() and not l.startswith("#")]


def total(name):
    with open(os.path.join(d, name), encoding="utf-8") as fh:
        return json.load(fh)["total"]


tb, ta = total("coverage-summary.json"), total("after-coverage-summary.json")
out = ["T round - coverage before vs after (decision 79-4)", ""]
out.append("Totals             before                      after")
for m in ("statements", "branches", "functions", "lines"):
    b, a = tb[m], ta[m]
    out.append(f"  {m:<11} {b['covered']:>6}/{b['total']:<6} ({b['pct']:.2f}%)    {a['covered']:>6}/{a['total']:<6} ({a['pct']:.2f}%)")
out.append("")
out.append(f"Uncovered functions: before {len(bf)}, after {len(af)}")
out.append(f"  still uncovered (same path and name): {len(still)}  (named {sum(not anon(k) for k in still)}, anonymous {sum(anon(k) for k in still)})")
out.append(f"  uncovered only after (new code, or coverage lost in T): {len(new)}  (named {sum(not anon(k) for k in new)}, anonymous {sum(anon(k) for k in new)})")
out.append(f"  uncovered only before (deleted in T, or now covered): {len(gone)}  (named {sum(not anon(k) for k in gone)}, anonymous {sum(anon(k) for k in gone)})")
out.append("")
out.append(f"Uncovered branch arms: before {sum(bb.values())}, after {sum(ab.values())}")
files = sorted(set(bb) | set(ab), key=lambda p: (ab[p] - bb[p]), reverse=True)
up = [(p, bb[p], ab[p]) for p in files if ab[p] > bb[p]]
out.append(f"  files with more uncovered arms after T: {len(up)}  (top 25 below)")
for p, b, a in up[:25]:
    out.append(f"    {p:<80} {b:>5} -> {a:>5}  (+{a - b})")
zb, za = set(zero("before-zero-files.txt")), set(zero("after-zero-files.txt"))
out.append("")
out.append(f"Zero-execution files: before {len(zb)}, after {len(za)}; new after: {sorted(za - zb)}")
with open(os.path.join(d, "compare-summary.txt"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(out) + "\n")


def dump(name, keys, src):
    with open(os.path.join(d, name), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("path\tline\tname\toccurrence\n")
        for k in keys:
            fh.write(f"{k[0]}\t{src[k]}\t{k[1]}\t{k[2]}\n")


dump("compare-functions-still.tsv", still, af)
dump("compare-functions-new.tsv", new, af)
dump("compare-functions-gone.tsv", gone, bf)
with open(os.path.join(d, "compare-branches-per-file.tsv"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write("path\tbefore\tafter\tdelta\n")
    for p in sorted(set(bb) | set(ab)):
        fh.write(f"{p}\t{bb[p]}\t{ab[p]}\t{ab[p] - bb[p]}\n")
print("\n".join(out))
