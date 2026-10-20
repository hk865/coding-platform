# T round: items left at the end of T (lead, 2026-10-20; rewritten 21:00 after the docs checks)

Collected from `t-w1-findings.md` §7, `t-w1r1-findings.md` §6, `t-w1r2-findings.md` §4, `t-w2b-findings.md` §0/§6,
`t-w2r2-findings.md` §3/§4, `t-state.md`, the docs checks (`codex2/t-docs-facts.out.md`, `checks/docs-claude-check.md`)
and the coverage comparison (`coverage/mapped-summary.txt`). Shown to the user in plain Chinese with the coverage
triage.

## For the user to decide

1. **L-1 AD08 (production gap).** Slice-3 spec AD08: when the Workspace moves @7 → @8 after assembly, entry must give
   `revision_conflict`. Production puts no Workspace source in the binding (`graph-context-reader.ts:1010`), already so
   at `t-base` (`:1013`); the old test passed only because its helper added a Workspace source by hand. Production fix
   (after T, like the decision-85-5 fixes) or spec change.
2. **L-3 TP-124 / GAP-46.** No Runtime tool entry for the Agent requeue owner (a real start refuses `requeue_task`
   before any model call, `execution-driver.ts:239-243`).
3. **Public reads that do not exist** (R-20 "missing entry point" parts kept in their old form, and L-5): the tests
   below still read stores directly or keep a stand-in because no public read shows the fact. Add public reads, or
   accept the gap:
   - W2b-17 / T1-062: a Task's full TaskReduction (no public read; only `completeTask`'s return);
   - W2b-53 / T2-025, T2-031, T2-032: three execution-history sub-parts (two unreachable, one no wait entry);
   - W2b-54 / T2-029: Kernel Sessions with no platform mapping (the directory reads only mapped records);
   - W2b-55 / T3-038: the observation pointer's revision and `readThrough`;
   - L-5: T1-025 and T1-068 event sub-parts (no public event read); T2-025 observer-down (no observer seam,
     `execution-driver.ts:1253` `publish` is a no-op).
4. **L-2 production guards with no test**, after T deleted the tests that reached them only by tampering:
   `provenNotEnteredKernel` (`src/contracts/run-activity.ts:91`; the deleted `S2B-r2-r5-not-entered.test.ts` reached it
   through `readTrackBars`, `track-read-model.ts:312`), the `plan-readers.ts:1390` filter, the T1-061 / T1-062 rows'
   guards, the physical-removal check `plan-validation.ts:337-338`, the re-check behind B-03. They are in the coverage
   triage (decision 79-4): impossible → delete; possible → test gap.
5. **Coverage triage (decision 79-4).** After T: 212 branch arms and 6 functions lost their last test in T; 100 arms on
   lines T added or rewrote are not executed; 1,107 functions were not executed before T and still are not (630 of them
   in the old UI `src/ui`, not triaged). The classification of the 795 triaged rows (Codex and Claude, reconciled):
   final (coverage/triage/triage-final.tsv; Codex and Claude each classified all 795, DSH
   tb-Tjudge-1020 judged the 167 disagreeing rows, challenged the 276 agreed D1/D2/U rows (28 re-judged: 17 stand, 11
   changed) and tried to refute the 8 findings against T (all upheld)): D1 55, D2 156, U 157, F 161, G 265, N 1, 待定 0.
   Delete candidates 211 (some kept: later-slice groundwork such as A3-021, frozen interfaces such as A2-032); U: no
   tests, delete the old-format tolerances, keep integrity guards; F+G 426 test gaps. Findings against T: TQ-114/115
   (IN04, IN12), T1-062 (changed-lease), TP-109 (RUN-16 pause), TP-172 (M05 otherGoal), T1-038 (source_moving), T3-063
   (symlink), TP-026 (tsconfig include), TQ-093 (display-preference empty state).
6. **Old-data code T missed.** Session records now require `provenance` (`session-record-codecs.ts:736`), but the
   null-provenance chain is still in production: `session-facts.ts:264-293` (`legacyPending`), its readers
   (`session-maintenance.ts:480`, `run-reconcile-service.ts:431`, `session-anomaly-service.ts:525-538`), and the
   `provenance_unchecked` line marker (`line-status.ts:443-447`, `contracts/work-line.ts:60`). TP-122 said to delete
   them together with the production backfill; the backfill went (TP-007, TP-062), these did not. Under decision 79
   they go; with the triage deletions, as one small fix.
