# fix-b.py <copy>: lead fixes after the Codex re-review of the area-B follow-up (exact replacements, each asserted).
import sys, pathlib
root = pathlib.Path(sys.argv[1])
def edit(rel, pairs):
    p = root / rel
    s = p.read_text(encoding='utf-8')
    for old, new, n in pairs:
        assert s.count(old) == n, (rel, s.count(old), old[:90])
        s = s.replace(old, new)
    p.write_text(s, encoding='utf-8', newline='\n')

# LB3 (Codex B2 #4): a Host PlanApply without attribution keeps the pre-slice canonical fingerprint payload (HEAD
# applyFingerprint has no attribution keys); the two fields enter it only when present (as the Agent branch, F2).
edit('src/core/work-graph/tasks/plan-service.ts', [(
"""  decisionSource?: DecisionSourceV1 | null;
}): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'PlanApply', ...input } as unknown as JsonValue));
}""",
"""  decisionSource?: DecisionSourceV1 | null;
}): string {
  // Slice 5 (lead, LB3): attribution enters the fingerprint only when present, so
  // a request without it keeps the pre-slice canonical payload byte-identical.
  const { acknowledgementRef, decisionSource, ...base } = input;
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'PlanApply', ...base,
    ...(acknowledgementRef === undefined || acknowledgementRef === null ? {} : { acknowledgementRef }),
    ...(decisionSource === undefined || decisionSource === null ? {} : { decisionSource }),
  } as unknown as JsonValue));
}""", 1)])

DS = 'src/core/work-graph/communication/decision-service.ts'
edit(DS, [
# LB4 (Codex B2 #7): another Workspace is `forbidden` (spec §8.2 scope row), decided before any read.
("""    if (ref.projectId !== owned.projectId || ref.workspaceId !== owned.workspaceId) {
      return reject('invalid', 'the message ref is outside the bound project/workspace');
    }""",
"""    if (ref.projectId !== owned.projectId || ref.workspaceId !== owned.workspaceId) {
      return reject('forbidden', 'the message ref is outside the bound project/workspace');
    }""", 1),
# LB6 (Codex B2 #5): only the store's own missing report is `not_found`; an unaccounted omission is `unavailable`.
("""    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return { status: 'not_found' };
    const decoded = decodeSessionMessageRecord(record);""",
"""    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) {
      return read.value.missing.includes(key) ? { status: 'not_found' }
        : reject('unavailable', 'the message read neither returned nor reported missing the record');
    }
    const decoded = decodeSessionMessageRecord(record);""", 1),
("""    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    return { ok: true, record: read.value.records.find((candidate) => candidate.refKey === key) ?? null };""",
"""    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined && !read.value.missing.includes(key)) {
      return { ok: false, rejection: reject('unavailable', 'the caller Run/QueryRun read neither returned nor reported missing the record') };
    }
    return { ok: true, record: record ?? null };""", 1),
# LB5 (Codex B2 #9): the application pin is a stored message pin, so its revision is positive (§3.3 line 625).
("""    const pin = actual[0]!;
    if (pinIdentity(pin) === null || !pinInScope(pin, owned)
      || canonicalOf(pin.ref) !== canonicalOf(ref)) {
      return reject('invalid', 'an application accepts exactly the original message pin');
    }""",
"""    const pin = actual[0]!;
    if (pinIdentity(pin) === null || !pinInScope(pin, owned)
      || canonicalOf(pin.ref) !== canonicalOf(ref) || pin.revision < 1) {
      return reject('invalid', 'an application accepts exactly the original message pin');
    }""", 1),
])
print('ok')
