All work is done and verified. Final reply:

## FILES CHANGED

**Production — 5 new files, 1,557 lines:** `agent-runtime/unknown-call-draft.ts` 193; `work-graph/model/tool-commit-arguments.ts` 154; `work-graph/tasks/unknown-call-review-codecs.ts` 741; `work-graph/tasks/unknown-call-review-service.ts` 137; `workspace/workspace-change-capture.ts` 332. **Modified src: 23 files, +883/−73 → ≈2,440 new production lines** (over the 2,000 soft budget; the codec, capture traversal and UCR service are large).

**Tests (new):** `K3-34-tool-name-constants`, `K3-35-workspace-baseline-prepare`, `K3-40-workspace-change-capture`, `K3-26-unknown-call-review-storage` (incl. K3-47(一), K3-26(九)), `K3-39-tool-commit-lookup`, `helpers/K3-tool-seams.ts`; plus the 5 K3-21 cases inside `A2-reconcile-runtime`, K3-38/K3-36 in `k3-review-claim`, K3-34 lease proofs in `A2-host-instance-lease`, B's `S5R2-agent-application` K3-39 case.

**Seams:** only the switchable stand-in `shell` helper (`vi.hoisted`-style state + the `vi.mock` snippet documented in its header) exists; it is not self-tested or integrated. Store wrapper, git-workspace option, long ids, person-stopped Run and crash points are **not built**.

## PER ROW
- **K3-34** done — table/order/constants comparison (`BUILTIN`/`RESERVED`/`EXPLORATION` + collaboration names, `write→edit`) plus the three lease proofs and `null`.
- **K3-38 ordinary claim** (item 3) done in R5 — optional `reviewPending` fact + `busy/unknown_call_review_pending` for `first`/`requeue`; owner fill is group 4. **TASK-03 `leaseRelease`** done — `requeueClaimProblem` now calls `leaseReleasedForContinuation`; owner fills `afterRunRef`/`leaseRelease`. RED→GREEN.
- **K3-40** done at the capture public seam (A): (i)–(v) literal labels; **K3-35(四)** done (prepare succeeds, `unavailable/too_many_changes`). R1 halves not done.
- **K3-21** *partial* — 5 runtime-entry guards green: `no_takeover_proof`, `uncontained_tool`, `closure_unsupported`, `no_baseline`, `workspace_not_git`. Missing: `stop_pending`/`session_not_closable` (WorkGraph side), `inputs_unconfirmed`, `second_auto_cleanup`, `workspace_unstable`/`workspace_too_many_changes`, `inventory_incomplete` (33 calls / undecodable), `review_round`.
- **K3-22/23/24** not done.
- **K3-47(一)** done — same RUN-25 request replays (`replayed: true`), moved pin `revision_conflict`.
- **K3-26(七)(八)(九)** done — too_many_calls/undecodable/wrong-kind drafts through the owner; 513-byte callId `invalid`, 512 listed; RUN-25/RUN-22 records read through `unknown-call-reviews/read`. **K3-39** done (three owners + not-published; memory & SQLite).
- **K3-48(一)** not done (creation-budget truncation at RUN-25 not asserted).
- **K3-01..04** not done (item 5, as permitted).

## §5.3 CHANGES
`A2-reconcile-runtime` "W-13 then W-15" (autoCleanup `no_takeover_proof`); `A8-host-restart-attestation` RUN-22 (three frozen drafts; owner backend registers review schemas locally); `A8-host-restart` A8-3f (`kernel_unreadable`) and A8-3g (`kernel_unreadable_at_stop`); `A8-host-restart-entry` A8-2b both (`kernel_unreadable_at_stop` / `kernel_unreadable`); `S1-archive-flow` IT26 (draft + schema); WP1/WP2 fixtures (drafts); `S2B-be2` 2B-14(c) (draft via `readReviewDraftAtEntry`); `platform.test.ts:56` key. Also `execution-entry-codecs` now accepts `autoCleanupBlockedBy` and `takeover_unresolved` (group-1 contract change had no codec).

## CHECKS
Final batch `tests/state tests/runtime tests/scenarios/A8-* tests/app/A2-host-instance-lease tests/business/S1-archive-flow tests/composition/platform tests/architecture` + new files, `--maxWorkers=3`: **4,320 passed, 13 failed, 29 skipped** — all 13 are DSH-BASELINE (2 invariants + 11 A8 sandbox). `npx tsc --noEmit` clean; `npm run check:architecture` OK; `npm run build` OK. Targeted: K3-26 file 17/17, K3-39 7/7, A2-reconcile-runtime 15/15, lease 10/10, S1 7/7, platform 2/2, production-reach 4/4.

## UNSPECIFIED
1. **Real-Host RUN-25 is blocked:** `create-platform.ts`'s classifier deps still lack `turnClosureSupport`/`captureWorkspace`/`lookupToolCommit` (→ `closure_unsupported`); owner-level RUN-25 works. The `lookupToolCommit` dispatch and capture wiring are the remaining item-4 gap.
2. L23 streak written `false/false/null`; the prior-RUN-25 chain read is not implemented.
3. No `UnknownCallReviewChanged` event on `created` (the commit already carries `ExecutionRunReconciled`).
4. `tests/state/invariants.ts` untouched per the ruling; I registered the review schemas locally in A8/S1 instead. The A8-3f/3g/2b assertions live in baseline-red tests, so they are unverified here.
5. `turnClosureSupport` returns `{status:'supported'; headActiveRunId}` (spec §2 omitted the head; G6/candidate need it).

**Surprise:** group-1 changed the contract but not the RunSnapshot codec (`autoCleanupBlockedBy` was rejected at runtime) and `create_review_record` had no consumer — both had to be wired before RUN-25 could commit at all.