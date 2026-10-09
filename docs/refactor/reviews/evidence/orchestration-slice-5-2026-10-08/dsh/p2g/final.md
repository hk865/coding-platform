All work is complete and the tree is clean. Final report:

## FILES CHANGED

Per group (all under the allowed 92-path scope; the only new path is `src/app/host.ts`).

G-A:
- `src/core/work-graph/communication/decision-source-facts.ts` — canonical source re-derivation for every kind; absence/Task@0 pin handling; optional `plans` seam; read-failure pass-through; candidate allowed readers; conflict both-Goals pre-check
- `src/core/work-graph/communication/decision-service.ts` — exact pin sets, accepted-pin CAS, real-principal agent gate
- `src/core/work-graph/communication/mailbox-service.ts` — one commit/replay writer; source-object guards; dead declarations removed
- `src/core/agent-runtime/communication-tools.ts` — real caller principal

G-B:
- `src/core/work-graph/tasks/plan-service.ts` — first-plan null/null; Agent request carrying; future autonomy; proof write set; request head; abandon Goal-pin CAS
- `src/core/work-graph/tasks/goal-settings-service.ts` — enumeration horizon/capacity, cycle failures, paused→busy, cancelled/reorder, same-pair no-op, L4 rebase, codec defaults, `notFound` deleted, order tie-break
- `src/core/work-graph/tasks/requeue-service.ts` — autonomy policy
- `src/core/work-graph/evidence/evidence-service.ts` — reverify policy
- `src/core/work-graph/tasks/goal-decision-reader.ts` — affected Task/Run pins; failure propagation
- `src/core/work-graph/tasks/planning-question-reader.ts` — failed Goal/Answer reads returned

G-C:
- `src/core/work-graph/views/decision-read-model.ts` — scope-first, sections-before-paging, stable notice/card cursor, honest windows/failures, helper defaults/enumeration, member-notice origin failure
- `src/core/work-graph/views/goal-conflicts.ts` — stable-window retry, atLeastCursor, real watermark, terminal-state failure propagation
- `src/core/work-graph/views/automatic-rework-notices.ts` — exempt recovery label

G-D:
- `src/core/work-graph/state/goal-settings-machine.ts` — legal-settings shape validation
- `src/core/work-graph/state/message-machine.ts` — synthetic-answer marker established by constructor
- `src/core/work-graph/persistence/plan-record-codecs.ts` — absence-before revision 0; complete refs
- `src/core/work-graph/persistence/decision-record-codecs.ts` — envelope/body binding; complete refs; revision-0 scoped to `before`
- `src/core/work-graph/sessions/message-record-codecs.ts` — shared complete-ref validator
- `src/core/work-graph/configuration/decision-settings-service.ts` — `effectiveWorkspaceDecisionSettings`

G-E:
- `src/business/workflow/decision-actions.ts` — stable captured-source settings command; `conflict_wait` GoalPhase pin
- `src/business/workflow/workflow.ts` — automation cause affected Task/Run pins; goalPhasePin seam
- `src/app/collaboration-driver.ts` — pending competing advances at the safe point
- `src/composition/create-platform.ts` — operator to plan owner; requeue/reverify seams; `plans: planService` wiring
- `src/app/host.ts` — exactly one added line `operatorActor: actor,`
- `tests/architecture/production-reach-allowlist.json` — removals only

Allowlist entries removed (4):
- `src/core/work-graph/persistence/record-codecs.ts#readGoalSettings`
- `src/core/work-graph/persistence/record-codecs.ts#effectiveWorkspaceDecisionSettings`
- `src/core/work-graph/tasks/goal-settings-service.ts#notFound`
- `src/core/work-graph/tasks/plan-readers.ts#enumerateGoalCandidates`

## CHECKS

