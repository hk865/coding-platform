# fix-a.py <copy>: lead fixes after the Codex re-review of area A (exact replacements, each asserted).
import sys, pathlib
root = pathlib.Path(sys.argv[1])
def edit(rel, pairs):
    p = root / rel
    s = p.read_text(encoding='utf-8')
    for old, new, n in pairs:
        assert s.count(old) == n, (rel, s.count(old), old[:90])
        s = s.replace(old, new)
    p.write_text(s, encoding='utf-8', newline='\n')

PR = 'src/core/work-graph/tasks/plan-readers.ts'
RM = 'src/core/work-graph/views/decision-read-model.ts'

edit(PR, [
# LA1 (Codex A #1): an adopted head ends its request, so among the request's chain ends `accepted` wins over
# `not_adopted`; only several `not_adopted` ends of one re-acquired request fall back to the deterministic order.
("""      let terminal: PlanProposal | null = null;
      for (const proposal of heads) {
        if (proposal.kind !== 'candidate_v2') continue;
        if (proposal.status !== 'accepted' && proposal.status !== 'not_adopted') continue;
        terminal = proposal;
      }""",
"""      let terminal: PlanProposal | null = null;
      for (const proposal of heads) {
        if (proposal.kind !== 'candidate_v2') continue;
        if (proposal.status !== 'accepted' && proposal.status !== 'not_adopted') continue;
        // An adopted head ends its request: `accepted` wins over `not_adopted`.
        if (terminal !== null && terminal.status === 'accepted' && proposal.status !== 'accepted') continue;
        terminal = proposal;
      }""", 1),
# LA5 (Codex A #5): an independent (null-request) terminal candidate is its own history card (proposal key, §3.3 629).
("""    const byRequest = new Map<string, PlanProposal[]>();
    for (const key of found.refKeys) {""",
"""    const byRequest = new Map<string, PlanProposal[]>();
    const independent: PlanProposal[] = [];
    for (const key of found.refKeys) {""", 1),
("""      const requestRef = candidateRequestRef(proposal);
      if (requestRef === null) continue;
      const groupKey = canonicalJson(requestRef as unknown as JsonValue);""",
"""      const requestRef = candidateRequestRef(proposal);
      if (requestRef === null) {
        // §4.2 source 3 / §3.3 line 629: an independent candidate is keyed by its
        // own proposal; a stored terminal one is its own closed history card.
        if (proposal.status === 'accepted' || proposal.status === 'not_adopted') independent.push(proposal);
        continue;
      }
      const groupKey = canonicalJson(requestRef as unknown as JsonValue);""", 1),
("""      if (terminal !== null) proposals.push(terminal);
    }
    proposals.sort((left, right) => {""",
"""      if (terminal !== null) proposals.push(terminal);
    }
    proposals.push(...independent);
    proposals.sort((left, right) => {""", 1),
# LA3 (Codex A #3): a window that keeps moving is `unavailable` (spec §4.1 line 772), not `revision_conflict`.
("""  return { status: 'rejected', code: 'revision_conflict',
    reason: 'the closed-candidate enumeration window changed while it was being read' };
}""",
"""  return { status: 'rejected', code: 'unavailable',
    reason: 'the closed-candidate enumeration window changed while it was being read' };
}""", 1),
])

edit(RM, [
# LA1 in the direct-card entrance (same rule, so both entrances select the same head).
("""    if (candidate.status !== 'accepted' && candidate.status !== 'not_adopted') continue;
    head = candidate;
  }""",
"""    if (candidate.status !== 'accepted' && candidate.status !== 'not_adopted') continue;
    // An adopted head ends its request: `accepted` wins over `not_adopted`.
    if (head !== null && head.status === 'accepted' && candidate.status !== 'accepted') continue;
    head = candidate;
  }""", 1),
# LA2 (Codex A #2): a source kind without an adapter is an unavailable source, never an absent card (§4.2 "未接
# source显式not_available", §8.2 line 1361).
("""  const provider = deps.cardSources.find((candidate) => candidate.kind === source.kind);
  if (provider === undefined || goal === null) return null;""",
"""  const provider = deps.cardSources.find((candidate) => candidate.kind === source.kind);
  if (goal === null) return null;
  if (provider === undefined) {
    throw { status: 'rejected', code: 'unavailable',
      reason: `decision source ${source.kind} is not connected on this Host` } as CoreRejection;
  }""", 1),
# LA4 (Codex A #6): a stored terminal candidate shows no candidate status.
("""    candidateStatus: stale ? 'stale' : 'candidate', staleReason: stale ? 'basedOn is not the active Plan pointer' : null,""",
"""    candidateStatus: closed ? null : stale ? 'stale' : 'candidate', staleReason: stale ? 'basedOn is not the active Plan pointer' : null,""", 1),
])
print('ok')
