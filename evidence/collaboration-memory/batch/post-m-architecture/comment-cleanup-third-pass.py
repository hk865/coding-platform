from pathlib import Path

REPLACEMENTS = {
    b"governance/plan": b"governance and plan",
    b"human/role collaboration": b"human collaboration and role policy",
    b"architecture evolution/14": b"architecture evolution",
    b"verification/05": b"verification reduction",
    b"dispatch/04/06": b"dispatch and handoff",
}
SUFFIXES = {".ts", ".tsx", ".js", ".md", ".html"}
EXCLUDED = ("src/fixtures/", "src/testing/", "src/vendor/")
changed = []
for path in Path("src").rglob("*"):
    relative = path.as_posix()
    if not path.is_file() or path.suffix not in SUFFIXES or relative.startswith(EXCLUDED):
        continue
    before = path.read_bytes()
    after = before
    for old, new in REPLACEMENTS.items():
        after = after.replace(old, new)
    if after != before:
        path.write_bytes(after)
        changed.append(relative)
print(f"changed={len(changed)}")
print("\n".join(changed))

