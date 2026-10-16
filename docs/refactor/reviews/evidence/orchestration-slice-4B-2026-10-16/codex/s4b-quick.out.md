Static review of the staged tree over `753bf5ab`; no edits, tests, or model calls.

Paths below: **V** = `src/core/work-graph/views/note-views.ts`; **R** = `src/core/work-graph/notes/note-read-model.ts`.

| Prior item | Status | Evidence / remaining gap |
|---|---|---|
| MF1 | **partly** | V:709–775 resolves the added fact kinds, but SessionMessage returns before revision validation (V:732). |
| MF2 | **fixed** | V:145,340,980: invocation-local caches; project-and-goal plan key. |
| MF3 | **fixed** | V:231,878; R:373,613,1197: shared observations/budget and coverage before filtering. UNSPECIFIED 3 needs clarification below. |
| MF4 | **partly** | V:276: name-based recheck and cap handling fixed; zero hits still become `symbol_missing` before checking captured-file availability (V:320). |
| MF5 | **fixed** | V:432,467: each anchor’s goal and continuous stage identity. |
| MF6a/b | **fixed** | R:509,741,1398,1443: lexical prefix range, combined filters, trailing-slash normalization. |
| MF7a/b | **partly** | R:826,815: exhaustible AND paging and `unsupported` preserved; R:1547 still emits forbidden `ranking`; cap detection remains incomplete. |
| MF8 | **fixed** | `src/core/record-store/sqlite-text-search.ts:194,265,277`: atomic rebuild, conditional cursor advancement, read-time validity check. |
| MF9 | **fixed** | R:1154,1172,1302,1470: retired/stale heads retained, absent-anchor checks independent of filters, candidates returned. |
| MF10 | **partly** | R:466,561,996: identity/request/rule/offset checks fixed; pinned body cursors do not bind/check head changes. |
| MF11 | **partly** | R:1223,1257,1341 fixes history paging, body-version matching and neighbors; direct check eligibility and post-trim body warnings remain wrong. |
| MF12 | **fixed** | R:638: trimming recomputes observations/coverage; explicit singleton overflow handling. |
| MF13 | **partly** | V:638 fixes attribution and authoring-Run scope; V:627 silently discards deletion-proof read failure. |
| MF14 | **fixed** | `src/core/work-graph/notes/note-version-lists.ts:89,117,141`: initial reason retained; plan timestamps and nullable catalog timestamps. |
| MF15 | **partly** | `tests/helpers/S4B-note-check-fixture.ts:147`: real holder restored; numerous NE3 rows remain single-backend, and read-side forbidden coverage is missing. |
| Prior should-fix | **partly** | R:888 bounds OR acquisition; AND acquisition still relies on the incomplete cap heuristic at R:863. |

**Must-fix**

1. **Apply revision validation to SessionMessage facts.** At `src/core/work-graph/views/note-views.ts:732`, an existing message referenced at revision 999 resolves untouched. Move the revision comparison before the message-specific success return; add a public-service regression expecting `version_ahead`, unchecked freshness and ineligibility.

2. **Verify captured-file availability before declaring a symbol missing.** At `src/core/work-graph/views/note-views.ts:320`, zero hits return before the capture-file read. A file absent from the capture can therefore become definite retirement. Establish that the file was available for analysis first; unavailable/missing captured material must remain `unchecked`, as R4 requires.

3. **Finish R7 and term validation.** At `src/core/work-graph/notes/note-read-model.ts:1547`, omit `ranking` for `'all'`; change the contrary assertions in `S4B-memory-ranking.test.ts:44,65`. Section 5 explicitly overrides section 6. At R:1437, reject explicitly supplied `terms: []` under L10 instead of silently executing an unfiltered listing. Resolve the cap signal before merge: a port call can exhaust its candidate budget while returning exactly `limit` matches, so R:863’s short-page test misses exhaustion and continues scanning.

4. **Bind pinned body cursors to the head version too.** `src/core/work-graph/notes/note-read-model.ts:954` stores the resolved body version; R:1003 checks changes only when unpinned. Store head version separately and reject any subsequent head change with `revision_conflict`, including explicitly versioned body requests, per R10.

5. **Finish R11 at both boundaries.** `src/core/work-graph/views/note-views.ts:952` can still return `currentEligible:true` for an old accepted version through exposed `platform.notes.checkNotes`; only the read-model wrapper masks it. Require `body.version === head.version` in the check itself. Also calculate `body_target_not_on_page` after byte trimming: R:1199/1265 can remove an attached body’s item without adding the required warning.

6. **Preserve deletion-proof read failures.** `src/core/work-graph/views/note-views.ts:627` converts a rejected RunActivity read into absence of proof and emits `deleted_path_unverified`. Return an outcome from `hasDeletionProof` and propagate read/decode failure as `unavailable`.

7. **Complete R16’s required coverage.** Parameterize remaining NE3 cases over both backends—for example `S4B-memory-version-lists.test.ts:52`, `S4B-note-budget-check.test.ts:27`, and `S4B-note-missing-flows.test.ts:38`. Add the specified read-side symlink/`forbidden` case; the case at missing-flows:74 tests writing instead. Backend independence does not waive R16.

8. **Remove the out-of-scope helper change.** `src/core/record-store/record-codec.ts:50` adds `unavailableFailure`, but that file is absent from L-scope/P8/R15–R16. Return the rejection locally in `sqlite-record-store.ts` and revert this addition, or obtain an explicit scope amendment.

**Should-fix / UNSPECIFIED disposition**

- **Fresh lead rulings needed before merge:** **3**, whether `filesRead` includes failed attempts; **4**, how AND paging reliably detects candidate-budget exhaustion.
- **Already settled:** **1** by R7; **2** by R12; **5** by R11; **7** by R14; **8** by R16. **6** conflicts with L10’s nonempty term rule. **9** requires the lead’s already-promised documentation amendments, not new product decisions.
- No database-backed assertion found. `S4B-memory-version-lists.test.ts:67` does use `queryTaskGraph` output as its timestamp oracle, but R14 explicitly prescribed that comparison; it is not independent timestamp verification.

merge after listed fixes