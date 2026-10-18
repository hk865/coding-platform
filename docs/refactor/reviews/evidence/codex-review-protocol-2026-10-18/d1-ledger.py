#!/usr/bin/env python3
"""D1 assertion ledger and D3 pure-file guard (lead tool, decision 80).

Usage: python3 -I d1-ledger.py <repo> <base> <head> [--pathspec tests]

Cumulative from <base> to <head>, lists every change in tests that may weaken a test:
  - REMOVED test/describe, assertion or backend list (a line whose normalized text is
    added anywhere else in the diff is MOVED and not counted);
  - LOOSENED: within one hunk, a strict matcher on a subject replaced by a loose one;
  - skip/todo/only/skipIf added; RAISED timeouts (a hunk that removes a timeout and adds
    a larger one) and NEW timeouts in files that existed at <base>;
  - single-backend lists added; ALL_CAPS constants as expected values;
  - DELETED test files (listed once, with their test and expect counts).
Then the D3 guard: each `*-pure.test.ts` at <head> that imports a store, platform, Host,
Workflow, Runtime, fixture, harness or stub.
"""
import re
import subprocess
import sys
from collections import Counter, defaultdict

ASSERT = re.compile(r"\bexpect\s*\(|\.rejects\b|\.resolves\b|\bassert\w*\s*\(")
TEST = re.compile(r"^\s*(it|test|describe)(\.each\b[^(]*)?\s*\(")
TEST_COUNT = re.compile(r"^\s*(?:it|test)(?:\.each[^(]*)?\s*\(", re.M)
EXPECT_COUNT = re.compile(r"\bexpect\s*\(")
MODIFIER = re.compile(r"\b(it|test|describe)\.(skip|todo|only|skipIf|runIf)\b|\bctx\.skip\b")
LOOSE = re.compile(r"toMatchObject|toContain|toBeDefined|toBeTruthy|toBeFalsy|expect\.any|expect\.anything|"
                   r"objectContaining|arrayContaining|stringContaining|toBeGreaterThan|toBeLessThan|not\.toThrow")
STRICT = re.compile(r"toEqual|toStrictEqual|toBe\(|toHaveLength|toThrow\(")
TIMEOUT_NUM = re.compile(r"(?:timeout\s*[:=]\s*|,\s*)(\d[\d_]{3,})\s*\)?\s*[;,]?\s*$|[Tt]imeout\s*[:=]\s*(\d[\d_]{2,})")
BACKENDS = re.compile(r"\[\s*'(memory|sqlite)'\s*(,\s*'(memory|sqlite)'\s*)?\]")
BOTH = re.compile(r"'memory'.*'sqlite'|'sqlite'.*'memory'")
CONST_IN_EXPECT = re.compile(r"\bexpect\b.*\.(toBe|toEqual|toStrictEqual|toHaveLength)\(\s*[A-Z][A-Z0-9_]{2,}\b")
SUBJECT = re.compile(r"expect\s*\(\s*([^,)]{1,80})")
# A pure test may import pure functions from any src module; it may not import test worlds,
# stores, the platform, the Host, a Workflow or the Runtime factory, or build stub ports.
PURE_FORBIDDEN = re.compile(
    r"from\s+['\"][^'\"]*tests/helpers/|from\s+['\"]\./[^'\"]*(fixture|harness|world)[^'\"]*['\"]|"
    r"\b(createTargetPlatform|startHost|createAgentRuntime|SqliteStores|createInMemoryRecordBackend|"
    r"RawArtifactBodyStore|createWorkflow\w*|openWorkspace|createPlatform\w*)\b|"
    r"from\s+['\"][^'\"]*/(stores?|storage|record-store|sqlite|host|platform)(/|['\"])")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True).stdout


def norm(line):
    return re.sub(r"\s+", " ", line.strip()).rstrip(",;")


def timeout_of(line):
    m = TIMEOUT_NUM.search(line)
    if not m:
        return None
    return int((m.group(1) or m.group(2)).replace("_", ""))