7. **K3 and L8 debts that were sent "to T" and T did not take as items.** T's inventory covered the whole suite and
   reached some of them by file (K3: T1-023 K3-48-2, TP-142 F-052, TP-110 part of F-091, T3-081 F-014, T2-022 F-027,
   W2b-27 F-019's stand-in, the book-7 old-T files; L8: T3-044 K4-25–K4-41, TP-107 T33, T1-003 + W2b-01 T35, T3-039
   the replay test). Not done (each still as it was before T):
   - K3: F-067 (prefix C not summed field by field), F-066 (public prepare capacity refusal), G3 / F-071, F-075
     (`K3-B3-runtime-fail-closed`), G5 / F-088 (expected values from production functions), N-04 (five raised
     timeouts: `K3-44-crr-kind4` 300_000 ×2, `B2-09-crr-owner` 120_000 ×3), `B2-blocked-runtime:260-271` (hand-built
     WorkspaceFile), T-040 (`K3-mixed-seams`), the unchanged form rows F-002, F-004, F-006, F-010–F-013, F-028, F-029,
     F-048, F-094;
   - L8 production: the auto-capture replay branches no public step reaches (`architecture-service.ts:1304, 1335,
     1389, 1426`), the acceptance cancellation (`auto-capture-driver.ts:109` passes a fresh signal), the NUL scope key
     (`host.ts:183`), `session-archive.ts:244-248` (cancelled → unavailable; already a STATUS gap);
   - L8 tests: row A (per-await cancellation proofs), row B (the copied composition trigger wrapper,
     `S8A-L8-observation-state.test.ts:165-175`), J (`input = null`), UNSPECIFIED 2–5, P3 (hand-built health probe,
     own archive composition, SQLite only: `S1-runtime-scenario-fixture.ts:138`, `:159`), WP2 K4-42–K4-53, T34,
     T36–T69, Q6 (six SHA literals without their working), Pub:332 (body not read back).
   One more T-style round for these, fold them into the slices that touch the same files, or keep them as dated
   limits.
8. **L-4 test time.** Full suite before T about 2,520 s (the decision-85-5 merge suite) → 2,457 s (W1R1) → 3,072 s
   (W1R2) → 3,017 s (W2R1) → 3,476 s (W2R2) → 3,592 s (the merge suite; W2R2 and the merge suite ran beside the coverage
   run). Real worlds replaced handwritten state. Two tests carry raised timeouts by ruling: W2b-08 `120_000` (SQLite
   34–49 s) and W2b-20's store-page test `600_000` (205 real blocked Runs: memory 65–69 s, SQLite 162–168 s; R-22).
9. **Handwritten state left outside T's items** (rule sheet v2 binds only the items):
   - the S5 decision fixture's default path (handwritten Session and entered; the K3 world inherits it; W2b-21 added a
     real path beside it, used by the converted rows);
   - T1-053 residue: `tests/helpers/S4C2-note-card-fixture.ts` `createAuxSession` writes the Kernel Session itself;
   - F1 instances outside the items (v2 list);
   - the second F07 in `tests/work-graph/WP2-context-extensions.test.ts` (5,000 cards: `decisionSourceKey` for the
     expected keys, `anomalyDouble`, memory only);
   - T3-067's second-capture case of `tests/data/S8D-platform-fixture.test.ts`, restored by W2b-47 and not converted.
   One more T-style pass for these, or leave them.
10. **Spec question (small).** The execution-history reader has no principal check of its own; another principal's
    cursor is refused only by the Session history owner below (`session-operations.ts:426`).

## The lead's own (no user decision)

- Docs (in the T docs commit): the capability rows that named deleted files or removed behaviour (WG29, WG43, WS5,
  the `role-source-reader.ts` row; WG48, the catalog line, the old-manifest line, WG53, RT2, RT4, the `legacyProvenance`
  note); STATE-MACHINES-SPEC S1-SES-02 (`:5277`) and the `replyMode` rows (`:3293`, `:3308`, `:3344`) get dated notes;
  `docs/refactor/design/orchestration-2026-10/modules/core/workspace.md` names `project-source-index.ts`,
  `role-source-reader.ts` and their test; DSH-WORKFLOW §7.1 still points to rule sheet v1 only; DSH-WORKFLOW §6.10
  "交接只在试跑里触发过" is no longer true; the slice-1 spec SV03 cover post-note (W2b-18: the cover is now
  `tests/record-store/lookup.test.ts:101`, `:201`).
- Code, with the next small fix: `create-platform.ts:941-943` still says the test-only executed-files stub is injected
  by the slice-5 tests; the stub is deleted.
- The next test rule sheet: T's v2 branched from v1 and lacks the K3/L8 v3's A7 pass-through-sandbox entry and its
  crash-fixture wording (`orchestration-slice-K3-2026-10-18/checks/test-rule-sheet-v3.md`); reconcile the two into one
  sheet before the next slice, together with the A7 entry 3 wording (`executeChecks: false` no longer exists after
  W2b-27).
- Decision 83-3's contradiction (the base prompt tells the model to use `check`, the platform gives no such tool) was
  to go into C1 or T; neither took it. Carry it into the decision-83 section of slices 6–7.
- 293 unused names repo-wide under `--noUnusedLocals` (12 in files T touched, all older than T): note only.
- Evidence: the deviations (wave-2 reworks 1 and 2 by Claude subagents by the user's decisions of 10-20 14:41 and
  18:14; the lead's workflows on rework-1 rows at 14:31 and 14:40; rework 3 by the lead under decision 80-4). By
  decision 81-1's count (DSH reworks only) wave 2 had 0 DSH reworks; by the frozen tables it had three.
