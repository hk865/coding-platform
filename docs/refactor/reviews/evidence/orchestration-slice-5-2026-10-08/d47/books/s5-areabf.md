# Task: orchestration slice 5 — area B, follow-up round: automation causes, Agent application proof, retries

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have
not seen this copy before. Everything you need is in this message and in files of this copy. The corrections
below are decided; do not make design decisions. Where the spec and this message do not determine something, do
not invent behaviour: list it under UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends and every subagent that is still running is
killed** (earlier runs lost all their work that way: they started subagents and ended the turn). After starting
subagents, stay in your turn until every one of them has finished and reported: wait with a blocking shell command
(for example `sleep 540`) and check with `list_agents`, again and again; no notification wakes you after your turn
ends. End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents.** You are the coordinator: keep your own context small. Do not read the spec, the code of
the groups or the test files yourself. Give each group of section 6 to its own subagent with: sections 1–5 of this
message verbatim, its own group block verbatim, and the instruction to read the named spec lines first, then the
code at the given lines, then fix, then run `npm run typecheck` and its own test files only, and to reply with
FILES, what it changed per item (item id → file:line), the test numbers of its files and UNSPECIFIED items. Groups
in one wave run in parallel and write disjoint files. A subagent never edits a file of another group; if it needs
a change there, it stops and tells you; you decide and tell the owning group.

## 1. What this copy is and what is already done

- Base: commit 216e0e2b of the branch (orchestration slices 0, 1 and 3 merged; `git log`: one commit, tags
  `slice-setup` and `slice-base`). Uncommitted on top: slice 5 complete (types, owners, readers, routes, 16 new
  test files and their support files). Slice 5 was built on an older base (48c8d473) and the lead moved it onto
  this base with a three-way merge (both sides kept), then fixed the merge defects and five small review items
  (N1 notice cursor, N4 Agent replacement check, #12 paused earlier Goal, #21 proof without decision source, #22
  SessionWorkLink pin shape) and two slice-5 regressions of existing tests (public platform keys, the A11 cap).
- A first correction round of this area was already made in this copy by another session (section 6 says what it did); this is the one follow-up round.
- The lead re-measured this state: `npm run typecheck`, `npm run check:architecture`, `npm run build` exit 0; the
  whole suite passes in the lead's environment with `/usr/bin/bwrap` (266 test files / 5,850 tests, all pass; the 16 new slice-5 files have 224 tests). In this sandbox
  `/usr/bin/bwrap` is missing, so the tests listed in section 8 as "bwrap" fail here with `waiting` /
  `ENOENT … /usr/bin/bwrap`; that is expected — never instrument a harness to prove it.
- An independent review (a second model; the lead checked every item below at the cited lines) found production
  defects the frozen tests do not catch. This round fixes the ones of ONE area (section 6). Other areas are fixed
  in other copies at the same time; their files are outside your write scope. **All tests that pass today must
  still pass afterwards.**

## 2. Where the rules are (all inside this copy)

- The frozen spec: `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md` (Chinese prose, English
  identifiers). §0 (lines 5–63) overrides the rest. By line: §2.2 Goal/Workspace settings 117, §2.3 message
  extension 160, §2.4 request candidates/unique slot 247, §2.5 indexes/notice origin/cursor 276, §2.6 seams 297,
  §2.7 protected fields 339, §2.8 helper types, pause basis, event proof 345; §3.1 state rows (table from 487:
  S5-GS-01…06 at 496–501, S5-AU-01…04 at 502–505, S5-MSG at 506–511, S5-PLAN-01…05 at 512–516, S5-NT 517);
  §3.2 autonomy/duties/operator 522–557; §3.3 owner check order 611–619, proof 621–623, **pin sets 625**, receipt
  templates 627, **source keys 629**; §4.1 read types and limits 690–775 (limits line 772); §4.2 seven sources
  776–822; §4.3 conflicts 823; §4.4 rework notices 835; §4.5 routes and `resolveDecision` 844–892 (settings
  command pins line 884, `orderGoalAdvances` 890); §4.6 user tools 894–919; §8.2 error-prone rules 1350–1370.