def parse_hunks(diff):
    hunks = []  # [file, [(old_no, text)], [(new_no, text)]]
    file = None
    old_no = new_no = 0
    for raw in diff.splitlines():
        if raw.startswith("--- "):
            file = raw[6:] if raw.startswith("--- a/") else None
            continue
        if raw.startswith("+++ "):
            if raw.startswith("+++ b/"):
                file = raw[6:]
            continue
        m = re.match(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", raw)
        if m:
            old_no, new_no = int(m.group(1)), int(m.group(2))
            hunks.append([file, [], []])
            continue
        if not hunks:
            continue
        if raw.startswith("-"):
            hunks[-1][1].append((old_no, raw[1:]))
            old_no += 1
        elif raw.startswith("+"):
            hunks[-1][2].append((new_no, raw[1:]))
            new_no += 1
    return hunks


def main():
    args = sys.argv[1:]
    pathspec = "tests"
    if "--pathspec" in args:
        i = args.index("--pathspec")
        pathspec = args[i + 1]
        del args[i:i + 2]
    if len(args) != 3:
        print(__doc__)
        sys.exit(2)
    repo, base, head = args

    status = {}
    for row in git(repo, "diff", "--name-status", "-M", base, head, "--", pathspec).splitlines():
        parts = row.split("\t")
        status[parts[-1]] = parts[0][0]
    deleted = sorted(p for p, s in status.items() if s == "D")

    hunks = parse_hunks(git(repo, "diff", "-U0", "--no-color", "-M", base, head, "--", pathspec))
    live = [h for h in hunks if status.get(h[0]) != "D"]
    added_norm = Counter(norm(t) for _, _, a in live for _, t in a)
    removed_norm = Counter(norm(t) for _, r, _ in live for _, t in r)
    hits = defaultdict(list)

    for f, rem, add in live:
        strict_subjects = {}
        for n, t in rem:
            if not (ASSERT.search(t) or TEST.search(t) or BACKENDS.search(t)):
                continue
            key = norm(t)
            if added_norm[key] > 0:
                added_norm[key] -= 1
                hits["MOVED"].append((f, n, t))
                continue
            if ASSERT.search(t) and STRICT.search(t):
                s = SUBJECT.search(t)
                if s:
                    strict_subjects[norm(s.group(1))] = (n, t)
            if TEST.search(t):
                hits["REMOVED test or describe"].append((f, n, t))
            elif BACKENDS.search(t):
                hits["REMOVED or changed backend list"].append((f, n, t))
            else:
                hits["REMOVED assertion"].append((f, n, t))
        rem_timeouts = [x for x in (timeout_of(t) for _, t in rem) if x]
        for n, t in add:
            if removed_norm[norm(t)] > 0:
                removed_norm[norm(t)] -= 1
                continue
            if MODIFIER.search(t):
                hits["ADDED skip/todo/only/skipIf"].append((f, n, t))
            if ASSERT.search(t) and LOOSE.search(t):
                s = SUBJECT.search(t)
                if s and norm(s.group(1)) in strict_subjects:
                    on, ot = strict_subjects[norm(s.group(1))]
                    hits["LOOSENED (strict to loose on one subject)"].append(
                        (f, n, f"{t.strip()}   <- was :{on} {ot.strip()}"))
            to = timeout_of(t)
            if to:
                if rem_timeouts and to > max(rem_timeouts):
                    hits["RAISED timeout"].append((f, n, f"{t.strip()}   <- was {max(rem_timeouts)}"))
                elif not rem_timeouts and status.get(f) not in ("A", None):
                    hits["NEW timeout in an existing file"].append((f, n, t))
            if BACKENDS.search(t) and not BOTH.search(t):
                hits["ADDED single-backend list"].append((f, n, t))
            if CONST_IN_EXPECT.search(t):
                hits["ADDED expected value from a constant"].append((f, n, t))

    print(f"# D1 assertion ledger {base}..{head} ({pathspec})")
    total = 0
    for kind in sorted(hits):
        rows = hits[kind]
        print(f"\n## {kind}: {len(rows)}")
        if kind == "MOVED":
            continue
        total += len(rows)
        for f, n, t in rows:
            print(f"{f}:{n}: {t.strip()[:260]}")
    print(f"\n## DELETED test files: {len(deleted)}")
    for p in deleted:
        body = git(repo, "show", f"{base}:{p}")
        print(f"{p}: {len(TEST_COUNT.findall(body))} tests, {len(EXPECT_COUNT.findall(body))} expects")
    print(f"\n# lines to justify (excluding MOVED): {total}, plus {len(deleted)} deleted files")

    files = [p for p in git(repo, "ls-tree", "-r", "--name-only", head, "--", pathspec).splitlines()
             if p.endswith("-pure.test.ts")]
    print(f"\n# D3 pure-file guard: {len(files)} *-pure.test.ts files")
    bad = 0
    for p in files:
        for i, line in enumerate(git(repo, "show", f"{head}:{p}").splitlines(), 1):
            if PURE_FORBIDDEN.search(line):
                bad += 1
                print(f"{p}:{i}: {line.strip()[:200]}")
    print(f"# D3 hits: {bad}")


if __name__ == "__main__":
    main()