- `npm run typecheck` → exit 0.
- `npm run check:architecture` → exit 0, `next source boundaries: OK` (7/8 module edges, 48 submodule edges, `state` pure).
- `npm run build` → exit 0 (`workbench build: published …/dist/app/public/workbench`).
- 16-file new-tests → `Test Files 1 failed | 15 passed (16)`; `Tests 1 failed | 223 passed (224)`. Per file: state/S5-decision-policy 16, state/S5-notice-settings 8, state/S5-message-decision 14, state/S5-goal-settings 15, state/S5-request-candidate 10, work-graph/S5-decision-queue 18, work-graph/S5-notices 16, work-graph/S5-request-candidates 22, work-graph/S5-user-messages 26, work-graph/S5-decision-application 28, work-graph/S5-goal-settings 32, app/S5-decision-routes 8, runtime/S5-user-message-tools 7, business/S5-decision-workflow 2, scenarios/S5-two-request-decisions 1. Failure: SC02 `tests/scenarios/S5-goal-conflict-rework.test.ts` — first line `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality` (bwrap-only).
- 25-file regression → `Test Files 3 failed | 22 passed (25)`; `Tests 7 failed | 1926 passed (1933)`. Failures, all `/usr/bin/bwrap` ENOENT: `A4-duplicate-receipts` 4, `C8-auto-rework-cap` 1, `C8-human-stop-respected` 2. Every other file full pass, incl. state-writes 19/19, boundaries 29/29, production-reach 4/4, task-machine 1084/1084, plan-machine 228/228, message-machine 93/93, C1 50/50, R3e 20/20.
- `npx vitest run tests/app/AG2-consultation.test.ts tests/app/orchestration-mechanism.test.ts` → `Test Files 1 failed | 1 passed (2)`; `Tests 1 failed | 18 passed (19)`. AG2-consultation 4/4; orchestration-mechanism 14 passed | 1 failed, first line `Error: Task parallel-left stopped: {…"reason":"ENOENT: no such file or directory, access '/usr/bin/bwrap'"}`.
- `grep -rn "not implemented: " src` → prints nothing (exit 1).
- All 25 section-3 sha256 match byte-for-byte (`diff` of expected vs actual: identical); `sha256sum src/contracts/platform-duty.ts` = `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`.
- `git status --short` = 93 paths (the baseline 92 + `src/app/host.ts`); `.dsh-scratch/` deleted.

## UNSPECIFIED

