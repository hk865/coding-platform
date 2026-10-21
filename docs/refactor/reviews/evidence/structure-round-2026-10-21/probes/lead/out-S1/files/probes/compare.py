#!/usr/bin/env python3
"""Compare two probe-log directories (D2 byte proof, §5.0 rule 4).

Usage: python3 compare.py <run-a-dir> <run-b-dir> [--max-details N]

Every *.jsonl line is one capture keyed by
(testFile, testName, kind, runIndex). Values are compared directly, never
sorted or canonicalised:

  * strings  -> UTF-8 bytes; first differing byte offset, both lengths and the
                16 bytes around it (8 before + 8 after);
  * arrays   -> element by element, count and order preserved;
  * objects  -> own keys in order; missing / undefined (our marker) / null kept
                apart; extra or reordered keys are a difference;
  * numbers  -> exact value and exact JSON number type (1 != 1.0).

Exit code 0 means zero differences and exactly the same capture keys.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def load(run_dir: Path) -> tuple[dict[tuple, object], list[tuple]]:
    records: dict[tuple, object] = {}
    order: list[tuple] = []
    for path in sorted(run_dir.glob("*.jsonl")):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            record = json.loads(line)
            key = (record["testFile"], record["testName"], record["kind"], record["runIndex"])
            if key in records:
                raise SystemExit(f"compare: duplicate capture key in {run_dir}: {key!r} ({path}:{lineno})")
            records[key] = record["payload"]
            order.append(key)
    return records, order


def hex_window(data: bytes, offset: int) -> str:
    before = data[max(0, offset - 8):offset]
    after = data[offset:offset + 8]
    return f"{before.hex(' ')} | {after.hex(' ')}"


def render_path(path: list[object]) -> str:
    out = "$"
    for part in path:
        out += f"[{part}]" if isinstance(part, int) else f".{part}"
    return out


def compare(a: object, b: object, path: list[object], details: list[str], limit: int) -> int:
    def note(message: str) -> None:
        if len(details) < limit:
            details.append(f"{render_path(path)}: {message}")

    if type(a) is not type(b):
        note(f"type differs: {type(a).__name__} != {type(b).__name__}")
        return 1
    if isinstance(a, str):
        left, right = a.encode("utf-8"), b.encode("utf-8")
        if left == right:
            return 0
        shared = min(len(left), len(right))
        offset = next((i for i in range(shared) if left[i] != right[i]), shared)
        note(f"first byte difference at offset {offset}; lengths {len(left)} != {len(right)}; "
             f"around: {hex_window(left, offset)} vs {hex_window(right, offset)}")
        return 1
    if isinstance(a, list):
        if len(a) != len(b):
            note(f"array length differs: {len(a)} != {len(b)}")
            return 1
        return sum(compare(a[i], b[i], path + [i], details, limit) for i in range(len(a)))
    if isinstance(a, dict):
        left_keys, right_keys = list(a.keys()), list(b.keys())
        count = 0
        if left_keys != right_keys:
            missing = [key for key in left_keys if key not in b]
            extra = [key for key in right_keys if key not in a]
            note(f"own keys/order differ: missing={missing!r} extra={extra!r} "
                 f"left={left_keys!r} right={right_keys!r}")
            count += 1
        for key in left_keys:
            if key in b:
                count += compare(a[key], b[key], path + [key], details, limit)
        return count
    if isinstance(a, float) or isinstance(b, float):
        if a != b:
            note(f"number differs: {a!r} != {b!r}")
            return 1
        return 0
    if isinstance(a, int):
        if a != b:
            note(f"number differs: {a!r} != {b!r}")
            return 1
        return 0
    if a != b:
        note(f"value differs: {a!r} != {b!r}")
        return 1
    return 0


def main() -> int:
    args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    if len(args) != 2:
        raise SystemExit("usage: python3 compare.py <run-a-dir> <run-b-dir> [--max-details N]")
    limit = 50
    for index, arg in enumerate(sys.argv):
        if arg == "--max-details" and index + 1 < len(sys.argv):
            limit = int(sys.argv[index + 1])
    run_a, run_b = Path(args[0]), Path(args[1])
    left, left_order = load(run_a)
    right, _right_order = load(run_b)

    keys = list(left_order)
    for key in right:
        if key not in left:
            keys.append(key)

    details: list[str] = []
    differences = 0
    missing = 0
    per_kind_diff: dict[str, int] = {}
    for key in keys:
        kind = key[2]
        per_kind_diff.setdefault(kind, 0)
        if key not in left or key not in right:
            missing += 1
            per_kind_diff[kind] += 1
            details.append(f"{key!r}: capture only on {'right' if key not in left else 'left'}")
            continue
        found = compare(left[key], right[key], ["payload"], details, limit)
        differences += found
        per_kind_diff[kind] += found

    by_kind: dict[str, dict[str, int]] = {}
    for (test_file, test_name, kind, run_index) in left_order:
        bucket = by_kind.setdefault(kind, {"captures": 0, "maxRunIndex": 0, "tests": set()})
        bucket["captures"] += 1
        bucket["maxRunIndex"] = max(bucket["maxRunIndex"], run_index)
        bucket["tests"].add((test_file, test_name))

    print(f"run A: {run_a} ({len(left)} captures)")
    print(f"run B: {run_b} ({len(right)} captures)")
    print("per kind:")
    for kind in sorted(by_kind):
        bucket = by_kind[kind]
        print(f"  {kind}: captures={bucket['captures']} maxRunIndex={bucket['maxRunIndex']} "
              f"tests={len(bucket['tests'])} differences={per_kind_diff.get(kind, 0)}")
    if "--list-tests" in sys.argv:
        for kind in sorted(by_kind):
            for test_file, test_name in sorted(by_kind[kind]["tests"]):
                print(f"  {kind} test: {test_file} :: {test_name}")

    if missing == 0 and differences == 0:
        print("RESULT: zero differences")
        return 0
    print(f"RESULT: {differences} value difference(s), {missing} capture-key difference(s)")
    for line in details:
        print(f"  {line}")
    if len(details) >= limit:
        print(f"  ... (stopped after {limit} detail lines)")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
