**Decision 67 item 2 (default states per read) and b11 (check-then-drop): proposal for the 4C addendum**

Line numbers are at 1e0b1383, before speed round 1. NRM = `src/core/work-graph/notes/note-read-model.ts`, NV = `src/core/work-graph/views/note-views.ts`. Where round 1 rewrites a path, I describe the path by the book's ruling (s4f-impl.md S2.x).

## 1. FACTS

**Each read today, compared with the decision 67 table**
- **find has no default state filter at all.**
  - `state` applies only when the caller gives it (NRM:729-734). The no-terms "status" route reads all seven states (NRM:446-447, :1526).
  - There is no cross-goal visibility filter. Cross-goal items are listed and only marked `crossGoal` (NRM:592-605).
  - `S4B-memory-l12-bounds.test.ts:173-187` asserts that find returns another goal's agent-accepted note with `currentEligible: false`.
  - So find returns rejected, superseded, withdrawn and staged notes, and other goals' pending notes.
- **lookup** already lists the right states (spec §10 R9). The filter at NRM:1160-1166 keeps the four states, and from another goal only reviewed or user-confirmed notes. But it runs after the whole slice was checked (NRM:1153-1155); this is b11. `coverage` counts the dropped items too (NRM:1184), as R3 requires (spec §10 R3).
- **stale** reads only accepted/reviewed notes before the check (NRM:1403-1404, :1414-1415; 4B book R6). After the check it keeps only problems (NRM:1422-1423).
  - Its `item.invalid` test can never be true: `invalid` only arises for staged repairs (NV:934).
  - `conflicting` is not in the problem filter. This matches L12's list (spec L12).
- **history** (NRM:1217-1237) and **neighbors** (:1350-1371) have no state filter, which matches the table.
- **conflicts** has no state filter either. It runs the full check on every page candidate (NRM:1311) and keeps only `conflicting` ones (:1313), so it has the same check-then-drop shape as lookup (read-model.review.md item 10). `conflicting` is computed from stored heads alone (NRM:260-288).

**Other code and spec facts**
- **"Own goal" today** is `currentGoalIdOf`: the work_run's `runRef.goalId`, and null for host and query_run (NRM:457-459). Cross-goal means a non-null caller goal different from the note's goal (NRM:483-485). `checkNotes` uses the same goal (NV:972-974). `QueryRunRef` carries no goal (`src/contracts/query-job.ts:10-16`).
- **Marks:** `currentEligible` is false for pending notes, cross-goal accepted notes, non-head versions and every derived problem (NV:965-976). The reason fields already exist on `NoteItemV1` (§2): `freshness`, `staleReasons`, `conflicting`, `anchorStatus`, `sourceUnavailable`, `unresolvedFacts`.
- **Budgets:** there is one file, fact and symbol budget per `checkNotes` call, spent in item order (NV:1003-1012; R3). Dropped items spend it today.
- **Cursors** bind:
  - the caller identity, including the goal (NRM:466-481);
  - the request JSON, including `state`;
  - `RULE_VERSION = 1` (NRM:444, :561-590), which body cursors also bind (:943, :984).

  An `after` key that is no longer in the candidate list gives `revision_conflict` (NRM:676-677).
- **Spec:**
  - L10 defines U as the notes left after all non-text filters.
  - L12 and M-09 say an empty page with `complete: false` is valid.
  - L9 says only reviewed or user-confirmed notes are visible across goals.
- **Round 1:** every find source goes through `headInScope` (S2.1, S2.2). The HeadCache is seeded from the raw anchor sets (S2.3). `checkHeads` takes the heads the read model already has (S2.5). `conflictingOf` is memoized per noteId@version (S2.6). b11 is deferred to 4C (S2.9).

## 2. GAPS

1. Cross-goal accepted notes in find. The table says only "accepted", but L9 and R9 hide these in lookup.
2. What "own goal" means for `pending_review`: the request's goal or the caller's? And what host and query_run callers see.
3. How a caller asks for history, and whether `staged` notes appear in find.
4. Whether the state filter runs before U, df, the `'any'` cap and slicing. Scores change if it does.
5. Whether "marked not current" needs a new field.
6. b11 for lookup and conflicts: paging, `coverage` wording, budget order, and which failures surface.
7. Whether the cursor rule version changes.
8. stale: should it include `conflicting`? Its `goalId` comes from the request, so an agent can read other goals' notes through it.
9. conflicts and "all states": `conflicting` needs a current counterpart (NRM:264, :279). So when a pending note contradicts an accepted one, only the pending note is listed. Its accepted target is not, even though L12 says both sides.

