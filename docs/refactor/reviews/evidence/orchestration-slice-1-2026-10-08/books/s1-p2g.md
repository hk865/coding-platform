# Slice 1, part 2 guided round: fix the regressions and the remaining gaps (new Session; groups with subagents)

You are a NEW Session in a copy of a TypeScript repository (the current directory). Two earlier Sessions implemented
part 2 of slice 1. The lead ran the WHOLE test suite in an environment that has `/usr/bin/bwrap` (yours does not)
and a second independent review. This message gives you the regressions found there, their root causes (the lead
reproduced them), and the remaining review gaps, each with the lead's decision. Do not make other design decisions:
what this message and the spec do not determine, list in your report.

**This run is headless: when your turn ends, the run ends and every subagent still running is stopped.** Never end
your turn while a subagent runs: wait with a bash `sleep 300` (repeat) and check `list_agents` until every subagent
has reported; end your turn only with the final reply of section 7.

## 0. State of the copy

- Commit 48c8d473 plus an uncommitted change of exactly 95 paths (`git status --short`): 62 source files and 33
  frozen test files (section 1). No stub is left (`git grep -n "not implemented: " -- src` prints nothing).
- In your environment now: `npm run typecheck`, `npm run check:architecture`, `npm run build` exit 0; the 23 new
  S1 test files 211/212 (IT19 needs bwrap); the 22-file regression command 528/13 (13 bwrap). In the lead's bwrap
  environment the 23 S1 files pass 212/212, but the whole suite has 43 failures in 21 files that pass at 48c8d473
  (section 3 lists them with causes). Two of those files were spec-mandated expectation changes; the lead updated
  them (section 1).
- Reference: `./.dsh-scratch/part2-reference.md` (the first part-2 message): §1 spec map with line numbers, §3 lead
  corrections K1-K7 / D1 / D2 / D6-D8 / D10 / D11, §4 rules 1-14, §4a test givens, §5 the 62-file write scope,
  §7 the check commands. Its §2 hash list is superseded by section 1 below; its §0, §6, §9 do not apply.
- The spec is `docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md`; §0 (lines 5-75) wins. `S:n` =
  line n of that file.

## 1. Frozen tests (never change them; `sha256sum -c` must pass at the end)

