#!/usr/bin/env python3
"""Line-mapped before/after comparison over ALL src files (decision 79-4).

usage: compare_mapped.py COV_DIR U0_DIFF
For each src file, lines outside the diff hunks of `git diff -U0 t-base 9a69bdb -- src` map one to one (with an
offset) from before to after. An after-T uncovered arm or function on a mapped line that was not uncovered before (at
the mapped line) lost its last test in T ("lost"). One on a line T added or rewrote is new code ("new"). One that was
uncovered before and still is: "still". Before-T uncovered entries on deleted lines: "gone with the code".
Writes COV_DIR/mapped-{lost,new}-{branches,functions}.tsv and mapped-summary.txt.
"""
import collections, os, re, sys

d, diff_path = sys.argv[1], sys.argv[2]
hunk = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
files = {}  # path -> list of (old_start, old_len, new_start, new_len)
deleted_files, added_files = set(), set()
cur = None
for line in open(diff_path, encoding="utf-8", errors="replace"):
    if line.startswith("diff --git "):
        cur = None
    elif line.startswith("--- "):
        old = line[4:].strip()
    elif line.startswith("+++ "):
        new = line[4:].strip()
        if new == "/dev/null":
            deleted_files.add(old[2:]); cur = None
        else:
            cur = new[2:]; files.setdefault(cur, [])
            if old == "/dev/null": added_files.add(cur)
    else:
        m = hunk.match(line)
        if m and cur is not None:
            os_, ol, ns, nl = int(m.group(1)), int(m.group(2) or 1), int(m.group(3)), int(m.group(4) or 1)
            files[cur].append((os_, ol, ns, nl))


def map_old(path, ln):
    """old line -> new line, or None when the old line was deleted or rewritten."""
    if path in deleted_files: return None
    hs = files.get(path)
    if not hs: return ln
    off = 0
    for os_, ol, ns, nl in hs:
        if ol == 0:            # pure insertion after old line os_
            if ln <= os_: return ln + off
            off += nl; continue
        if ln < os_: return ln + off
        if ln < os_ + ol: return None
        off += nl - ol
    return ln + off


def new_is_added(path, ln):
    if path in added_files: return True
    for os_, ol, ns, nl in files.get(path, []):
        if nl and ns <= ln < ns + nl: return True
    return False


def rows(name):
    with open(os.path.join(d, name), encoding="utf-8") as fh:
        return [tuple(l.rstrip("\n").split("\t")) for l in fh if l.strip()]


out = ["T round - line-mapped coverage comparison over all src files (decision 79-4)", ""]
for kind, bname, aname in (("branches", "before-uncovered-branches.tsv", "after-uncovered-branches.tsv"),
                           ("functions", "before-uncovered-functions.tsv", "after-uncovered-functions.tsv")):
    before = rows(bname); after = rows(aname)
    bmapped = set(); gone = 0
    for r in before:
        nl = map_old(r[0], int(r[1]))
        if nl is None: gone += 1
        else: bmapped.add((r[0], str(nl)) + tuple(r[2:]))
    lost, new, still = [], [], 0
    if kind == "functions":  # anonymous names are numbered by position in the file and shift when T adds or deletes
        def fkey(r): return (r[0], r[1]) if r[2].startswith("(anonymous") else (r[0], r[1], r[2])
        bmapped = {fkey(r) for r in bmapped}
    else:
        def fkey(r): return r
    for r in after:
        if fkey(r) in bmapped: still += 1
        elif new_is_added(r[0], int(r[1])): new.append(r)
        else: lost.append(r)
    for tag, rs in (("lost", lost), ("new", new)):
        with open(os.path.join(d, f"mapped-{tag}-{kind}.tsv"), "w", encoding="utf-8", newline="\n") as fh:
            for r in sorted(rs): fh.write("\t".join(r) + "\n")
    out.append(f"{kind}: before {len(before)} (gone with deleted or rewritten code {gone}), after {len(after)}: still {still}, lost in T {len(lost)}, on new or rewritten lines {len(new)}")
    for tag, rs in (("lost", lost), ("new", new)):
        per = collections.Counter(r[0] for r in rs)
        out.append(f"  {tag} by file ({len(per)} files):")
        for p, n in per.most_common(40): out.append(f"    {p:<78} {n:>4}")
    out.append("")
with open(os.path.join(d, "mapped-summary.txt"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(out) + "\n")
print("\n".join(out))
