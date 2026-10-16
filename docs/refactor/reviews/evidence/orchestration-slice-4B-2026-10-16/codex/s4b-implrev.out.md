Static review of the staged tree over `753bf5ab`. No files edited, tests run, or models invoked.

**Must-fix**

1. **Complete L22 fact resolution.** `src/core/work-graph/views/note-views.ts:456` ignores record-pointer `revision`, never validates file-digest format, and treats `artifact`/`kernel_history` as unchecked without making the item ineligible. Thus an unverified source can produce `fresh` and `currentEligible:true`. Resolve the specified versions, validate file facts, and inject the existing artifact/history readers. Only well-formed commit facts get P6’s eligibility exemption.

2. **Make check caches local to each invocation.** `src/core/work-graph/views/note-views.ts:150` shares plan/catalog caches across asynchronous calls; clearing them at call entry does not isolate overlapping requests. The plan key also omits project identity. Concurrent checks can use another request’s catalog or plan. Allocate these caches inside `checkNotes`.

3. **Use one observation pass and one page budget.** `src/core/work-graph/notes/note-read-model.ts:376` reads files for observations, then `withCheck` rereads them with a separate budget. Reported observations can contradict freshness, and symbol rechecks can exhaust a different set of 256 files. File-anchor and file-fact reads bypass that accounting. Share budgeted observations across checking, returned evidence and coverage; retain failure outcomes. Calculate coverage over examined candidates, including filtered-out items.

4. **Correct symbol rechecks.** `src/core/work-graph/views/note-views.ts:320` passes the old line range, so inserting a line above an unchanged symbol retires it. It also converts the writer resolver’s `unresolved`—including unsupported analysis or an unfinished capped scan—into definite `symbol_missing`. Recheck by the specified name, distinguish exhaustive absence from incomplete analysis, and report incomplete checks conservatively.

5. **Respect each anchor’s identity.** `src/core/work-graph/views/note-views.ts:263` selects one goal’s plan for all task/stage anchors. Stage checking subsequently ignores `anchor.planRevision`. Resolve each anchor’s own goal and compare the versioned stage identity; a reused stage ID in a later plan must not revive the old anchor.

6. **Fix candidate selection and combined filters.** `src/core/work-graph/notes/note-read-model.ts:536` stops at `file:src/a-b`, before valid `file:src/a/x` entries. Stop only after leaving the lexical prefix range; separately reject non-directory matches. Also apply all supplied filters: the anchor branch of `find` ignores `pathPrefix` (`src/core/work-graph/notes/note-read-model.ts:1266`), and goal-based `stale` ignores its anchor.

7. **Keep AND search exhaustible and preserve `unsupported`.** `src/core/work-graph/notes/note-read-model.ts:1257` applies `rankMatches`’ permanent truncation to `'all'`, making matches beyond 1,000 unreachable. Restrict partial-ranking truncation to `'any'`; AND search must continue through port pages in refKey order. Also preserve FTS `unsupported`: `collectSearch` currently maps it through `asOutcome` to `unavailable`.

8. **Invalidate stale FTS indexes across reopen cycles.** `src/core/record-store/sqlite-text-search.ts:152` trusts table existence plus registration code. Open with an index, reopen without it, modify records, then restore the same registration: the old table survives and misses new matches. The unavailable-probe path similarly skips maintenance. Track index validity across such writes, rebuild before serving, and make table rebuild plus metadata publication atomic.

9. **Implement L12’s absent/retired-anchor distinction consistently.** `src/core/work-graph/notes/note-read-model.ts:990` removes every retired item, defeating “gone anchor with heads returns retired heads.” `conflicts` and `find` omit the missing-anchor check altogether. Preserve the required retired results, check anchor existence independently of search matches, and return bounded `anchorCandidates` through an appropriate rejection type.

10. **Bind body cursors like other memory cursors.** `src/core/work-graph/notes/note-read-model.ts:825` validates only note/version/offset; it omits caller, request, rule version and record cursor. Body continuation after a write can return `cursor_mismatch` instead of `revision_conflict`. Add the L12 bindings and validate offsets. Ordinary cursors should bind the full principal identity and actual `RULE_VERSION`, rather than a partial ID and unrelated hardcoded version.

11. **Make versioned reads internally consistent.** `src/core/work-graph/notes/note-read-model.ts:1029` checks the entire history before paging, consuming budgets on versions outside the requested page. Select the page first. Its body attachment matches only `noteId`, attaching one version’s body to every history row; match version too. `memoryNeighbors` ignores its requested version (`src/core/work-graph/notes/note-read-model.ts:1129`). Finally, use historical confirmation/relations consistently instead of mixing them with current-head derivations.

