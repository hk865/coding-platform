All work complete, scratch deleted, subagents stopped. Final reply:

---

## FILES CHANGED

- `src/business/workflow/workflow.ts` — only file changed this round. Three edits:
  - **F1**: added module-local helper `responsibleLink(card, task)` (finds C's `responsible` link for `{kind:'task', ref:T}` **regardless of `until`**); `transferStepFor` now pins the successor's own ref/revision from it, revision-0 only when no link record exists. Predecessor link still uses `openResponsibleLink` (must be open).
  - **F2**: `performStep` case `create_session` now builds the claim with C's **current** revision (freshly read) when the request carries a `continuation` provenance and `deps.responsibilities` is installed and no handover step is due; unreadable C → `waiting` with the claim-after-handover wording.
  - **F3**: corrected the misleading comment in case `start` (prepare request id is unchanged; the following `start` id differs). Behaviour unchanged.

## CHECKS

- `npm run typecheck`: **exit 0**.
- `npm run check:architecture`: **exit 0** (`next source boundaries: OK`).
- New tests (8 files): **63 runs, 61 passed, 2 failed**.
  - `tests/scenarios/WP1-wiring.test.ts:45` SC01 — `AssertionError: expected 'waiting' to be 'completed'` (handover-kind assertion at line 41 passed, so create_session → transfer_responsibility → claim_task were performed correctly; the stop is downstream at the sandbox's missing registered check).
  - `tests/scenarios/WP1-wiring.test.ts:106` SC02 — same `expected 'waiting' to be 'completed'`.
  - Cause is the sandbox's absent `/usr/bin/bwrap` at `run_check`: an existing regression test (A7-control `G-04 and GOAL-29`) drives the identical `create_session → transfer_responsibility → claim_task → prepare → start → open_checks` sequence and shows `waiting, "ENOENT: no such file or directory, access '/usr/bin/bwrap'", "run_check"`. No other failure text.
- Regression (34 files): **49 failed / 296 passed (345)** — exactly the `DSH-BASELINE.md` numbers; 11 failed files / 23 passed. Per-file failed counts match baseline: A7-control 14, A8-host-restart-entry 7, A2-requeue-platform 5, A8-host-restart-paused 5, C6-unrelated-adoption 5, harness 4, A8-host-restart 3, A8-host-restart-lease 2, A8-host-restart-rework 2, A7-control-goal29 1, S1-archive-restart 1. All failures end `waiting` with the bwrap ENOENT or follow from it; no differing message observed. `tests/architecture/production-reach.test.ts` **passes** (4 tests).
- sha256 of the 12 frozen files: **unchanged** (after == before; `FROZEN_OK`). `workflow.ts` sha256 = `c0ff5e1d0ab4800174b0342ded9e357a93212e52383c684c69a1a11e54878bfa`.
- `git diff --stat` vs `before.txt`: the other 10 pre-existing changed paths are byte-identical; only `workflow.ts` changed (256 → 287 insertions). `git status` shows no unexpected new file.

## UNSPECIFIED

- **F1**: the new non-exported helper is named `responsibleLink`; `transferStepFor`'s doc comment was corrected in the same edit. (Spec §4.4 item 5/§0 L13; `workflow.ts:1324-1327`, `:1376-1388`.)
- **F2**: the fresh read uses `deps.sessions.readSession(...)`; the unreadable-C branch reuses `receiptReason(card, 'the handover successor Session is not readable')` and a `claimRevision` local. (Spec §7 rule 2 / §0 L10, W1-HO-01; `workflow.ts:1545-1556`.)
- **F3**: none — pure comment correction. (Spec §0 L4; `workflow.ts:1581-1593`.)
- Also noted by the independent review, left unchanged because they are pre-existing and outside the three items (rule 1/2): a redundant double card read (`buildHandoverStep:1404` then `transferStepFor:1374`, pin uses the later read — no correctness effect), and `predecessorStillOpen` treating an unreadable P as still open (`:1481-1483`).

## NOTES

- **F1** — `responsibleLink` helper `workflow.ts:1324-1327`; successor pin in `transferStepFor` `workflow.ts:1376-1388` (predecessor open check at `:1376`).
- **F2** — `performStep` case `create_session` `workflow.ts:1545-1556` (claim revision now `claimRevision`, read after the handover decision).
- **F3** — `performStep` case `start` comment `workflow.ts:1581-1593`.
- **Subagents run** (both finished; none still running): 1 implementation subagent (role: make the three edits and run typecheck + the 7 business/regression files — reported 7 files / 65 tests passed) and 1 fresh independent review subagent (role: per-item done/not done/done-differently verdicts + rule-2 behaviour audit — reported **F1 DONE, F2 DONE, F3 DONE**, all rule-2 check points unchanged, no blocking defect). No fixes were required after review; section 6 was therefore run once.
- `./.dsh-scratch/` was created and deleted at the end. No git write commands, no install, no network, no real model; `vendor/` and the allowlist untouched.