```
a2d3559191bdeb3a0a5e75430220d656a64dab8af62c7116fdea29ffe67832e1  tests/state/S1-session-archive.test.ts
ccc6093302c6887acb161381cda934c0cb1f0946ac161092e1e4ed6084ca08c9  tests/state/S1-responsibility.test.ts
5e0232f8adb2549ef08b47a242bbf0f2337d558bf8eb172906e9f44780845c88  tests/state/S1-anomaly.test.ts
533980182509484f30c2abdf16458cb615ad3c7cd50b44ae6a3446f7c3f3e15c  tests/state/S1-message-routing.test.ts
ba6c9a6fde11696c98462b1a8830e9a444c0ce24d5e3f21a0d244c6e7d79937b  tests/state/S1-dispatch.test.ts
c5d385efdef299be1c95e244241f82d5fd5d832afeef2b4766dc0b27ab3dcc62  tests/state/S1-archive-rework.test.ts
7037c31009eca04a90dbd7902723cc8bfa8a5253aebbaf7c9cea1586d84b0011  tests/business/S1-task-order.test.ts
175969bdab4035df1a7093a426d92a8c773f987e475e45c1af69cf4256d3231e  tests/work-graph/S1-codecs-indexes.test.ts
c4d5c0204da0471419acc9bf056c6bc2112481c66037ff2b6a7c97f918b530bf  tests/work-graph/S1-session-facts.test.ts
5ab41fc7cd9c4df5fb7321f910cd9e9bb047b5c20082966f2a904ed2ce9cd34e  tests/work-graph/S1-provenance.test.ts
05aced2f696319fcb88bc6644b70f98ca9601b968de9641fc608910c3916011a  tests/work-graph/S1-responsibility.test.ts
5bc17d4621019d45b545bd5fad878f1aa2a065c57b53d3711e9ebdfb72c52f60  tests/work-graph/S1-archive-owner.test.ts
62a89fcd13a839fdfc67507077c7df9e8bb41fb06babda2e99bd76af32fdf9d5  tests/work-graph/S1-anomaly-owner.test.ts
fc7040a3403b9cf20697e34d0c78fad19ad71a65967e5704f17fe4419a402645  tests/work-graph/S1-wait-disposal.test.ts
0b3c9fe33cdf85780ddc09af2f848f9fd75d87677e40636787e2dd45e9f3560d  tests/work-graph/S1-requeue.test.ts
53012a95422d33f809745b13e07b37370e38e9748f43fdb5e2a1254d39fc57cf  tests/work-graph/S1-dispatch-guards.test.ts
5a2a6598774cfad786227eada108bd2a91665631e7847dc121391571e5090f1d  tests/runtime/S1-archive-files-brief.test.ts
16ace7dc8dda48042961939d7f64402ac50a58684c673ef685dd889bf32094ea  tests/business/S1-session-maintenance.test.ts
57a5825d7fb549c7557bdefd536f7d3cb5c3a8430b180a045e916902ba644b00  tests/business/S1-archive-flow.test.ts
1765201bf8d0f857a3d9d8cbd591552cf6109a4afd6750a446182ebaccd6ca0a  tests/app/S1-session-routes.test.ts
614456873cddfff2bf1dc00ea21cbe23126ad704ab6914b0206314cbb1b11131  tests/scenarios/S1-archive-restart.test.ts
ff3bd50e2b9e7135a97b868fec3a7be8c687e4df2445dcc9d4322eb52b2659dd  tests/scenarios/S1-wait-copy-retirement.test.ts
12c1e08f2fb9d7d19afc72ee00d1dca14d3faddc36744d17e21a4260d9f2e91a  tests/runtime/S1-routed-replies.test.ts
60a7441359c9f975b4e3738cdf63e33b0be2ca2609af505547172d04facef9fa  tests/architecture/state-writes.test.ts
0890aa83fd160829f83eb370c6c5c52f2e017ff63e5ab44b8ff2204b3bd9a5a7  tests/state/invariants.ts
718046f994c9645bab6d4140310c55104b04d1a8c7e05aeaf0d2e35599ab423b  tests/state/session-availability.test.ts
792771c673d552e6eef63a47594b155516fa5cf2bb180fb483ad4a00a0b5749a  tests/state/message-machine.test.ts
739230be8f47d6d981d8bd670fc61fa67fa4fb50a94bf02b01b1aff77a5d1275  tests/helpers/S1-archive-service-fixture.ts
68a91739bbd5f5e0d6681092c9ab506eac9a67f322d0b33831188053b1e49c5d  tests/helpers/S1-session-facts-fixture.ts
016fa0d310a2fa937707c5bdd3fd4cf159c8467d0683ea733b7ed1fb31555702  tests/helpers/S1-workflow-archive-fixture.ts
1af206e620e1c3d342c9d6c9d66c6b81b7f6633c3463d0c51d839c46c2fe453f  tests/helpers/S1-runtime-scenario-fixture.ts
bb6018e8afc2aeceda7ab7800ce067856753398f85a4ce59e7c6b7dbb2579a81  tests/contracts/A2-rework-contract-helpers.test.ts
2c20a4e0adc5ab57e3d26cd1a9d7c5d13a828eb0739b93d83290c53494b00d38  tests/work-graph/C1-session-mailbox.test.ts
```

The lead changed since the last round: `tests/helpers/S1-workflow-archive-fixture.ts` (the fixture Workflow now gets
`messages`, the same mailbox the real composition passes, and `records`); `tests/contracts/A2-rework-contract-helpers.test.ts`
(the closed automation list now has `workflow:session-archive`, S:596); `tests/work-graph/C1-session-mailbox.test.ts`
(the lookup list now has `session-reply-by-handler`, IDX-S6). If a fix seems to need another test change, do not make
it: report it in UNSPECIFIED (test, assertion, spec line, why).

## 2. Rules for this round (plus reference §3 and §4)

- Write only the 62 source files of reference §5. No test/helper/config/docs/`vendor/`/lock change. New files only
  in `./.dsh-scratch/` (delete the folder at the end, including `part2-reference.md`). Git: only status, diff, grep,
  show. No real model, no servers.
- Exported signatures: only the main Session changes one, in step 0, and reports it. The optional Workflow
  dependencies approved by the lead are listed in the decisions below; add them in step 0 (in
  `src/business/workflow/ports.ts`) and inject them in `src/composition/create-platform.ts`.
