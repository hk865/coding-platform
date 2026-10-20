#!/usr/bin/env python3
"""Exact before/after comparison on the src files T did not change (decision 79-4).

usage: compare_lost.py COV_DIR CHANGED_LIST
In a file T did not change, a line number means the same code before and after, so an arm or function that is
uncovered only after T lost its last test in T. Writes COV_DIR/compare-lost-*.tsv, compare-gained-*.tsv and
compare-lost-summary.txt.
"""
import collections
import os
import sys

d, changed_list = sys.argv[1], sys.argv[2]
changed = {l.strip() for l in open(changed_list, encoding="utf-8") if l.strip()}


def rows(name):
    with open(os.path.join(d, name), encoding="utf-8") as fh:
        return [tuple(l.rstrip("\n").split("\t")) for l in fh if l.strip()]


out = ["T round - coverage lost or gained in src files T did not change", ""]
for kind, bname, aname in (("branches", "before-uncovered-branches.tsv", "after-uncovered-branches.tsv"),
                           ("functions", "before-uncovered-functions.tsv", "after-uncovered-functions.tsv")):
    b = {r for r in rows(bname) if r[0] not in changed}
    a = {r for r in rows(aname) if r[0] not in changed}
    lost, gained = sorted(a - b), sorted(b - a)
    for tag, rs in (("lost", lost), ("gained", gained)):
        with open(os.path.join(d, f"compare-{tag}-{kind}.tsv"), "w", encoding="utf-8", newline="\n") as fh:
            for r in rs:
                fh.write("\t".join(r) + "\n")
    per = collections.Counter(r[0] for r in lost)
    out.append(f"{kind}: uncovered before {len(b)}, after {len(a)} (unchanged files only); lost in T {len(lost)}, gained {len(gained)}")
    for p, n in per.most_common(30):
        out.append(f"    {p:<80} {n:>4}")
    out.append("")
with open(os.path.join(d, "compare-lost-summary.txt"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(out) + "\n")
print("\n".join(out))