12. **Enforce the whole-response byte bound.** `src/core/work-graph/notes/note-read-model.ts:646` stops shrinking at one item and retains the original `readBasis.observedFiles`. Large observations or metadata can therefore leave a response above 48 KiB. Recompute page-dependent metadata after trimming, bound ancillary fields, and explicitly handle a single item that cannot fit.

13. **Implement the specified hint predicates.** `src/core/work-graph/views/note-views.ts:426` tests any module prefix rather than longest-prefix ownership, and derives `file_module_mismatch` from task anchors rather than the authoring Run’s task. `src/core/work-graph/views/note-views.ts:653` accepts the mere presence of a file fact as deletion proof and checks only the main anchor. Use actual module attribution, the recorded source Run, and resolved deletion evidence for all relevant anchors.

14. **Return truthful version metadata.** `src/core/work-graph/notes/note-version-lists.ts:141` puts a refKey into P8’s timestamp field. Return a real timestamp or obtain a binding nullable-time amendment. `src/core/work-graph/notes/note-version-lists.ts:90` discards recorded initial-adoption reasons solely because `basedOn` is null; preserve an existing reason.

15. **Repair the acceptance tests’ seams and backend coverage.** `tests/helpers/S4B-note-check-fixture.ts:99` replaces production wiring, then constructs separate memory/version readers. This exceeds the permitted doubles and masks registration defects. Exercise the actual `platform.notes` holder; parameterize NE3 flows over both backends—all current NE3 cases select memory. Add the missing required flows and the regressions above. Replace product-output-only expectations such as `tests/record-store/S4B-text-search.test.ts:450` with literal expected results.

**Should-fix**

- `src/core/work-graph/notes/note-read-model.ts:712` drains every term’s entire result before applying the partial-ranking limit. Bound acquisition while preserving the specified filtered-match semantics; otherwise partial ranking does not bound the expensive work.
- Finish constant injection consistently. The production `noteLimits` surface exposes only three fields (`src/composition/create-platform.ts:254`); several declared injectable limits/weights remain hardcoded.
- The six names, result shapes, non-enumerable `notes` holder and version-list registration are present. For 4C, reuse the same checker for write envelopes and resolve the findings above before wiring consumers. The allowlist’s claimed future `notes/*` body route should be reconciled with the actual L13/L15 contract.

**Builder open points**

**NOT BUILT:** The module-removal blocker is real (`src/core/work-graph/architecture/catalog-service.ts:671`). Keep M-02’s removal half and M-15’s `module_removed` as explicit dependency gaps requiring later public-path acceptance; do not weaken that catalog guard merely to manufacture fixtures. M-16’s general retired-head behavior can already be tested using interface removal or file deletion.

M-07 is buildable now: reuse the allowed `tests/helpers/S4A-note-interleave-fixture.ts:42`, without editing it, and assert through the memory reads. P3 legitimately defers M-12. Add the reachable missing M-11/M-14 failure cases and M-15 satisfied-task case using the allowed seams; do not fabricate damaged records for otherwise unreachable cases.

**UNSPECIFIED 1–12:**

- **1:** Missing type support does not waive `anchorCandidates`; extend the note-read rejection contract.
- **2:** Reject refKey-as-time. P2 deferred reasons, not P8’s timestamp meaning.
- **3:** Matching accepted proposals by `draft.planId` is justified by `src/core/work-graph/state/plan-machine.ts:218`. Discarding an existing initial reason is not.
- **4:** Accept `unchecked > stale`, retaining all known stale reasons.
- **5:** Accept conservative ineligibility; M-14 already requires unresolved checks not become current conclusions.
- **6:** Accept/document `file_changed` and `file_deleted`; retain the required structured file outcomes.
- **7:** Reject the eligibility-preserving fallback. Existing material/history readers can be injected; unavailable resolution must remain unavailable.
- **8:** Accept synchronous rebuild making `index_not_ready` unobservable, subject to fix 8.
- **9:** Accept the name-span limitation imposed by §9; do not silently broaden signature semantics.
- **10:** Rejecting limits above 50 is reasonable; document and test it.
- **11:** Reject mixed historical/current semantics. The implementation uses version state but current-head confirmation/conflicts; align it with the existing historical-confirmation derivation.
- **12:** Accept project-level notes being `crossGoal` for a goal-bound Work caller. Specify effective-goal handling for Query/secretary consumers during 4C integration.

not ready