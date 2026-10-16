Implementation review of slice 4B (note search and freshness) before merge. Read-only: do not edit files, do not run
tests, do not call any model. You may read any file in this repository and in D:/cc-lead-notes.

Repository: the current directory. HEAD is 753bf5ab (slices 2C, RL and 4A merged). The index holds slice 4B as it will
be merged on top (`git diff --cached HEAD`, 35 files: 13 production files, 22 test files and helpers).

Frozen spec: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` — the 4B parts: §0.3 L9–L12, L19, L22,
L23, §2 (the RecordStore full-text port, `NoteMemoryReadPort`, `NoteCheckPort`, the 4B fields of the note read types,
the constants), §4 rules, §5 rows T-01–T-09 (NE2) and M-01–M-16 (NE3), §6 4B line, §7, §8, and §9 (4A's construction
rulings, which bind 4B). Task book: `D:/cc-lead-notes/impl/s4b/s4b-impl.md`; its section 10 holds the lead's binding
answers P1–P14 to the read-through (`D:/cc-lead-notes/impl/s4b/s4b-preread-final.md`). They change the spec in places:
P1 (the port is AND-only; `'any'`, score and ranking are computed in `memoryFind`), P2 (catalog version reasons move to
8A), P3 (`updateDue` and M-12 move to 4C; `UnderstandingStatusV1.updateDue` is `boolean | null`), P4 (the per-scope
count is not narrowed), P5 (FTS code and rebuild in `sqlite-text-search.ts`, `fullTextProbe` option), P7 (candidate
sources for `find`/`stale` without terms, five ordered anchor indexes), P8 (scope and the version list types). Treat
them as binding; flag one only if it breaks a spec rule that P1–P14 did not intend to change. Builder's report:
`D:/cc-lead-notes/impl/s4b/final-1.md` (read its NOT BUILT, UNSPECIFIED and NOTES).

Verified by the builder in its sandbox (no bubblewrap): typecheck, boundary check, build, kernel-patch check; 4B tests 19
files, 141 passed, 2 skipped; 4A tests and the platform test passed; full suite: no failures outside its baseline. The
lead re-runs these on the merged tree with bubblewrap.

Review, citing file:line:
1. Behaviour against the spec and P1–P14: the full-text port on both backends (normalization, windows, candidate
   superset, substring check, AND semantics, refKey order, paging, the per-call candidate cap, rebuild and code,
   `unsupported`); the check port (L9 fields, L11 freshness incl. the 256-file budget and symbol rechecks, L22 fact
   resolution and `NOTE_READ_FACTS_MAX`, L23 anchor status, hints, similar notes); the six reads (cursors bound to
   identity, request, rule version and record cursor; `revision_conflict` across pages; `cursor_mismatch`; empty pages
   with `complete: false`; the 48 KiB bound; body paging on UTF-8 boundaries; current filter, cross-goal marks and
   order; `'any'` ranking and partial ranking; `not_found` versus empty); the version lists; the registration.
   A read failure must never become a definite answer (§9): look for any path where a failed read becomes `fresh`,
   `live`, `currentEligible: true`, an empty list or a count.
2. Both backends give the same results; reads go to the end unless the spec bounds them; the spec's bounds report
   `complete: false`/`unchecked`/`capacity`, never a silently shorter list.
3. Tests: business flows through public interfaces, literal expected values from the spec or hand computation, no
   database or record-store reads to verify, no product functions used as oracles; doubles only where spec §7 allows
   (T-06's FTS5-unavailable probe, M-03/M-11 workspace doubles, 4A's two doubles).
4. Each builder open point, with your recommendation: NOT BUILT items (M-15 `module_removed` and M-16 "module gone but
   heads" skipped because `reviseArchitectureCatalog` refuses removing a module, `catalog-service.ts:671-673`; M-02's
   module-removed half; M-07's same-topic-race half not tested on the read path), and UNSPECIFIED 1–12 — in particular
   1 (`anchorCandidates` has no field in `CoreRejection`), 2 (catalog `at` is a refKey, not a time), 3 (plan reasons
   matched by `draft.planId`), 4–6 (freshness priority and reason codes), 7 (`artifact`/`kernel_history` facts go to
   `uncheckedFacts`), 11 (versioned reads use the head's state) and 12 (a project-level note read from a goal is
   `crossGoal`).
5. Anything 4C will trip over (L13–L17, L20, L21 consume these reads: names, shapes, the `notes` holder, the allowlist
   entry, cursor and bound behaviour).

Reply under 1,800 words: numbered must-fix items (each with the concrete change), then should-fix, then your answers to
item 4, then a one-line verdict ("merge", "merge after listed fixes" or "not ready").