- `docs/refactor/design/orchestration-2026-10/slices/slice-5-book-part1.md`: "Rules" 1–16 still hold;
  `slice-5-book-part2.md`: rules 17–20.
- Slice 1 (already merged in the base) is described in `slice-1-SPEC.md`; its decode defaults (§2.9 default table,
  line 450: a decoded Message has `replyHandler`/`archiveWaitDisposition` = `null` when absent) hold.

## 3. Frozen test files (never change them, not even temporarily)

Do not edit any file under `tests/` (also not `tests/scenarios/harness.ts`, not
`tests/architecture/production-reach-allowlist.json`) — not even to debug and revert. To probe something, write a
throw-away script or test under `./.dsh-scratch/` and delete it at the end. Never use `/tmp`. At the end
`sha256sum <file>` must print exactly:

```
50a7d9771d036114231c2dfbeded9f2e23f40d40c5acc3f3183e7bc5a3eebc7f  tests/app/S5-decision-routes.test.ts
2f1b2a42357c5ae511cd02a21a984463dbb9d7176def8cf62cade3237bc5b395  tests/app/orchestration-mechanism.test.ts
d0e742048f28e5b15763e62803c57a77154d11909bfb86579d05a18eb886624a  tests/architecture/state-writes.test.ts
52466fedd9ee781b679f92fcbe42dcf3b9aa047779a8ee50479e91b0c83ff685  tests/business/S5-decision-workflow.test.ts
72189afd038a69727d0a72899f7960887db54b0126dce1a4a4994d0c70ce00b8  tests/helpers/S5-application-support.ts
46f16a5647bfa31fb8168aed7e1d122c0e0450a515e6fdfbd5965f05298be317  tests/helpers/S5-decision-fixture.ts
d031e187aaff209482b47a9563dc499ea3ff4f18cf6fdf506f5b89de725de47e  tests/helpers/S5-goal-settings-support.ts
a993335d1a259f6449493b44ddf0214714bfe06b799dfc2b3ff220052578cc25  tests/helpers/S5-queue-support.ts
a02181dc16b0ed05faae5bb68c0404608a5cab08d650ae38ede260ec73b603fb  tests/helpers/S5-user-message-support.ts
f88c8c15ade52761fb8891dfd5d7bbfdfb8fc24b8f599e1e2668f2d9989e41e0  tests/runtime/S5-user-message-tools.test.ts
d45a1f1c57db719bb49c101aca8d7548ae35ab1b715712b7b5c833ab262b8316  tests/scenarios/S5-goal-conflict-rework.test.ts
fc04d8051652df802335e947bf9fd452f694d553433dc3b30db9cbff6171e012  tests/scenarios/S5-two-request-decisions.test.ts
e4a8b44af8713fd4531bff2fd88950335997303fd1efd763a486ba89e29525c1  tests/scenarios/support/S5-decisions.ts
55c96955ab7bb0b4df1158ea32c1a6db95098172574bfae048126eb89e36c787  tests/state/S5-decision-policy.test.ts
b00d90eaa9966a75fcd5b1b97163a5c484a2d3b3c432ff9069c439082c6771f2  tests/state/S5-goal-settings.test.ts
9cc0e4c04534db6cf5ce7e8908da334ea93a5ef39de37fc67d3dd9e88f254e84  tests/state/S5-message-decision.test.ts
a188f229e6ab9946f23e0c12b2a116538d174f223a0441d636feb1e33c07a949  tests/state/S5-notice-settings.test.ts
107252e843869a95d329d518b9557f9a3c820c6a4524fe5cf50da4e101cf8d29  tests/state/S5-request-candidate.test.ts
b9ff065bf4201582425b15fd072bcfeafc449490c5250fb612b6625e4aa6673d  tests/state/message-machine.test.ts
3540f6e0a3e38a9b53926bdd0836fedece02b0e8f7b40827dcfa922956190845  tests/work-graph/S5-decision-application.test.ts
16c22b81819c501c049915b35aa9f8845afebc947316931d46c091b064fd8f89  tests/work-graph/S5-decision-queue.test.ts
455cac59cea61d5a0a4fc32b6a09355d9fdeb363cfbf99000f959679616635b2  tests/work-graph/S5-goal-settings.test.ts
ac177ad2698b0ad7eacf9ac65bb5b6cae9286de9f569e17fcb17ab5a40c17fa2  tests/work-graph/S5-notices.test.ts
360e3e27bfa7969db5782fca73ff6c9d32b4afe3f05287c5d424148305726dfd  tests/work-graph/S5-request-candidates.test.ts
61c3c0169532b5b1d92ea931b699d3bfe0630b991751976917d081c998613516  tests/work-graph/S5-user-messages.test.ts
```