## 3. PROPOSAL

**D1. find visibility.** The filter is one predicate, `findVisible(head, g)`, where `g = currentGoalIdOf(ctx)` (the trusted caller goal, never a request field, F9). Let `own = g === null || head.goalId === g`.
- accepted: `own || confirmedByUser` **[product P1]**
- reviewed: always visible.
- pending_review: `own`
- staged, rejected, superseded, withdrawn: only on a history ask (D3).

So host callers (the user, notes/list) and query_run callers see every goal's notes, as lookup and `checkNotes` already do. Project-level pending notes (`goalId: null`) are hidden from agents in a goal.
- **P1, product:**
  - (a) Hide cross-goal accepted notes, as lookup does and L9 says (recommended). This changes l12-bounds:173.
  - (b) Return them, marked not current, which is the literal reading of the table.
- query_run has no goal. Keeping today's "no goal" rule is the lead's call; slice 6 may bind a goal to secretary Sessions.

**D2. Where the filter runs (technical).** It goes into `headInScope`, the shared scope check, so every find source applies it before U and df, before the `'any'` cap, before `'all'` paging and before slicing. Scores are then computed over the visible set, as L10 defines U.
- The status route reads only the visible states:
  - accepted and reviewed for every goal slot;
  - pending_review for the own goal only, or for every slot when there is no caller goal.
- These narrower reads must not seed `HeadCache.goals` (S2.3).

**D3. Asking for history** **[product P2, small]**
- (a) **Smallest:** an explicit `state` overrides the defaults and returns exactly that state, any of the seven. No new field. The `own` rule still applies to pending and staged notes; retired states have no goal filter, like history. A union of states needs one call per state.
- (b) Add `history?: true`, giving all seven states in one call. It goes into the cursor-bound request and the `find_graph` strict schema.

I recommend (a). With (b), whether other goals' retired notes are visible is a third small product question; I would follow history and show them.

**D4. Marks (technical).** No new field. A derived problem is `storedState ∈ {accepted, reviewed} && !currentEligible` plus the existing reason fields. Order is unchanged: we do not re-sort current notes first, which would require checking every candidate. The `record_note`/`find_graph` tool text (L14) says that only `currentEligible: true` items are current conclusions.

**D5. lookup b11 → option (A) (technical).** Apply R9's filter on stored fields before sort and slice. It needs zero extra reads and gives full pages.
- The existence check stays on the unfiltered set: an anchor whose heads are all filtered out gives `items: []` and `complete: true`.
- The order and the union over all pages are unchanged.

**D6. conflicts b11 → option (B′) (technical).** Keep today's candidate set and slicing.
- For each page candidate, compute `conflicting` with the shared `derivations.conflictingOf`, the call's seeded HeadCache and the S2.6 memo.
- Hand only the conflicting items to `checkHeads`, with a new optional per-item `conflicting` that the check uses instead of recomputing.
- Empty pages with `complete: false` stay possible.

Option (A) for conflicts would derive every candidate's anchor sets, which is unbounded on a busy anchor.

**D7. R3 amendment.** `coverage` counts the items the check ran on in this page.
- stale still counts the fresh candidates it drops after the check.
- lookup, find and conflicts drop by stored fields or the head derivation before the check, so dropped items count nowhere.
- Dropped items no longer spend the file, fact or symbol budgets. A dropped item's check failure no longer fails the call; its derivation reads in conflicts still do.
- The byte trim is unchanged.

**D8. Cursors.** Bump `RULE_VERSION` to 2, once for all reads.
- Reason: page contents change for the same cursor, and an old `after` naming a now-hidden head would give a false `revision_conflict`. The rule check comes first, so it gives `cursor_mismatch` instead.
- The request binding is unchanged under D3(a). Under (b), add `history` to it.

**D9. stale (technical).** Keep L12's problem list and R6's accepted/reviewed candidates. Conflicts stay with `conflicts`. Remove the unreachable `item.invalid` test. Keep all-goal visibility through the request's `goalId`: every stale item is already not current. The lead could restrict it instead.

**D10. history, neighbors, conflicts:** no state or goal filter. For gap 9, I would keep L9's derivation; changing it is a product question ("both sides" of a pending contradiction).

**D11.** The decision 67 item 1 segments (graph-related notes first, then the rest of the project) apply `findVisible` in both segments.

