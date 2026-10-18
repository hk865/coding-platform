# C1 G4: the interface G3 uses (lead, 2026-10-19)

G3 builds on tag `c1-g4-r1` (G1 frozen at `c1-g1` plus G4's change). Of G4's helpers, G3 uses only this one; no group changes it.

**`terminalProposalOf`** — `src/core/work-graph/tasks/plan-readers.ts:762`

```ts
export function terminalProposalOf(
  heads: readonly PlanProposal[],
  positions: ReadonlyMap<string, CommitCursor | null>,
): PlanProposal | null
```

- Walks `heads` in the given order; considers only `kind === 'candidate_v2'` with `status` `accepted` or `not_adopted`; the first one is the start; a later one replaces it only when `compareProposalChainPositions({ refKey, since }, { refKey, since }) > 0`, with `refKey = planProposalRefKey(ref)` (= `canonicalJson(ref)`) and `since = positions.get(refKey) ?? null`. Equal keeps the earlier one. No sort, no reads, no throw. Returns `null` when none qualifies.
- Source: the inline loop in `plan-readers.ts` (`c1-g1` :745–756); the lead checked it line by line.

**How the view switches (VW-5, G3):** `views/decision-read-model.ts` (around :1667–1692) keeps its live-candidate branch first, computes its `superseded` set as now, then calls `terminalProposalOf(candidates.filter(c => !superseded.has(canonicalJson(c.ref))), positions)` in place of its own loop (same order, same keys: its `positions` map is keyed by `canonicalJson(ref)`, the same string as `planProposalRefKey`), and keeps its fallback `candidates.find((candidate) => candidate.status !== 'candidate') ?? null` when the result is `null`. Nothing else in that function changes.
