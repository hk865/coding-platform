All final checks pass. Here is the report.

## FILES CHANGED

```
src/app/collaboration-driver.ts
src/business/workflow/consultation.ts
src/business/workflow/session-archive.ts
src/business/workflow/session-maintenance.ts
src/business/workflow/workflow.ts
src/composition/create-platform.ts
src/core/work-graph/communication/mailbox-service.ts
src/core/work-graph/model/claim-contracts.ts
src/core/work-graph/sessions/session-directory.ts
src/core/work-graph/sessions/session-lifecycle.ts
src/core/work-graph/sessions/session-record-codecs.ts
src/core/work-graph/sessions/session-responsibility-service.ts
src/core/work-graph/state/session-responsibility.ts
src/core/work-graph/tasks/claim-service.ts
src/core/work-graph/tasks/plan-readers.ts
src/core/work-graph/tasks/requeue-service.ts
src/core/work-graph/tasks/run-state-service.ts
src/core/work-graph/tasks/session-anomaly-codecs.ts
src/core/work-graph/tasks/session-anomaly-service.ts
src/core/work-graph/tasks/session-facts.ts
src/core/work-graph/tasks/session-provenance-facts.ts
```

## CHECKS

- `npm run typecheck` → exit 0 (expected 0).
- `npm run check:architecture` → exit 0, 40 edges, `next source boundaries: OK` (expected 0).
- `npm run build` → exit 0 (expected 0).
- 23-file new-test command → `Test Files 1 failed | 22 passed (23)`; `Tests 1 failed | 211 passed (212)`. Expected 211 passed / 1 failed. Only failure: `tests/scenarios/S1-archive-restart.test.ts` IT19 (`expected 'waiting' to be 'completed'`, line 194), the `/usr/bin/bwrap`-absent environment row. Every other file passes fully.
- 22-file regression command → `Test Files 5 failed | 17 passed (22)`; `Tests 13 failed | 528 passed (541)`. Expected 528 passed / 13 failed. The 5 failing files are the baseline bwrap-only ones: `A8-host-restart-paused` (1 passed / 5 failed), `C3-brief-idempotency` (0/4), `C3-not-entered-chain` (0/1), `C8-auto-rework-cap` (0/1), `C8-human-stop-respected` (5/2). All other files pass completely.
- `git status --short` → exactly 93 paths: 62 `src/` + 31 `tests/`, 0 other (expected 93).
- `git grep -n "not implemented: " -- src` → no output (expected none).
- 31 frozen file `sha256sum -c` → all 31 OK (reference §2).
- `sha256sum src/contracts/platform-duty.ts` → `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39` (matches).
- `./.dsh-scratch/` deleted; no other untracked file remains.

## UNSPECIFIED