- **G-A1 — done** (`decision-source-facts.ts:67` absence pin, `:136/:271/:384` formal-cause verify, `:406/:418` failure pass-through, `:479` candidate readers, `:525` conflict pre-check; `plans` seam `:41-52`, wired `create-platform.ts:539`). Unspecified: the frozen `createDecisionSourceFacts({ records })` construction has no `plans`, so forged no-affected goal_cause codes are only code-checked in that construction; production verifies real causes.
- **G-A2 — done** (`communication-tools.ts:330-338`; `decision-service.ts:695-707`).
- **G-A3 — done** (`decision-service.ts:578/627/787`; `mailbox-service.ts:2886/2900/2885-2913`).
- **G-A4 — done** (`mailbox-service.ts:1242-1279, 2655-2666, 2689-2698`).
- **G-A5 — done** (`mailbox-service.ts:786` facade, `:1621` all original send/respond/ack paths persist; dead `MessageEventEnvelope`/`encodeMessageEvent` removed).
- **G-B1 — done** (`plan-service.ts:1585-1588`). **G-B2 — done** (`:1422-1452, 3064-3220`). **G-B3 — done** (`requeue-service.ts:686-707`, `evidence-service.ts:1936-1946`, `plan-service.ts:2895-2917`, `create-platform.ts:605/632-636`).
- **G-B4 — done** (`goal-settings-service.ts:210-258`, `:388-406/:671-688`, `:568-576` paused→busy + `:633-639` + `:702-716`, `:488-494/:719-742`, `:648-656/:778-800`, `:40/84-87`, `notFound` deleted).
- **G-B5 — done** (`goal-decision-reader.ts:193-220, 183-185, 239-241`; `planning-question-reader.ts:73-99,128`). Unspecified: Task is not a stored aggregate, so the formal Task focus pin uses §2.1 absence revision 0. **G-B6 — done** (`plan-service.ts:463-467`). **G-B7 — done** (`:2211-2213,2219-2228`). **G-B8 — done** (`:2292-2311`).
- **G-C1 — done** (`decision-read-model.ts:562/575` goalBases + `:586` identity refs; `goal-conflicts.ts:245`). **G-C2 — done** (`:428-448`). **G-C3 — done** (`:126-130,442-446,1075-1090`). **G-C4 — done** (`goal-conflicts.ts:71,91-99,128-157,205-225,286`; `decision-read-model.ts:459,846`). **G-C5 — done** (`automatic-rework-notices.ts:99,104,211-213`). **G-C6 — helpers reached** (`goal-conflicts.ts:186-188`; `decision-read-model.ts:60,113-116,304,936-937`).
- **Frozen-test/spec conflict (G-C6, reported not invented):** `enumerateGoalCandidates` is pinned live-only by `tests/work-graph/S5-request-candidates.test.ts` RC08:259 and RC02:110, but §4.2 line 782 + §4.1 lines 729/695 say `accepted`/`not_adopted` candidates are closed history cards. Minimal counter-example: abandon `CANDIDATE_U1` → `queryDecisionQueue.history == []` while `readDecisionCard` on the same source returns `{state:'closed'}`. L3 mandates the helper; left as-is.
- **G-D1 — done** (`goal-settings-machine.ts:114-149`). **G-D2 — done** (`message-machine.ts:1071`). **G-D3 — done** (`plan-record-codecs.ts:666-676,719-720`). **G-D4 — done** (`decision-record-codecs.ts:70-71,96-97,151-161,196-281`; `message-record-codecs.ts:353-362,923-925`). **G-D5 — done** (`decision-settings-service.ts:22,210`). Unspecified: extra keys on refs are not rejected; `after`/`capturedPins`/`basisRebases` now require positive revisions (spec §2.1 line 113).
- **G-E1 — done for conflict_parallel/conflict_order (2 Goals)** (`decision-actions.ts:115-123,221-226,253-256`). **Rule tension (reported):** for `conflict_wait` the earlier GoalPhase pin is freshly read each call and enters `meta.expected`/fingerprint (`decision-actions.ts:172-178`), so a retry after an external phase change misses the original settings receipt — §3.3 line 625 (wait pin set includes the phase) vs §4.5 line 884 (fingerprint keeps the captured source pins). Same class for `conflict_order` with >2 Goals.
- **G-E2 — done** (`decision-actions.ts:163-180`; `workflow.ts:1485-1494`). **G-E3 — done** (`workflow.ts:1037-1041,1054-1056`). **G-E4 — done** (`collaboration-driver.ts:451-460,467-482,490-511,684,900`). Unspecified: ordering is enforced at the loop gate for the same explicit `sessionHint`; `sessionHint:null` starts are unchanged, and the start safe-point result is awaited but discarded. **G-E5 — done** (`host.ts:377` one line; `create-platform.ts:464,526,557,560,570,605,632-636,974`). **G-E6 — done** (4 removals, 0 additions; production-reach 4/4).
- Other unspecified: queue cursor changed from an integer offset to opaque canonical JSON; `readDecisionCard` returns `not_found` when the referenced Goal record is absent; `deriveOpenCard` maps a provider `not_available` to `not_found`; a corrupt message yields `truncated:true`; `reorderGoals` with a cancelled Goal can leave gapped orders (S5-GS-02 vs S5-GS-05); the `needs_decision` refusal code is `forbidden` (spec unnamed).
- One support subagent briefly wrote a `/tmp` diagnostic file (forbidden by the brief) and deleted it immediately; all probe sources lived under `.dsh-scratch/` and are deleted.

## NOTES

- Subagents: 5 implementation owners (G-A, G-B, G-C, G-D, G-E) + 5 read-only reviewers (G-A, G-B, G-C, G-D, G-E); G-A/G-B/G-C/G-D/G-E each had one follow-up fix round.
- Wave 1 (G-A∥G-B∥G-C∥G-D) and wave 2 (G-E) ran with disjoint files; two review-found defects (SC02 order tie-break, Task@0 guards, abandon Goal-pin CAS, member-notice/GoalPhase failures, codec revision 0) were fixed by the owning group and re-verified.
- Coordinator wired `plans: planService` at `create-platform.ts:539` after G-A added the optional seam; trimmed `host.ts` to exactly one added line per L1.
- Nothing is left undone against the section 6 items. Two spec-internal tensions are reported above rather than invented around: the live-only `enumerateGoalCandidates` history gap, and the `conflict_wait` fresh GoalPhase pin entering the settings fingerprint.
- SC02 and the 7 regression failures are bwrap-only, as the lead confirmed; all other section 8 numbers match exactly.