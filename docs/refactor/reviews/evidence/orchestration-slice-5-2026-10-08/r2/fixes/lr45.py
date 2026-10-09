# LR4: automatic-rework notice source returns `capacity` when an underlying index window overflowed (T-R2-3)
# LR5: the direct answer / request-candidate lookups report a truncated window as `capacity`, not `unavailable`
import sys, pathlib
root = pathlib.Path(sys.argv[1])
p = root / 'src/core/work-graph/views/automatic-rework-notices.ts'
s = p.read_text(encoding='utf-8')
old1 = """    const runs = await lookupAll(records, RUN_BY_WORKSPACE_STATUS_INDEX, [projectId, workspaceId, 'ended']);
"""
new1 = """    const runs = await lookupAll(records, RUN_BY_WORKSPACE_STATUS_INDEX, [projectId, workspaceId, 'ended']);
    // §4.1 line 772 / T-R2-3 (lead LR4): an overflowing index window is `capacity`,
    // never a silently shorter notice list.
    if (runs.truncated) {
      return { status: 'rejected', code: 'capacity', reason: 'the ended-Run window of the automatic rework notices exceeded its whole read window' };
    }
"""
old2 = """      const batch = await lookupAll(records, VERIFICATION_ROUND_BY_STATUS_LOOKUP, [projectId, workspaceId, status]);
"""
new2 = """      const batch = await lookupAll(records, VERIFICATION_ROUND_BY_STATUS_LOOKUP, [projectId, workspaceId, status]);
      if (batch.truncated) {
        return { status: 'rejected', code: 'capacity', reason: `the ${status} verification-round window of the automatic rework notices exceeded its whole read window` };
      }
"""
for o, n in ((old1, new1), (old2, new2)):
    assert s.count(o) == 1, o
    s = s.replace(o, n)
p.write_text(s, encoding='utf-8')
q = root / 'src/core/work-graph/views/decision-read-model.ts'
t = q.read_text(encoding='utf-8')
olds = [
  ("""    throw { status: 'rejected', code: 'unavailable',
      reason: `the answer index for ${source.kind} ${source.key} was truncated before its whole window` } as CoreRejection;""",
   """    // T-R2-3 (lead LR5): an overflowing window is `capacity`.
    throw { status: 'rejected', code: 'capacity',
      reason: `the answer index for ${source.kind} ${source.key} was truncated before its whole window` } as CoreRejection;"""),
  ("""    throw { status: 'rejected', code: 'unavailable',
      reason: `the request candidate index for ${identity.requestRef.queryJobId} was truncated before its whole window` } as CoreRejection;""",
   """    // T-R2-3 (lead LR5): an overflowing window is `capacity`.
    throw { status: 'rejected', code: 'capacity',
      reason: `the request candidate index for ${identity.requestRef.queryJobId} was truncated before its whole window` } as CoreRejection;"""),
]
for o, n in olds:
    assert t.count(o) == 1, o[:60]
    t = t.replace(o, n)
q.write_text(t, encoding='utf-8')
print('LR4+LR5 applied under', root)