- **B6 (partly closed)** — `src/core/work-graph/tasks/session-facts.ts:271-289`. `legacyPending` is set only by a successor-sweep budget hit or a null-provenance successor returned by `SESSION_BY_PROVENANCE_LOOKUP`; the index keys on `provenance.from.sessionId`, so an unchecked null-provenance Session in the workspace that is not a successor is not observable and the `:284` branch is effectively dead. A workspace-wide scan is not described by §2.8/the slice, and no frozen test covers it.
- **B8 (partly closed)** — `session-facts.ts:398-410`. The supplementary `lastExecutionRef` locator is appended only on the final page and deduped only against the current page, so a pointer already returned by the index on an earlier page can be delivered twice; §2.8 S:383 says "merge by full ref" but does not define the stateless-paging interaction. No frozen test covers it.
- **E2 (partly closed)** — `src/business/workflow/session-maintenance.ts:166-174`. The `Run.endedAt` fallback is removed and the close-event `taskBasis.finishedAt` path is implemented, but for an old close with no `finishedAt`: (a) a formally **satisfied** Task should recover `TaskReductionSnapshot.reducedAt`, and the Workflow deps expose only `plans.queryTaskGraph` (whose `TaskRow` has no reduction), so such Sessions record `incomplete`; (b) **cancelled/superseded** uses the active plan's `acceptedAt`, not the first terminal PlanRevision's `acceptedAt` (the correct `setIn` logic exists in `plan-readers.ts:1732-1741` but is not reachable from the Workflow). A reduction/first-terminal-plan reader is not named by spec §3.3.
- **E5 (partly closed)** — `src/business/workflow/session-archive.ts:551-570`. L-d's "return the existing TaskRequeue as replayed" is implemented for detection/reuse, but the step receipt cannot carry the existing TaskRequeue's real commit cursor: no injected port exposes it and `TaskRow.requeueRef` has no cursor/Goal revision. Recovery therefore finishes the archive and reuses the durable record without a fabricated receipt; on a later legal Goal update this still avoids the previous `idempotency_conflict` stop. A TaskRequeue receipt reader is not named by the spec.
- **E13 (partly closed)** — `session-maintenance.ts:265-289`. All three facts (answer saved, attached to the original message, input acceptance confirmed) are enforced only when a mailbox reader is wired (production via `consultations.messages`). The frozen maintenance fixture (`tests/helpers/S1-workflow-archive-fixture.ts:1222-1251`) wires no reader, so the saved-answer-only fallback is what keeps IT11 green.
- **E14 (not closed)** — `session-maintenance.ts` has no backfill call. `SessionDirectoryPort.backfillSessionProvenance` requires the derived `provenance`+`basis`, and `WorkflowDependencies` exposes no `LegacySessionProvenancePort`/derive seam; the spec's §3.3 addition list for `WorkflowDependencies` does not name one. Per the E14 item's own instruction this is reported under UNSPECIFIED rather than adding an unnamed dependency.
- **E15 (partly closed)** — `src/business/workflow/workflow.ts:1029-1036`. The ordinary continuation branch now writes `continuation` provenance (with the archive-origin pickup staying `new`, T10), but the responsibility transfer + predecessor archive half cannot be expressed in the one-owner-call `WorkflowCalls`/`WorkflowOperation` per-`perform` state machine without adding new exported step kinds. Left for a main-Session signature decision.
- **Spec-undecided cases met** (choices made, not decided by the spec): A4 a missing/undecodable Run is treated as not queued and an unreadable cancel intent as queued (conservative); A5 refusal prefix `work_responsibility_unresolved:`; B1 `eventAt` not-found uses `legacy_provenance_ambiguous:`; B2 checks only the first (min-generation) claim's Run, requires the manifest's embedded claim to equal it and `locateCreation` to succeed, and splits damage→`unavailable` vs absent/other-content-type/`seededFrom:null`→no evidence; C1 keeps `request.mode==='retired'` as the S1-ANCHOR-02 row selector while verifying the retired facts; C4b a real execution origin with a foreign cancel now yields no exemption (ordinary class) while forged/unmatched origins stay `forbidden` (`tests/state/invariants.ts` still derives `archive_cancel` from any non-retired stored anchor, so a future fixture with a real anchor + foreign cancel could disagree); E2/E8 validate Host principal + actor + project/workspace scope but no "lease" is available at the Workflow seam; E15 reason mapping (`role_mismatch`/`damaged`/`interrupted`); E17 "explicit continue" read as the driver continuation through `advanceWork`; the optional `readRoutedReplies?` seam was restored to `CollaborationDriverDependencies` (type-only, unconsumed) to keep `collaboration-driver.ts` inside reference §5 and the 62-src/93-path count.
- **Frozen test vs spec (IT11)** — `tests/business/S1-session-maintenance.test.ts:522-523` asserts an answered read-only copy is archived, while `workflowForFixture` (helper `:1222-1251`) wires no mailbox reader; S1-AUTO-03 (S:482) and §4.2 S:829 require all three copy facts (answer saved, answer attached to the original message, input acceptance confirmed). Counter-example: a strict implementation that returns `unsupported`/not-archived when the attachment/acceptance facts cannot be read would fail IT11. The code therefore enforces all three only when a reader is present and otherwise falls back to the saved answer.

## NOTES

- Wave 1: G-A closed A1–A9; G-B closed B1, B3–B9 and B2 (after a main-Session decision to add the optional artifact-body dependency); G-C closed C1–C4; G-D closed D1.
- Wave 2: G-E1 closed E1, E3, E4, E6, E7, E9, E10, E11; G-E2 closed E2 (close-event path), E8, E12, E13; G-E3 closed E9 call sites, E16, E17 and E15's provenance half.
- Fix pass closed C1, C4a/C4b, E12, E17, A6, E8, E6, A9 (`state/session-responsibility.ts` + service) and B2-narrow (`claim-contracts.ts` + `create-platform.ts`).
- Subagents used: 4 wave-1 implementers, 1 G-B follow-up (B2), 3 G-E implementers, 5 read-only self-checks, 1 fix pass (14 runs); plus the main Session's E9 internal-entry edit.
- E17's mandated removal of the unbound maintenance hook reverted `src/app/collaboration-driver.ts` to HEAD; the unrelated optional `readRoutedReplies?` seam was restored so the reference §5 scope (62 src) and the 93-path check hold.
- Blocker: `/usr/bin/bwrap` is absent, so IT19 (and the five regression files A8/C3×2/C8×2) fail exactly as the reference baseline states; not worked around.