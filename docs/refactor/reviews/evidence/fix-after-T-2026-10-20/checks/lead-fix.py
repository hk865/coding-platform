# The lead's fixes after the rework audit (Codex R-01, R-02, R-04, R-05, R-06), applied by exact replacement in a copy.
# usage: python3 -I lead-fix.py <copy dir>   (lead, 2026-10-21)
import sys, pathlib
root = pathlib.Path(sys.argv[1])

def sub(rel, old, new, count=1):
    p = root / rel
    text = p.read_text(encoding='utf-8')
    n = text.count(old)
    if n != count:
        sys.exit(f'{rel}: expected {count} match, found {n}:\n{old}')
    p.write_text(text.replace(old, new), encoding='utf-8')
    print(f'{rel}: replaced {n}')

# R-01: write the temporary page inside the try whose finally removes the directory.
sub('scripts/verify-isolated.mjs',
    '''    "writeFileSync(join(publicDir, 'index.html'), '<!doctype html><meta name=\\"platform-token\\" content=\\"' + PLATFORM_TOKEN_PLACEHOLDER + '\\">'); " +
    "try { const host = await createLocalWorkbenchHost({''',
    '''    "try { writeFileSync(join(publicDir, 'index.html'), '<!doctype html><meta name=\\"platform-token\\" content=\\"' + PLATFORM_TOKEN_PLACEHOLDER + '\\">'); " +
    "const host = await createLocalWorkbenchHost({''')

# R-02: the origin decoder returns only `since`, as before the rework (no noticeAutomationCap pass-through).
sub('src/core/work-graph/persistence/plan-record-codecs.ts',
    '''  return { status: 'decoded', value: {
    since: parsed['since'] as CommitCursor,
    ...(parsed['noticeAutomationCap'] === undefined
      ? {} : { noticeAutomationCap: parsed['noticeAutomationCap'] as number }),
  } };''',
    '''  return { status: 'decoded', value: { since: parsed['since'] as CommitCursor } };''')

# R-04: the successor's superseded ids from the root as the owner returned it, not from the production function.
sub('tests/work-graph/A2-step1-codecs.test.ts',
    '''    // The successor is the owner's public reverify of that real interruption.
    expect(successor.chain).toMatchObject({ ordinal: 2, predecessorRoundRef: root.ref, predecessorRevision: root.revision,
      supersededEvidenceIds: chainEvidenceIds(root), autoCount: 0,''',
    '''    // The successor is the owner's public reverify of that real interruption. VR-09: it supersedes the evidence
    // of the chain so far. The root supersedes nothing (rootChain) and holds the evidence of its one executed
    // check (the PASS); the interrupted check left none. So the successor supersedes exactly that one id.
    expect(root.chain.supersededEvidenceIds).toEqual([]);
    expect(root.evidenceRefs).toHaveLength(1);
    expect(successor.chain).toMatchObject({ ordinal: 2, predecessorRoundRef: root.ref, predecessorRevision: root.revision,
      supersededEvidenceIds: [root.evidenceRefs[0]!.evidenceId], autoCount: 0,''')
sub('tests/work-graph/A2-step1-codecs.test.ts',
    "import { chainEvidenceIds } from '../../src/core/work-graph/state/verification-machine.js';\n", '')

# R-05: the codec comment says what the code checks.
sub('src/core/work-graph/sessions/session-record-codecs.ts',
    '''  // SD-2: why `health` is unavailable. A current unavailable record always
  // carries one; only an available Session may keep the legal `null`.''',
    '''  // SD-2: why `health` is unavailable. An unavailable record must carry a
  // recognized conclusion; any other health keeps the optional `null`.''')

# R-06: a missing cause is not normalized to null on read.
sub('src/core/work-graph/persistence/evidence-record-codecs.ts',
    '''    // keep the optional cause and its null (absent reads as null).''',
    '''    // keep the optional cause: it may be absent or null.''')
sub('tests/work-graph/A2-step1-codecs.test.ts',
    '''    // A non-interrupted check keeps the optional cause (absent reads as null).''',
    '''    // A non-interrupted check keeps the optional cause (it may be absent or null).''')