If a correction below seems to contradict a frozen test, keep the test passing and report the test id, the
assertion, the spec line and a minimal counter-example under UNSPECIFIED (rule 17).

## 4. Lead decisions for this round (binding)

- **L-scope.** You may change only the files named in your area's write scope (section 6). No new files unless
  the area says so. No change under `tests/`. `git status --short` at the end: exactly today's paths
  (93; the same list).
- **L-tests.** No test edits and no new tests in this round. Each group's self-check is a review subagent
  (section 7) plus the checks of section 8.
- **L-reach.** `tests/architecture/production-reach.test.ts` must still pass: a new exported declaration must be
  reached from production code; the allowlist cannot be edited.
- **L-interfaces.** Exported signatures used by another area stay as they are (other areas are being fixed in
  parallel against today's signatures). You may add new exports inside your own files.
- **L-B.** The `{ records }`-only construction of `createDecisionSourceFacts` (used only by frozen tests) keeps its named-code check; production injects `plans` (`src/composition/create-platform.ts:644`). LB-1 and LB-2 (section 6, F1 and F3) are lead decisions too.

## 5. Rules for every group

Rules 1–20 of the two books hold. In particular: state transitions and protected fields only through
`src/core/work-graph/state/` constructors; replay of an original receipt comes before any new business read;
`forbidden` for another Workspace is decided before reading foreign objects, same-Workspace missing objects are
`not_found`; read failures are returned (`unavailable`/`incomplete`), never turned into empty or `not_found`
results; module edges only as `docs/refactor/module-target.json` (`tasks/`/`evidence/` never import
`communication/`/`views/`; `configuration/` never imports `views/` or a source owner; `state/` imports only
`src/contracts/` and itself). Keep every existing (pre-slice) path's behaviour and public shapes unchanged.

## 6. Area B, follow-up round — what the first round left

A first correction round of area B was already made in THIS copy by another session (uncommitted, inside today's
93 paths): a shared automation-cause derivation (`state/decision-policy.ts` `automationConfirmationCause`, used by
`business/workflow/workflow.ts` `automationConfirmation` and `tasks/goal-decision-reader.ts` `automationCauses`),
the failure-Run pin in recurring cause keys, saved-answer reads authorized from the stored answer
(`decision-service.ts` `readDecisionAnswer`, `decision-source-facts.ts` `readSavedAnswerReaderSessions`), an Agent
caller actor from its formal admission (`decision-service.ts` `callerActor`), Goal-only pin refresh, Workspace
ownership of decision objects (`mailbox-service.ts` `verifyDecisionObjectWorkspaces`) and one body-storage
implementation. Keep all of that. An independent review (a second model; the lead checked each item below at the
cited lines) found what is still wrong. Line numbers are today's.

Write scope (`WG/` = `src/core/work-graph/`): `WG/tasks/goal-decision-reader.ts`, `WG/state/decision-policy.ts`
(only ADD pure helpers), `src/business/workflow/workflow.ts` (only `automationConfirmation` ~1123–1200),
`WG/communication/decision-source-facts.ts`, `WG/communication/decision-service.ts`,
`src/core/agent-runtime/communication-tools.ts` (only the `record_decision_application` case ~532–570),
`WG/communication/mailbox-service.ts` (only `aggregateObjectPins` / `verifyDecisionObjectPins` ~1430–1580), and
`WG/tasks/plan-service.ts` (only the Agent adoption branch: the `isWorkRunCaller` call in `applyPlanChange`
~1513–1519 and `applyPlanChangeAsAgent` ~3260–3325). Nothing else.

Interfaces you must not change: `DecisionMessagePort`, `DecisionSourceFactsPort`, the reader output type,
`MessageWriteOwnerPort`, `createDecisionSourceFacts({ records, plans? })`, the `PlanPort` method signatures, every
existing receipt identity and fingerprint EXCEPT where an item below says so.

Groups (disjoint files): **G1** = F1, F6, F8 (`goal-decision-reader.ts`, `state/decision-policy.ts`, the
`workflow.ts` region); **G2** = F3, F4, F5 (`decision-service.ts`, `decision-source-facts.ts`, the
`communication-tools.ts` case); **G3** = F2, F7 (`plan-service.ts` Agent branch, the `mailbox-service.ts`
region). G1, G2, G3 run in parallel.

### F1 — automation cards that cannot be answered (B1 remainder)
`goal-decision-reader.ts:~318–336` derives the automation cause only for `requeue`/`reverify` verdicts. Two cards
the Workflow shows are therefore never answerable (`verifyRealCause` → `not_found`): (a) a PAUSED Goal:
`state/task-failure.ts:~766` (`workVerdict` AV-0) and `:~859` give verdict `none` when the Goal is not active, so a
card emitted before the pause vanishes and cannot be answered; (b) the Host budget lift: `workflow.ts:~1088–1095`
(`automaticRequeue`) turns `stopped/budget_exhausted` into a requeue when the Host binding budget is larger, and
the gate shows the automation card, but the reader skips `stopped`. Rule: §4.5 line 888 (the cause is derived from
formal facts, shared by selection and perform); §8.2 line 1357 ("暂停可答，不能因暂停卡消失"). Direction: the
reader derives the confirmation basis from the formal failure/round/autonomy facts independently of immediate
execution eligibility: (a) a paused (not cancelled) Goal keeps the cause its failure facts give as if it were
active (a pure add-only helper in `state/decision-policy.ts` over the facts the Task row carries; if the row does
not carry enough facts, report it under UNSPECIFIED instead of inventing); (b) **lead decision LB-1:** a
`stopped/budget_exhausted` failure with a non-null `failureClass` and a Run pin is an automation cause of action
`system_requeue` (countedNext as for a requeue) under the same shared derivation, in the reader always and in the
Workflow when its lift applies — both produce the same key. Answering still starts no work (§4.5).

### F2 — a real Agent adoption carries no application proof (B4 remainder)
`plan-service.ts:~1513–1519` drops the parsed `acknowledgementRef`/`decisionSource` before the Agent branch;
`:~3319` calls the compiler without `decisionProof`, so `communication/decision-application.ts:~117` answers
`incomplete` and an Agent that adopted a plan after the user's answer can never record the application. Rule:
§0 L1 line 24 and §3.3 line 621 (PlanRevisionAccepted proof is in slice 5; §4.5 line 886 defers only the
decision-based AUTHORIZATION to slice 6). Direction: pass both into `applyPlanChangeAsAgent` and build
`decisionProof` exactly as the Host branch does (`:~1553–1561`, `planAcceptanceProof`), as attribution data only
(never authorization; the Agent's original admission is unchanged). The Agent command fingerprint
(`agentCommandFingerprint('PlanApplyAgent', …)` ~3286) includes them ONLY when present, so every existing Agent
identity and fingerprint without them is byte-identical.

### F3 — a retried `record_decision_application` tool call ends in `idempotency_conflict`
`communication-tools.ts:~553–565` reads the CURRENT message and sends `expected: [{ ref, revision: saved.revision }]`;
the owner fingerprints that pin (`decision-service.ts:~965`). After the first call recorded the application the
message revision is +1, so the same call again (same requestId) has a new fingerprint and the store answers
`idempotency_conflict` instead of the original receipt. Rule: §3.3 line 627 (original receipt templates), §8.2
line 1366 ("重放早于新业务状态读 … 同身份重放"). Direction (**lead decision LB-2**): in
`recordDecisionApplication` the fingerprint is computed from the operation, scope, sender and payload
`{ messageRef, receipt }` only; the expected message pin stays the CAS of a first execution (exactly the original
message pin, §3.3 line 625) but is no longer part of the fingerprint, so a retry meets the original commit and
replays it before any business read. If a frozen test asserts `idempotency_conflict` for the same payload with a
different pin, keep the test passing, do not apply LB-2 and report the test id under UNSPECIFIED.

### F4 — the "same application already recorded" shortcut skips modifier admission
`decision-service.ts:~988–993` returns `committed` for an identical recorded application before the
modifier/operator check at `:~1001`. Rule: S5-MSG-04 (spec table ~509), §4.6 line 911. Direction: exact receipt
replay (lookupCommit) stays first; the shortcut for a NEW identity runs only after the caller passed the
modifier/operator admission. (Lead: the actor comparison stays `kind`+`id` — a later Run of the same Session is
the same Agent actor; do not add a Run comparison.)

### F5 — an incomplete batch read becomes "not found"
`decision-source-facts.ts:~675` (`readerReadRecord`): a ready `readMany` that omits the key returns `not_found`
without looking at the batch's reported missing keys. Rule: brief section 5 read-failure rule, §4.2 line 821,
§8.2 line 1367. Direction: `not_found` only when the store reports the key missing; an unaccounted omission is
`unavailable` (as `mailbox-service.ts:~1517` already does).

### F6 — a missing Task-graph seam reads as "no causes"
`goal-decision-reader.ts:~200`: `plans.queryTaskGraph === undefined` returns empty rows (automation causes vanish,
recurring causes fall back to Task-only keys); `:~207` turns every `not_found` into empty rows. Rule: §4.2 line 821
("不能把 unavailable 当可用空数组"). Direction: an absent seam is `unavailable`; `not_found` means "no rows" only
when the Goal has no adopted Plan (`goal.activePlanRevision === null`), otherwise it is `unavailable`.

### F7 — malformed aggregate objects are dropped before verification
`mailbox-service.ts:~1440` (`aggregateObjectPins`) skips an `aggregate` object whose `pin` is absent or not an
object, and `:~1458` skips it in the other validator, so the owner reaches state construction and body storage
before the store codec finally rejects it. Rule: §3.3 line 614 (validate source objects before state/body effects).
Direction: such an object is refused `invalid` before any pin extraction or body effect.

### F8 — a new read on the default-autonomy path
`workflow.ts:~1157` resolves a missing Run revision (`deps.sourceAuthority.load`) BEFORE the policy decides at
`:~1174` whether confirmation is needed at all; under the default `after_plan_confirmation` autonomy that read can
now refuse a step the existing owner would have performed. Rule: brief section 5 (existing paths unchanged), §8.2
line 1363. Direction: first decide with the pure policy (autonomy, action, countedNext, cap) whether a card is
needed; only then read the Run revision for the pin. No card needed → no new read.

Tests of this area: `tests/work-graph/S5-user-messages.test.ts tests/work-graph/S5-decision-application.test.ts
tests/runtime/S5-user-message-tools.test.ts tests/work-graph/S5-decision-queue.test.ts
tests/business/S5-decision-workflow.test.ts tests/work-graph/C1-session-mailbox.test.ts
tests/work-graph/C2-mailbox-admission.test.ts tests/app/AG2-consultation.test.ts tests/work-graph/S1-wait-disposal.test.ts
tests/runtime/S1-routed-replies.test.ts tests/scenarios/A11-no-progress.test.ts tests/business/A2-workflow-auto-rework.test.ts
tests/scenarios/C8-auto-rework-cap.test.ts tests/work-graph/S5-request-candidates.test.ts
tests/work-graph/W2-agent-whiteboard.test.ts tests/work-graph/W1-future-plan.test.ts tests/work-graph/R3c-plan-adoption.test.ts`
(A11 and C8 have bwrap-only failures here, section 8).

## 7. Self-check

When every group has reported and `npm run typecheck` passes: start one read-only review subagent per group with
fresh context. It reads its group's items of section 6, the named spec lines and the final diff of the group's
files (`git diff slice-base -- <files>`), and answers per item: done / not done / done differently, with
file:line, plus any new defect it sees in those lines (a read failure turned into absence, a pin taken from current
state where a captured one is required, a write outside `state/` constructors). The owning group (a new subagent
if needed) fixes what is not done. Then run section 8 once.

## 8. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
npx vitest run tests/work-graph/S5-user-messages.test.ts tests/work-graph/S5-decision-application.test.ts tests/runtime/S5-user-message-tools.test.ts tests/work-graph/S5-decision-queue.test.ts tests/business/S5-decision-workflow.test.ts tests/work-graph/C1-session-mailbox.test.ts tests/work-graph/C2-mailbox-admission.test.ts tests/app/AG2-consultation.test.ts tests/work-graph/S1-wait-disposal.test.ts tests/runtime/S1-routed-replies.test.ts tests/scenarios/A11-no-progress.test.ts tests/business/A2-workflow-auto-rework.test.ts tests/scenarios/C8-auto-rework-cap.test.ts tests/work-graph/S5-request-candidates.test.ts tests/work-graph/W2-agent-whiteboard.test.ts tests/work-graph/W1-future-plan.test.ts tests/work-graph/R3c-plan-adoption.test.ts
npx vitest run tests/app/A2-continuation-projection.test.ts tests/app/AG2-consultation.test.ts tests/app/AG2b-collaboration.test.ts tests/app/AG6-agent-assembly.test.ts tests/app/S0-attention-edge-label.test.ts tests/app/S1-session-routes.test.ts tests/app/S3-attention-context.test.ts tests/app/S3-graph-routes.test.ts tests/app/S5-decision-routes.test.ts tests/app/change-emitters.test.ts tests/app/orchestration-mechanism.test.ts tests/architecture/boundaries.test.ts tests/architecture/production-reach.test.ts tests/architecture/state-writes.test.ts tests/business/A2-workflow-auto-rework.test.ts tests/business/A2-workflow-disposition.test.ts tests/business/A2-workflow-result-mapping.test.ts tests/business/R5c-workflow.test.ts tests/business/S1-archive-flow.test.ts tests/business/S1-session-maintenance.test.ts tests/business/S1-task-order.test.ts tests/business/S5-decision-workflow.test.ts tests/composition/A2-requeue-platform.test.ts tests/composition/AG1-session-discovery.test.ts tests/composition/R4-control-runtime-platform.test.ts tests/composition/platform.test.ts tests/contracts/A2-rework-contract-helpers.test.ts tests/kernel/R4a-frozen-public.test.ts tests/record-store/lookup.test.ts tests/record-store/transaction-extensions.test.ts tests/runtime/B1-kernel-assembly.test.ts tests/runtime/B2-runtime-execution.test.ts tests/runtime/C2-runtime-platform-tools.test.ts tests/runtime/C3-brief-timeline.test.ts tests/runtime/R2e-git-source-loop.test.ts tests/runtime/R4-control-runtime.test.ts tests/runtime/R4c-execution-history.test.ts tests/runtime/R4c-graph-history.test.ts tests/runtime/R4c-session-continuity.test.ts tests/runtime/R5b-query-session-loop.test.ts tests/runtime/S1-archive-files-brief.test.ts tests/runtime/S1-routed-replies.test.ts tests/runtime/S3-context-assembler.test.ts tests/runtime/S3-graph-tools.test.ts tests/runtime/S5-user-message-tools.test.ts tests/runtime/W2-role-skills.test.ts tests/runtime/W2-whiteboard-tools.test.ts tests/runtime/orchestration-boundaries.test.ts tests/runtime/source-text-loop-migration.test.ts tests/runtime/source-tool-lifecycle.test.ts tests/scenarios/A1-rework-same-session.test.ts tests/scenarios/A11-no-progress.test.ts tests/scenarios/A4-duplicate-receipts.test.ts tests/scenarios/A7-control-goal29.test.ts tests/scenarios/A7-control.test.ts tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart-paused.test.ts tests/scenarios/A8-host-restart.test.ts tests/scenarios/C3-brief-idempotency.test.ts tests/scenarios/C3-not-entered-chain.test.ts tests/scenarios/C3-paused-continue-brief.test.ts tests/scenarios/C3-reply-other-session.test.ts tests/scenarios/C3-workspace-changed.test.ts tests/scenarios/C5-gate-fix.test.ts tests/scenarios/C8-auto-rework-cap.test.ts tests/scenarios/C8-human-stop-respected.test.ts tests/scenarios/S1-archive-restart.test.ts tests/scenarios/S1-wait-copy-retirement.test.ts tests/scenarios/S3-context-and-inputs.test.ts tests/scenarios/S3-query-graph.test.ts tests/scenarios/S5-goal-conflict-rework.test.ts tests/scenarios/S5-two-request-decisions.test.ts tests/state/S1-anomaly.test.ts tests/state/S1-archive-rework.test.ts tests/state/S1-dispatch.test.ts tests/state/S1-message-routing.test.ts tests/state/S1-responsibility.test.ts tests/state/S1-session-archive.test.ts tests/state/S5-decision-policy.test.ts tests/state/S5-goal-settings.test.ts tests/state/S5-message-decision.test.ts tests/state/S5-notice-settings.test.ts tests/state/S5-request-candidate.test.ts tests/state/context-input.test.ts tests/state/invariants-fuzz.test.ts tests/state/invariants.test.ts tests/state/message-machine.test.ts tests/state/no-progress.test.ts tests/state/plan-machine.test.ts tests/state/query-run-recovery.test.ts tests/state/run-machine.test.ts tests/state/session-availability.test.ts tests/state/task-failure.test.ts tests/state/task-machine.test.ts tests/state/verification-machine.test.ts tests/work-graph/A1-session-lifecycle.test.ts tests/work-graph/A2-goal-control.test.ts tests/work-graph/A2-requeue-service.test.ts tests/work-graph/B2-execution-entry.test.ts tests/work-graph/C1-session-mailbox.test.ts tests/work-graph/C2-mailbox-admission.test.ts tests/work-graph/R3a-goal-replay-boundaries.test.ts tests/work-graph/R3c-canonical-task-state.test.ts tests/work-graph/R3c-plan-adoption.test.ts tests/work-graph/R3e-reverify.test.ts tests/work-graph/R3g-role-spec.test.ts tests/work-graph/R4b-session-directory.test.ts tests/work-graph/R5b-initial-plan.test.ts tests/work-graph/R5b-query-execution.test.ts tests/work-graph/R5b-query-job.test.ts tests/work-graph/S1-anomaly-owner.test.ts tests/work-graph/S1-archive-owner.test.ts tests/work-graph/S1-codecs-indexes.test.ts tests/work-graph/S1-dispatch-guards.test.ts tests/work-graph/S1-provenance.test.ts tests/work-graph/S1-requeue.test.ts tests/work-graph/S1-responsibility.test.ts tests/work-graph/S1-session-facts.test.ts tests/work-graph/S1-wait-disposal.test.ts tests/work-graph/S3-context-inputs.test.ts tests/work-graph/S3-graph-context.test.ts tests/work-graph/S3-prepared-context-admission.test.ts tests/work-graph/S3-role-profiles.test.ts tests/work-graph/S5-decision-application.test.ts tests/work-graph/S5-decision-queue.test.ts tests/work-graph/S5-goal-settings.test.ts tests/work-graph/S5-notices.test.ts tests/work-graph/S5-request-candidates.test.ts tests/work-graph/S5-user-messages.test.ts tests/work-graph/W1-future-plan.test.ts tests/work-graph/W2-agent-whiteboard.test.ts
sha256sum tests/app/S5-decision-routes.test.ts tests/app/orchestration-mechanism.test.ts tests/architecture/state-writes.test.ts tests/business/S5-decision-workflow.test.ts tests/helpers/S5-application-support.ts tests/helpers/S5-decision-fixture.ts tests/helpers/S5-goal-settings-support.ts tests/helpers/S5-queue-support.ts tests/helpers/S5-user-message-support.ts tests/runtime/S5-user-message-tools.test.ts tests/scenarios/S5-goal-conflict-rework.test.ts tests/scenarios/S5-two-request-decisions.test.ts tests/scenarios/support/S5-decisions.ts tests/state/S5-decision-policy.test.ts tests/state/S5-goal-settings.test.ts tests/state/S5-message-decision.test.ts tests/state/S5-notice-settings.test.ts tests/state/S5-request-candidate.test.ts tests/state/message-machine.test.ts tests/work-graph/S5-decision-application.test.ts tests/work-graph/S5-decision-queue.test.ts tests/work-graph/S5-goal-settings.test.ts tests/work-graph/S5-notices.test.ts tests/work-graph/S5-request-candidates.test.ts tests/work-graph/S5-user-messages.test.ts
git status --short | wc -l
```

Expected at the end (this sandbox, without `/usr/bin/bwrap`):
- typecheck, check:architecture, build exit 0.
- The area run: `Test Files 2 failed | 15 passed (17)`, `Tests 8 failed | 237 passed (245)`: only A11-no-progress (7) and C8-auto-rework-cap (1), bwrap kind.
- The named run: `Test Files 24 failed | 107 passed (131)`, `Tests 69 failed | 3721 passed | 29 skipped (3819)`. All 69 failures and the 29 skips are bwrap/process-sandbox-only and occur in exactly these 24 files: tests/app/AG2b-collaboration.test.ts (2), tests/app/change-emitters.test.ts (1, `the Kernel ProcessSandbox profile is not available`), tests/app/orchestration-mechanism.test.ts (1), tests/composition/A2-requeue-platform.test.ts (5), tests/scenarios/A1-rework-same-session.test.ts (1), tests/scenarios/A11-no-progress.test.ts (7), tests/scenarios/A4-duplicate-receipts.test.ts (4), tests/scenarios/A7-control-goal29.test.ts (1), tests/scenarios/A7-control.test.ts (14), tests/scenarios/A8-host-restart-entry.test.ts (7), tests/scenarios/A8-host-restart-paused.test.ts (5), tests/scenarios/A8-host-restart.test.ts (3), tests/scenarios/C3-brief-idempotency.test.ts (4), tests/scenarios/C3-not-entered-chain.test.ts (1), tests/scenarios/C3-paused-continue-brief.test.ts (1), tests/scenarios/C3-reply-other-session.test.ts (3), tests/scenarios/C3-workspace-changed.test.ts (1), tests/scenarios/C5-gate-fix.test.ts (2), tests/scenarios/C8-auto-rework-cap.test.ts (1), tests/scenarios/C8-human-stop-respected.test.ts (2), tests/scenarios/S1-archive-restart.test.ts (1), tests/scenarios/S5-goal-conflict-rework.test.ts (1), tests/state/invariants-fuzz.test.ts (1), tests/state/invariants.test.ts (collection error `finalize_first … round … is open`, its 29 tests skipped). Their messages are of the bwrap kind only: `waiting` instead of `stopped`/`completed`, `ENOENT … /usr/bin/bwrap`, `finalize_first: round … is open`, a test timing out while waiting for a check. Every other file passes all its tests. A failure in any other file, or a different message in these files, is yours.
- Every sha256 as in section 3; `git status --short` = 93 paths (the same list as today); `./.dsh-scratch/`
  deleted; no commit (`git log` still shows one commit).

## 9. Reply format

Reply with these four sections and nothing else:
- FILES CHANGED: each file changed in this round, one per line.
- CHECKS: each command and its result (exit code; for vitest the `Test Files` and `Tests` lines and every file
  with a failure: its numbers, each failing test id and the first line of its failure).
- UNSPECIFIED: per item of section 6: `done` with file:line, or what was not done and why; each case the spec and
  this message do not describe; each frozen test you believe contradicts a correction.
- NOTES: at most ten lines: the subagents you ran (group, count); anything that blocked you or is undone.