- Keep everything that passes now passing.

## 3. Regressions in the whole suite (lead reproduced each cause in the bwrap environment)

Failing files (all pass at 48c8d473): tests/app/R6-host.test.ts, tests/business/R5b-initial-planning-workflow.test.ts,
tests/composition/C1-M1-platform.test.ts, tests/composition/R5c-workflow-platform.test.ts, tests/composition/platform.test.ts,
tests/scenarios/A11-no-progress.test.ts, tests/scenarios/A4-duplicate-receipts.test.ts, tests/scenarios/A7-control-goal29.test.ts,
tests/scenarios/A7-control.test.ts, tests/scenarios/A8-host-restart-entry.test.ts, tests/scenarios/A8-host-restart-lease.test.ts,
tests/scenarios/A8-host-restart-paused.test.ts, tests/scenarios/A8-host-restart-rework.test.ts, tests/scenarios/A8-host-restart.test.ts,
tests/scenarios/C3-reply-other-session.test.ts, tests/scenarios/C6-unrelated-adoption.test.ts, tests/scenarios/harness.test.ts,
tests/state/invariants.test.ts, tests/work-graph/A2-step1-codecs.test.ts, tests/work-graph/C1-session-mailbox.test.ts
(plus tests/contracts/A2-rework-contract-helpers.test.ts, now fixed by the lead's test update).
Many of them need `/usr/bin/bwrap` in your environment: run them anyway; a failure whose message names
`/usr/bin/bwrap` is environmental (the lead re-runs those); every other failure in them must be gone.

- R1 (M) WALL CLOCK. `src/business/workflow/session-maintenance.ts:~359` takes `now` from `new Date()`, while the
  fixtures and the platform run on an injected clock (e.g. `2026-09-26T00:00:00.000Z`). Lead trace in
  R5c-workflow-platform: after work-1, maintenance (now run per advance) saw `finishedAt=2026-09-26T00:00:00Z`,
  `now=2026-10-08T20:01Z`, `due=true`, and ARCHIVED the executor Session, so work-2 got a new Session ("the two works
  must reuse one Session: expected 2 to be 1"). Disabling only the executor-due archive made R6-host, R5b, R5c (2),
  A7-control-goal29, A8-host-restart-paused (A8-3l), A8-host-restart-lease (1), C3-reply-other-session,
  C6-unrelated-adoption and invariants.test I-4 pass. Decision L-g: every new time in the Workflow archive and
  maintenance code (due `now`, `requestedAt`-like values it supplies) comes from an injected clock: add optional
  `now?: () => string` to `WorkflowDependencies`; `create-platform.ts` passes the platform's `now`
  (`options.now ?? …`, line ~412); `new Date().toISOString()` only when not injected (S:597 "所有新时刻由owner注入now
  获取，未注入沿现有new Date().toISOString；测试用同一固定clock").
- R2 (M) DECODED SHAPE OF OLD RECORDS. Decoders now add the new optional keys as explicit `null` to records that
  never had them, so a replay or a decode no longer equals the original value: A2-step1-codecs ("encodes and decodes
  losslessly", TaskRequeue decoded 25 keys vs 24; Session decoded 14 vs 12), C1-session-mailbox ("retains the exact
  send/ack/respond receipts", "preserves committed success…", "a released same-owner Lease…": the replayed value has
  extra keys), C1-M1-platform, A4-duplicate-receipts (same receipt mismatch pattern). Rules 1 and 4 (a replay returns
  the original value; old records, receipts and digests do not change). Decision L-f: a record or event WITHOUT a new
  optional field decodes WITHOUT that key (absent stays absent; every reader uses `?? null`); a PRESENT value is
  validated strictly (K3); new records keep the shape their constructor wrote (K2: `createSessionRecord` without
  provenance writes today's 12-key literal). If a frozen S1 test asserts an explicit `null` key on a decoded old
  record, keep `null` for exactly that codec and report it.
- R3 (M) RETIRED-LINE ARCHIVE REQUEUES RUNS IT DID NOT STOP. At Host start-up (maintenance after reconciliation, K5)
  and per advance, a retired line without a continuation is archived and its interrupted Task is requeued with an
  archive origin before the existing re-drive runs; this changes A8-host-restart (W-11, W-14, W-15, §12.1 step 6b),
  A8-host-restart-entry (A8-2b, A8-2d), A8-host-restart-lease (Q-05, Q-01: the old `sessions/archive` route now
  answers 400), A8-host-restart-paused (A8-3n: phase `pending/requeued` instead of `failed/run_failed` right after
  reconciliation), A8-host-restart-rework, A7-control ("expected [create_session, …] to include requeue_task"),
  A11-no-progress (TypeError reading `value`) and harness ("host mode crash"). Disabling the retired archive made all
  of these pass except A4 and A8-3n/A8-R1 (R2). Decision L-e (S1-AUTO-02 S:483 "无continuation→未完Task放下、anchor、
  原paused不requeue"; §4.1 step 7 requeues "live Work" the archive itself stopped, and the waits it cancelled): the
  archive requeue (archiveOrigin) happens ONLY for a Run this archive request stopped (its own cancel) or a wait it
  cancelled. For a Run that had already ended before the request (a retired line after a crash), the archive writes
  the anchor and drops the responsibility but does not requeue; the existing automation (start-up re-drive / advance)
  requeues it exactly as before. Also check S:865: the old `sessions/archive` route keeps its old behaviour when there
  is no unfinished choice and no occupancy (A8 Q-01 expects 200).
- R4 (S) `tests/composition/platform.test.ts` (both backends): the public platform object gained the keys
  `responsibilities`, `sessionAnomalies`, `sessionFacts`. The spec does not add them to the public surface; keep them
  inside the composition (they still reach the Workflow and owners).

## 4. Remaining review gaps (second review; M = must, S = should). Lead decisions in brackets.

Sessions — `src/core/work-graph/sessions/*`:
- A1 M `session-directory.ts:~739` the predecessor-chain check returns success after 64 hops; an unfinished cycle
  check must refuse (`incomplete`), never establish legality (S1-SES-01).
- A4 M `session-lifecycle.ts:~944` an unreadable/missing/undecodable Run counts as "no queued stop"; propagate the
  read failure and keep R (S1-SES-06).
- A9 M `session-responsibility-service.ts:~851` terminal close does not check the source Session's workspace
  (`sameScope:true` is passed; the helper at `:~579` checks only the project); transfer reads Task facts before
  destination eligibility (`:~512`). Order per §3.4 S:614: both Sessions scope/lifecycle -> link open and pin ->
  Task proof -> writer stopped -> machine.
- N5 S `session-directory.ts:~778` an explicit `provenance: null` on a creation input is treated as absent; a present
  field is validated (K3), only absence gets the compatibility behaviour.
- N6 S `session-record-codecs.ts:~597` stored `executionPins` accept arbitrary refs, duplicates, unsorted lists and
  more than two; enforce complete Run/QueryRun refs, canonical order, no duplicates, at most 2, `[]` when neither
  execution nor wait exists (§2.3 S:238).

Tasks / queries — `src/core/work-graph/tasks/*`, `queries/query-execution.ts`, `model/claim-contracts.ts`:
- B2 M `session-provenance-facts.ts:~367` an absent body reader with a pinned manifest counts as "no evidence";
  an uninspectable pinned manifest is an explicit failure (`unavailable`), never `new`.
- B3 M the TaskRequeue read (`:~302`) and the manifest Run read (`:~372`) are not in the derivation guards; guard
  every record the proof used.
- B6 M `session-facts.ts:~271-284` legacy (null-provenance) Sessions of the workspace are not visible; use the
  workspace Session lookup the provenance reader already uses (`session-provenance-facts.ts:~205`); while candidates
  are unresolved set `legacyPending`; a successor scan over budget is `incomplete`, not `ready`.
- B8 S `session-facts.ts:~398` the supplementary `lastExecutionRef` Query can duplicate an earlier page or exceed
  `limit`; merge it by full ref across pages (encode its position in the opaque cursor), keep order and page size.
- C1 M `session-anomaly-service.ts:~534-540` retired proof ignores `legacyPending`; and only retired mode checks the
  current R. Every NEW anchor commit requires the matching current R; receipt replay stays allowed; an incomplete
  successor proof cannot prove "no continuation".
- N3 M `queries/query-execution.ts:~209,~865` a direct Query claim always passes `legacyProvenance:null`, so a
  legacy Session always fails the guard; with SessionFactsPort injected, obtain the trusted derivation and its guards
  through the model-level port (S:630), keep L1 behaviour without injection.
- N4 M `session-provenance-facts.ts:~518` predecessor verification treats failed/missing reads and an exhausted
  depth bound as "no cycle"; propagate failures; distinguish a completed acyclic chain from an unfinished one.
- E5-owner [lead: approved] add the smallest read on the requeue owner (`requeue-service.ts`, typed in
  `model/claim-contracts.ts`) that returns the existing TaskRequeue of (Task, afterRun) WITH its original commit
  cursor (via lookupCommit/eventAt of its TaskRequeued event), so the Workflow can report the original receipt.
- E2-owner `plan-readers.ts:~1737` reading the original terminal Plan failing must not fall back to the active Plan's
  time; propagate.

Workflow / composition — `src/business/workflow/*`, `src/app/*`, `src/composition/create-platform.ts`:
- E2 M `session-maintenance.ts:~172,~202` [lead: approved optional dependency `responsibilityBasis?:
  SessionResponsibilityBasisPort`, composition injects `createSessionResponsibilityBasisReader(backend.records)`]:
  close event `taskBasis.finishedAt` first; for an old close without it use the basis reader's `finishedAt`
  (satisfied -> reducedAt; cancelled/superseded -> acceptedAt of the first terminal PlanRevision, `setIn`); prove
  EVERY relevant terminal time, then take the max; any unprovable one -> not due, `incomplete` in `failures`.
- E3 M `session-archive.ts:~185` failed execution reads become `null` and can skip anchor/requeue and finish the
  archive; return `partial`, keep R.
- E5 M `session-archive.ts:~568` use the E5-owner read: reuse the existing (Task, afterRun) TaskRequeue and its
  original cursor as the step receipt; build a new requeue write only when none exists (L-d).
- E8 M lease: `create-platform.ts` wraps `archiveLine` / `continueArchiveLine` / `maintainSessions` with the same
  Host instance-lease admission the `resolveUnknownRun` wrapper uses (§3.4 S:620).
- E12 M `session-archive.ts:~473` archive recovery handles only `R.tasks`; close the terminal responsibilities during
  the archive too, including unselected ones (§4.1 step 6), so a terminal link never blocks the final.
- E13 M `session-maintenance.ts:~292-302` archive a copy only with all three facts on every path (answer saved,
  attached to the original message, input acceptance confirmed); without the mailbox reader: not archived, failure
  `unsupported`. (The fixture now passes the reader; IT11's given has all three facts.)
- E14 M [lead: approved optional dependency `legacyProvenance?: LegacySessionProvenancePort`, composition injects
  the same `tasks/session-provenance-facts.ts` reader the directory uses] maintenance derives and calls
  `backfillSessionProvenance` for provenance-null Sessions of the current page (same page budget, S:628), and never
  concludes "no continuation" for a retired line while legacy evidence is unresolved.
- E15 M `workflow.ts:~1030` ordinary continuation (C3 interruption, role mismatch) writes provenance but no
  responsibility transfer and no predecessor archive; `:~723` treats every archived predecessor as `new`. [lead:
  approved — the main Session may add the minimal new `WorkflowOperation` step kinds in `contracts.ts`/`workflow.ts`
  for "transfer responsibility" and "archive predecessor" (through the existing owners); keep archive-origin pickup
  `new` (T10) and the manual paused continuation's seed (decision 42 special case).] If this cannot be done safely
  within this round, leave the provenance half and report.
- E16 M `workflow.ts:~1001` the requeue path reuses the old requeue Session without destination-first ordering and
  without the archive exclusion; apply the same order as `chooseSession` (open responsible link of a transfer
  destination first) and never retry a source that has R.
- E17 M `workflow.ts:~1465` maintenance runs only for `select_work`, not `perform` continuations; `:~1452` and
  `startup-reconcile.ts:~343` drop maintenance failures; cover advance and continue, and expose failures in the
  result without blocking unrelated work. `collaboration-driver.ts:~141` keeps an unused `readRoutedReplies?`:
  remove it unless something in the write scope consumes it (K6).
- N1 M `session-archive.ts:~363` a failed `submitControl` (e.g. `revision_conflict` of a stale stop pin) is swallowed
  when the Run ended naturally; keep it as `ready/partial` with R and the original pin (D2), keep receipt replay.
- N2 M `session-maintenance.ts:~254` the terminal-close identity uses Session + taskId only; include goalId and the
  link occurrence (its `since`) so different Goals / reopened links do not collide.
- N7 S `src/contracts/continuation-brief.ts:~289` anomaly paths are not budgeted against the 16 KiB brief limit;
  budget them with omission counts; refuse `capacity` if mandatory content cannot fit (§2.7).

## 5. How to work

- Step 0 (main Session, small context): read this message and reference §1, §3, §4, §5; run `npm run typecheck`;
  add the approved optional dependencies (`now`, `responsibilityBasis`, `legacyProvenance`) to
  `WorkflowDependencies` and inject them in `create-platform.ts`; add the E5-owner read signature; tell the groups.
- Wave 1 (parallel, one subagent each, disjoint files):
  G-S sessions: R2 for `sessions/*-codecs.ts`, A1, A4, A9, N5, N6.
  G-T tasks/queries: R2 for `tasks/*-codecs.ts`, `queries/query-record-codecs.ts`, `persistence/*`; B2, B3, B6, B8,
  C1, N3, N4, E5-owner, E2-owner.
  G-C contracts/runtime: R2 for codecs under `src/contracts/`; N7.
  Each runs typecheck and the tests of its files by name (the S1 tests of its rows and the relevant files of
  section 3: A2-step1-codecs, C1-session-mailbox, invariants.test, R5b-query-execution, A1-session-lifecycle,
  R4b-session-directory, A2-requeue-service), and reports files changed and numbers.
- Wave 2 (after wave 1; one subagent per disjoint file set):
  G-W1 `session-archive.ts`: R3 (L-e), E3, E5, E12, N1.
  G-W2 `session-maintenance.ts`: R1 (use `deps.now`), E2, E13, E14, N2.
  G-W3 `workflow.ts`, `contracts.ts`, `collaboration-driver.ts`, `startup-reconcile.ts`, `create-platform.ts`
  (beyond step 0): R1 wiring, R3's `sessions/archive` route check, R4, E8, E15, E16, E17.
- Self-check: fresh read-only subagents compare each group's changes with the items of sections 3-4 and the cited
  spec rows; fix what they confirm.

## 6. Checks and expected results

Reference §7 commands (typecheck, check:architecture, build, the 23-file S1 command, the 22-file regression
command) plus:
```
npx vitest run tests/app/R6-host.test.ts tests/business/R5b-initial-planning-workflow.test.ts tests/composition/C1-M1-platform.test.ts tests/composition/R5c-workflow-platform.test.ts tests/composition/platform.test.ts tests/contracts/A2-rework-contract-helpers.test.ts tests/scenarios/A11-no-progress.test.ts tests/scenarios/A4-duplicate-receipts.test.ts tests/scenarios/A7-control-goal29.test.ts tests/scenarios/A7-control.test.ts tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart-lease.test.ts tests/scenarios/A8-host-restart-paused.test.ts tests/scenarios/A8-host-restart-rework.test.ts tests/scenarios/A8-host-restart.test.ts tests/scenarios/C3-reply-other-session.test.ts tests/scenarios/C6-unrelated-adoption.test.ts tests/scenarios/harness.test.ts tests/state/invariants.test.ts tests/work-graph/A2-step1-codecs.test.ts tests/work-graph/C1-session-mailbox.test.ts
```
Expected: typecheck/check:architecture/build 0; S1 command 211 passed / 1 failed (IT19, bwrap); regression 528/13
(bwrap); in the 21-file command, every failure names `/usr/bin/bwrap` (list each failing test with its first error
line). Final: `git status --short` exactly the 95 paths (62 src + 33 frozen), no stub, `sha256sum -c` of section 1
OK, `src/contracts/platform-duty.ts` sha256 6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39,
`./.dsh-scratch/` deleted.

## 7. Reply format

Four sections, nothing else:
- FILES CHANGED: each source file changed in this round.
- CHECKS: each command, exit code, `Test Files` / `Tests` lines, and every failing test with its first error line.
- UNSPECIFIED: each item of sections 3-4 not closed or closed partly (id, why, file:line); each case the spec does not
  decide; each frozen test you believe contradicts the spec (id, assertion, spec line, counter-example).
- NOTES: at most ten lines: item ids closed per group, subagents used, anything blocked.
