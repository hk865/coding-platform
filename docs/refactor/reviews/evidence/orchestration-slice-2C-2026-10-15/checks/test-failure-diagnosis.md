# 2C merge: failing tests, diagnosis by an investigation agent (2026-10-15 night)

> Lead note (2026-10-16): this is the brief the lead gave Codex for its read-only check (`../codex/s2c-debug.*`). The
> diffs and run logs it names lived next to it in the review copy and are not kept in the repository; the merged test
> files are the result. Outcome: A8-3n took option X; (3) was rebuilt once more after Codex's check (Y's link reopened
> through `sessions/link`, then one archive), and (4) gained the `doneEvidence`/`attention` assertions. See
> `../lead-acceptance.md`.

Merged tree = this copy's index (HEAD 7ad00938 + slice 2C round 6b + lead union merges). Full suite with bwrap:
two files failed: `tests/scenarios/A8-host-restart-paused.test.ts` (case A8-3n, "closing unsupported") and
`tests/scenarios/S2C-K-archive-tags-checks.test.ts` (checks (3), (3'), (4), (5)). Logs of the agent's runs: `logs/`.

## 1. A8-3n

S1 is archived at the crash restart by the start-up reconcile's step-6c maintenance (`src/app/startup-reconcile.ts:341-343`,
`turnClosureCaller` null), before the idle Session is created and before the re-drive. Evidence (temporary logs, since
removed): the archive decision fired with mode `retired`, `kernel_turn_open`, and an open link to `ag2b-work`; after the
restart `s1.lifecycle` was `archived`; the link was `since c27, until c42` (opened by Run1's claim in the reused s1 — 2C
round-6 item 10 — and closed by the drop); the anchor reads `retired_archive`, run1, `changedFiles.confirmed
['src/a8-3n-step.txt']`, `pickedUpBy` = Run2. With `openResponsibleLink` turned off in `workflow.ts:862` the case passes
(s1 stays active, the L8 fallback runs, and later maintenance archives s1 as `handoff_complete`).

Path in `session-maintenance.ts`: `:616` closure answers `unsupported` (definite failure, falls through) → the `:624-627`
`kernel_turn_open` exemption fails (open link and `platformCleanInterruption` true) → `:636` archives as `retired` with a
drop. Later `claimRequeued` sees s1 archived and calls `chooseSession(null)`, which picks the idle Session.

Before item 10 this fallback only worked because s1 was a *reused* Session. A Session the Workflow creates gets
`initialLinks`, so it already took this archive path.

- Option X (keep the code, change the test): `optX.diff` / `optX-in-copy.diff` (applied in this copy). Only line 478
  failed on the merged code; line 445 gains `lifecycle: 'archived'`; added assertions for the `retired_archive` anchor in
  the brief and `anomalies/list` (`pickedUpBy: run2.ref`). The file passes 8/8 (`logs/out-a8n-X.txt`).
- Option Y (change maintenance: skip archiving a retired `kernel_turn_open` line whose closure was really attempted and
  failed definitely, `wait === null`, and which still holds the open `responsible` link to its interrupted Run's Task):
  `optY.diff` (NOT applied in this copy). Batches with Y: 10/10 files (76 tests), 13/13 (48), 16/16 (119) passed.

## 2. Checks file (test changes only; 5/5 pass, `checks-in-copy.diff`)

- (3): race. Refusal `revision_conflict` (current revision 6) because the background advance was still ending X's Run.
  Fix: keep the advance promise, `held.fail`, await it, then read X's card.
- (3'): with the race fixed it reads `doneEvidence: 'complete'`, not `'incomplete'`. Every `select_work` runs a
  maintenance page first (`workflow.ts:2046-2047`) → `closeTerminalResponsibilities` (`session-maintenance.ts:590`), so
  each satisfied Task's link closes at the next claim; X's `archiveStep` close is the newest of the 22, and the truth table
  checks DE3 first → `complete` / `archived` is correct. The spec construction ("归档组合先处置 X、再关那 21 条") cannot be
  built through the real Workflow. Rebuilt: drop X by archive, finish it with `runMaintenance`, reactivate, run 21 other
  Tasks on S with `sessionHint`, two maintenance passes archive S again → plain / standby / incomplete / `done_unproven`.
- (4): the goal-level `h.advance(select('s2c05c4-drop-archive-advance'), maxSteps 16)` re-dispatches the dropped Task
  (decision 43) to another Session N while S is archived and completes it there; `completeTask('ag2b-work')` returns N's
  Run, `runMaintenance` (direct root, clock 8 days later) archives N as `executor_idle`, so the explicit archive is refused
  (`session-availability.ts:961`). Also, completing the same Task on S re-opens the same deterministic link record
  (`claim-service.ts:948`), whose `terminal` close replaces the drop close (DE2). Fix: two Tasks; complete `ag2b-work-2` on
  S with `sessionHint`; two maintenance passes → plain / standby / complete (DE3) + `attention: anomaly_pending` (AT4).
- (5): HM02 only covers `continuation` successors (`session-facts.ts:297` skips `handoff`). At the crash restart the Host
  closure is refused `handed_over` (`runtime.ts:290` counts handoff successors) so maintenance skips P; `runMaintenance` on
  the direct root has no closure, the exemption fails, P is archived as retired. A crashed P is unavailable, so A1 always
  gives `retired` (`line-status.ts:466-467`); `handed_to` (A3) is unreachable with a crash. Fix: a real handoff with P
  healthy (`held.fail`, await; `sessions/create` with handoff provenance; `sessions/archive-line` with `transfer`) →
  plain / standby / `handed_to`, `doneEvidence` complete (DE3).

## 3. Other problems the agent noticed

- (a) Possible product problem (`session-maintenance.ts:466-472` with `runtime.ts:290`): a retired `kernel_turn_open` line
  whose successor is a handoff gets `refused('handed_over')` from the Host every round; maintenance treats that as skip,
  so the line is never archived and its Turn never closed. Only the closure-less direct root archives it.
- (b) Test helper gap (`tests/helpers/S2C-K-scenario-support.ts:154`): `runMaintenance` runs on the direct root with no
  Runtime closure, so S2C-K cases with retired lines exercise the M1 ("no closure installed") path.
- (c) Spec gap (`claim-service.ts:948`): one link record per (Session, target, relation); re-opening the same Task on a
  line overwrites the earlier interval, so an older `archiveStep` close is no longer read by L1a.