## 4. COST (decision 69 items 1 and 5)

Store calls per read. Each anchor set is 5 index lookups of ⌈h/200⌉ pages; `G` is the number of goals.

| Read | Store calls per call |
|---|---|
| find, anchor | 1 ledger + one anchor set (already read for the existence check) + 0 for the filter; the check runs only on visible items |
| find, status | 1 + ⌈G/200⌉ + (2(G+1)+1) review-status loops for a work_run, 3(G+1) for host/query_run, (G+1) with an explicit state. Today it is 7(G+1) |
| find, prefix, and terms | unchanged from round 1. Unscoped `'any'` takes at most ⌈M/100⌉+1 port pages (M = project-wide matches, unchanged bound) |
| lookup | 1 + one anchor set + 1 pointer; plus the understanding reads, unknown until M-12 is specified; the check runs only on listed items |
| conflicts | as today, plus at most c point reads per candidate (c = its `contradicts` count; I found no cap in code) and at most 4 uncached anchor sets per candidate. These are computed once and reused by the check |
| stale, history, neighbors | unchanged |

- Each head is decoded once per call (S2.7), and each derivation is computed once per noteId@version (S2.6).
- To assert counts through a public port, a §7 counting-store wrapper is needed; that is a test exception for the lead. Otherwise, rely on the scale measurement before merge.
- **Lines:** about 55–70 new and about 15 removed. Budget: 80.
- **Reuse:** `headInScope`, `currentGoalIdOf`/`isCrossGoal`, `derivations.conflictingOf`, `checkHeads` (S2.5), the per-call caches (S2.3, S2.6), `sliceByCursor`, `fitToByteBound`. No new reader.

## 5. TESTS

All through the public `NoteMemoryReadPort` (NE3), both backends.

**New rows.** The fixture for DS-01 and DS-02: a g1 run; own notes a (accepted), b (reviewed), c (pending, structural), h (superseded), i (withdrawn), j (rejected), k (accepted, basis file then changed); g2 notes d (pending), e (agent-accepted), f (reviewed), g (user-confirmed).
- **DS-01** find on the project anchor, no terms: g1 gets {a, b, c, f, g, k} in createdAt order; k is `stale` with `currentEligible: false`, c is `pending_review`. The host gets {a, b, c, d, e, f, g, k}. Under P1(b), g1 also gets e.
- **DS-02** `state: 'superseded'` → [h]; `'withdrawn'` → [i].
- **DS-03** T-07's three notes plus a withdrawn note with t1 in its topic and a superseded note with t2: the scores are still 3.9120 / 2.3026 / 0.6931. (If the retired notes counted, U would be 5 and every score would differ.)
- **DS-04** lookup by a g1 run, `limit: 1`, two hidden g2 notes only → `[]`, `complete: true`, `next: null`. With two own notes added: two pages of one item each, the second `complete: true`.
- **DS-05** `readFilesMax: 1`:
  - lookup with a hidden g2 note (basis a.txt) and an own note (basis b.txt): the own note is fresh, coverage {checked 1, unchecked 0, files 1}.
  - conflicts on an anchor with p (no conflict, a.txt) and a contradicting pair q, r (both b.txt): items [q, r], both fresh; coverage {checked 2, unchecked 0, files 1}.
- **DS-06** stale with `limit: 1` whose first candidate is fresh → `[]`, `complete: false`. This takes over M-09's empty-page assertion.
- **NE4** `find_graph`'s memory branch from a g1 run returns the g1 set (`d` is absent), and a `goalId` parameter is rejected by the strict schema.
- **NE7** `notes/list` as the user sees d.
- The old-cursor bump can only be tested by crafting a cursor string; I propose accepting that as untested.

**Existing tests that change**
- `S4B-memory-paging.test.ts:108` (M-09, lookup's empty page) becomes DS-04's `complete: true`; its empty-page point moves to DS-06.
- `S4B-memory-l12-bounds.test.ts:173` under P1(a): the item is absent from find. Its "ineligible" check moves to a direct `checkNotes` call.
- These keep their assertions: `S4B-memory-observation.test.ts:49` (both items listed; only its R3 comment changes), M-08 (`S4B-memory-current-filter.test.ts:31`), the find-stale, ranking and coverage tests (host caller, accepted notes, explicit `state` where used), and conflicts in `S4B-note-missing-flows.test.ts:141`.
- Round 1's new SP tests: unknown, since they are not in this copy.