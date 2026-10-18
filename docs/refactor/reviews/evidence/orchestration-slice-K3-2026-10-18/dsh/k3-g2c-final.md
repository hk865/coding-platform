All subagents have reported, scratch removed, checks green. Final reply:

## FILES CHANGED

**Production — 10 modified src files, +778/−57, plus 1 new file (98) ≈ 875 new production lines this part; group 2 ≈ 3,695.**
`contracts/continuation-brief.ts` (type + renderer), `agent-runtime/continuation-brief-assembly.ts`, `agent-runtime/context-assembler.ts`, `agent-runtime/execution-contracts.ts`, `agent-runtime/runtime.ts`, `agent-runtime/unknown-call-draft.ts`, `work-graph/communication/mailbox-service.ts`, `work-graph/model/execution-read-contracts.ts`, `work-graph/tasks/run-state-service.ts`, `composition/create-platform.ts`, new `workspace/continuation-diff-reads.ts`.

**Tests/seams — new:** `K3-r1-seams.test.ts` (self-tests), `K3-R1-restart-flows` (K3-01/02/03), `K3-R1-file-change` (K3-04), `K3-R1-workspace-capture` (K3-40 i–v), `K3-R1-session-not-closable`, `K3-R1-second-cleanup`, `runtime/K3-continuation-review-note`, `composition/K3-R1-close-open-turn`, `helpers/K3-mailbox-seam.ts`, `scenarios/support/git-workspace.ts`, `scenarios/support/shell-work-root.ts`. **Modified:** `harness.ts` (gitWorkspace option), `K3-tool-seams.ts`, `WP1-handover-fixture.ts`, `K3-39-tool-commit-lookup.test.ts`, `A2-reconcile-runtime.test.ts`.

## RULINGS 1–5

1. **WP1 fixture — done.** `UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS` registered in the fixture backend (part-2 `S2B-be2-reconcile-support.ts` pattern). WP1 **17/17 pass**; no HO test fails because the note gained a review section. Other bundle lists lacking it (`S1-archive-service-fixture:77`, `S1-runtime-scenario-fixture:128/157`, `S5-queue-support:265`, `S1-workflow-archive-fixture:243`) have no consumer that writes the review, so no edit; reported.
2. **Queued steer — done.** Deleted the `it.skip` `stop_pending` case; replaced with RUN-25 (`W-26`, `takeover_unresolved`, `applied:true`). The R3 fixture’s steer is **Superseded** (`platform_reconcile`/`terminal_without_cancel`): no mailbox channel, so the Kernel never accepted it; the Applied branch and note text are the R1 path. A2 file: 30 passed / 1 skipped (`review_round`, group 3).
3. **R1 in-sandbox — done.** All R1 tests drive `h.advance` only to the prepared point; no check ran; no check-dependent assertion was left.
4. **K3-03 — done (RED→GREEN).** Item `undetermined` (`lookup_failed`), record `needs_decision` with `undetermined`, read via `unknown-call-reviews/read`; no card/continuation assertions.
5. **K3-21 R1 — done.** `session_not_closable` → `blockedBy:'session_not_closable'`; `second_auto_cleanup` → RUN-20(i) with `second_auto_cleanup`, then `executions/resolve-unknown` and B’s record `streak` exactly `{priorAutoCleanup:true, priorUnknownProcess:true, resetRunRef:null}` (L23 ex.1). **Applied pause cannot occur:** `run-machine.ts:2110-2111` (RUN-23) and `:2294-2295` (RUN-19/24) reject a turn with `inFlightToolCallIds.length>0`; a submitted pause stays `queued` (`:1806-1811`); `pause_not_entered` (`:1873-1875`) applies only to a not-entered Run. No test written.

## WORK ITEMS 1–4

1. **Seams — done.** Stand-in `shell` (vi.hoisted+vi.mock; blocks; real when off) self-tested; `HostScenario.open({ gitWorkspace })` + `gitIn` self-tested; K3-01 = `lockLedgerAfter('SessionMessageSent',{kernelStore:true})`; K3-02’s documented recipe did **not** work, so a new blocking `send_session_message` stand-in (`K3-mailbox-seam.ts`) records `tool.started` with no commit/result. Long ids already covered.
2. **L6 — done.** `ContinuationUnknownCallReviewV1` + `unknownCallReview?` on the brief; renderer section (title/count/verdict lines/file lines/fixed sentence `- 不在变动清单里，不证明没做。`) as a second mandatory part; assembly caps (oldText/newText ≤1,000 units; diff ≤2,000/path, section ≤8 KiB, `section_limit`, plus binary/too_large/protected/not_text/baseline_dirty); record read via `ContinuationBasis.unknownCallReview` from the afterRun; clean-start diff from `baseline.headCommit` via `git cat-file blob`. Group-4 spot left. 11/11 unit tests; old-brief bytes pinned unchanged.
3. **R1 flows — done.** K3-01/02/03 GREEN, K3-40 (i)–(v) 5/5, K3-04 GREEN after: capture artifact `sourceRefs` (was `[]`), mailbox lookup built from `input.origin` + claim generation, and RUN-25 added to `closeOpenTurn`’s allowed endings (K L27).
4. **Item 4 — done.** K3-21 R1 (above); queued steer; K3-48(一) half: 32 over-budget calls through the classifier → `W-26`/`applied`, no `inventory_incomplete`; owner kept 17 items, omitted 15, 158,497 B, `too_large`.

## CHECKS

Batch (§6 list, A8 expanded; `--maxWorkers=3`): **109 files — 102 passed, 7 failed; 4,399 passed / 22 failed / 30 skipped.** All 22 failures + 1 suite are DSH-BASELINE §A sandbox (A8 no-bwrap; `invariants-fuzz` coverage). No unexpected failure. One integration fix: `check:architecture` flagged a forbidden `WorkspaceTools → AgentRuntime` edge; moved `ContinuationWorkspaceBytes` into WorkspaceTools (re-exported from execution-contracts). After: **typecheck exit 0; check:architecture OK; build OK.** Targeted: WP1 17/17; A2 30/1skip; R1 files 11 tests.

## UNSPECIFIED

- **K3-04 two-in-flight:** the real `edit` is `workspace_write`/`independentReadOnly:false`, so the Kernel starts only one call and `unresolvedToolCallIds` excludes `pending` by design. The test seam is a `read_only`/`independentReadOnly:true` stand-in `edit`. Options: keep (current), or treat the row as unreachable.
- **L6 retrieval:** spec says `git cat-file blob`; we resolve `<headCommit>:<path>` in the same command.
- **`second_auto_cleanup`:** the AG2b work grant has no `shell`, so A’s process item uses a new composition-root helper (`shell-work-root.ts`); strict HostScenario-only would force `read` and `priorUnknownProcess:false`.
- **Applied pause** (file:line above) — reported, no test.

## SUBAGENTS (8)

S1 seams 4b63… (~35 min); S2 L6 e53d… (~50); S3 R1 flows cf1b… (~70, longest); S4 R3 steer/K3-48 8348… (~30); S7 R1 glue abae… (~30); S8 K3-04 fix e65f… (~30); S9 K3-21 R1 f4b5… (~30); S5 close-out e386… (~20). All inactive.

## SURPRISES

The real Host could not reach RUN-25 at all until three part-2 production gaps were fixed (empty artifact `sourceRefs`, mailbox lookup using the Host principal + wrong generation, and the missing RUN-25 row in `closeOpenTurn`). K3-02’s documented lock recipe was wrong and needed a blocking mailbox seam.