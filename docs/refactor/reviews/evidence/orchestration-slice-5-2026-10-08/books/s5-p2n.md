# Task: orchestration slice 5 (goal settings and decisions), part 2: implement against frozen tests

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have
not seen this copy before. Everything you need is in this message and in files of this copy. The task is fully
specified; do not make design decisions. Where the spec and this message do not determine something, do not
invent behaviour: list it under UNSPECIFIED in your reply.

**Work with subagents.** The work is large (spec §0.6 estimates 4,700–6,700 production lines). You are the
coordinator: keep your own context small. Do not read the whole spec or every file yourself. Do step 0 yourself,
then give each work group below to its own subagent with exactly the group's section of this message (files,
spec sections, interfaces, tests, rules), wait for the wave, integrate, then start the next wave. Groups in one
wave run in parallel; they write disjoint files. A subagent never edits a file of another group; if it needs a
change in a shared type or port (section "Interfaces"), it stops and asks you; only you change shared types,
and you tell every running group.

## 1. What this copy is and what is already done

- Base: commit 48c8d473 of the repository (`git log` shows one commit `baseline 48c8d473… (s5 copy)`, tag
  `slice-base`). On top of it, uncommitted (`git status --short` shows them): "part 1" of this slice, done by
  another session: every new type and signature, `not implemented: …` stub bodies, 16 new test files, their
  support files, and the lead's corrections. `grep -rn "not implemented: " src` lists the 84 stubs you replace
  (use `grep -r`, not `git grep`: most stub files are untracked new files that `git grep` does not search).
- The tests are FROZEN (section 3): the lead reviewed them, had them repaired, and fixed their sha256. You may
  not edit any of them. Every new test today fails only because a stub throws or a part-2 behaviour is missing
  (section 6 lists the exceptions that pass today).
- Some bodies were implemented early in part 1 and are accepted as early part-2 work (section 4, A10/D5); review
  them against the spec like your own code, and fix the known defects listed there.

## 2. Where the rules are (all inside this copy)

- The frozen spec: `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md` (Chinese prose, English
  identifiers). §0 (lines 5–63) is the lead's freeze note and overrides the rest; text marked 【lead 改】 is
  corrected and 【lead 定】 is fixed. Sections by line: §2 data, compatibility, indexes, seams, protected
  fields, helper types 107–434 (§2.2 Goal/Workspace settings 117, §2.3 message extension 160, §2.4 request
  candidates and the unique slot 247, §2.5 indexes/notice origin/cursor 276, §2.6 seams 297, §2.7 state write
  protection 339, §2.8 helper types, pause basis, event proof 345); §3 state rows 437 (table from 487), autonomy
  and duties table §3.2 522, owner signatures, check order, pin sets (line 625) and source keys (line 629) §3.3
  558; §4 read model 688 (types §4.1 690, seven sources §4.2 776, conflicts §4.3 823, rework notices §4.4 835,
  routes §4.5 844, user tools §4.6 894); §5 tests 920–1186; §6 file list 1187–1293; §8.2 rules 1350–1370.
- The part-1 task book in this copy, `docs/refactor/design/orchestration-2026-10/slices/slice-5-book-part1.md`:
  its sections "Write scope", "Rules" (rules 1–16) and "Reading list" (code templates) still hold. Part-2 rules
  17–20 and the order of work are in `slice-5-book-part2.md` (same folder); this message replaces its
  "Frozen tests", "Corrections" and "Checks" placeholders and gives the group split.
- `docs/refactor/design/orchestration-2026-10/slices/README.md` "共用文件": the exact content of
  `src/contracts/platform-duty.ts` (already created; sha256
  `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`, must not change).

## 3. Frozen test files (never change them)

At the end `sha256sum <file>` must print exactly these values (the lead checks):

```
50a7d9771d036114231c2dfbeded9f2e23f40d40c5acc3f3183e7bc5a3eebc7f  tests/app/S5-decision-routes.test.ts
2f1b2a42357c5ae511cd02a21a984463dbb9d7176def8cf62cade3237bc5b395  tests/app/orchestration-mechanism.test.ts
83589ecd06a5ab655aae959145b015704a0b6acd26be93bdb8aa7a864e73f044  tests/architecture/state-writes.test.ts
52466fedd9ee781b679f92fcbe42dcf3b9aa047779a8ee50479e91b0c83ff685  tests/business/S5-decision-workflow.test.ts
72189afd038a69727d0a72899f7960887db54b0126dce1a4a4994d0c70ce00b8  tests/helpers/S5-application-support.ts
39bc121eee1ce551b6110f8e409e63be4b3b48ee5069cf0d9a0c505ad4da5400  tests/helpers/S5-decision-fixture.ts
d031e187aaff209482b47a9563dc499ea3ff4f18cf6fdf506f5b89de725de47e  tests/helpers/S5-goal-settings-support.ts
a993335d1a259f6449493b44ddf0214714bfe06b799dfc2b3ff220052578cc25  tests/helpers/S5-queue-support.ts
a02181dc16b0ed05faae5bb68c0404608a5cab08d650ae38ede260ec73b603fb  tests/helpers/S5-user-message-support.ts
1d0dc5cc7ad01a35fe022b9b1e0268a67782cef7b30d70e58fa3381349bee905  tests/runtime/S5-user-message-tools.test.ts
d45a1f1c57db719bb49c101aca8d7548ae35ab1b715712b7b5c833ab262b8316  tests/scenarios/S5-goal-conflict-rework.test.ts
fc04d8051652df802335e947bf9fd452f694d553433dc3b30db9cbff6171e012  tests/scenarios/S5-two-request-decisions.test.ts
e4a8b44af8713fd4531bff2fd88950335997303fd1efd763a486ba89e29525c1  tests/scenarios/support/S5-decisions.ts
55c96955ab7bb0b4df1158ea32c1a6db95098172574bfae048126eb89e36c787  tests/state/S5-decision-policy.test.ts
b00d90eaa9966a75fcd5b1b97163a5c484a2d3b3c432ff9069c439082c6771f2  tests/state/S5-goal-settings.test.ts
6a0600d44f248f3b71ea1a4c03e727eec5f81a0e337a3cca4a75c54128c5c2c5  tests/state/S5-message-decision.test.ts
a188f229e6ab9946f23e0c12b2a116538d174f223a0441d636feb1e33c07a949  tests/state/S5-notice-settings.test.ts
107252e843869a95d329d518b9557f9a3c820c6a4524fe5cf50da4e101cf8d29  tests/state/S5-request-candidate.test.ts
149f1d5185ff0833497b672f61ecc877f437ea267a76b21a95967b6e4a9908b1  tests/state/message-machine.test.ts
06b6a912bdb0284c7e9b61b09d807a2fcd6140610f112fc1c44c4ac581ad8050  tests/work-graph/S5-decision-application.test.ts
16c22b81819c501c049915b35aa9f8845afebc947316931d46c091b064fd8f89  tests/work-graph/S5-decision-queue.test.ts
c6af082c8b0ef7c5401447b314e29f9c6681940f949937af4869e5ac9fcf9daa  tests/work-graph/S5-goal-settings.test.ts
ac177ad2698b0ad7eacf9ac65bb5b6cae9286de9f569e17fcb17ab5a40c17fa2  tests/work-graph/S5-notices.test.ts
360e3e27bfa7969db5782fca73ff6c9d32b4afe3f05287c5d424148305726dfd  tests/work-graph/S5-request-candidates.test.ts
932869a5c7fa64551a00da2833f13946a3e0ad7adaeab5254cc061c2d747853f  tests/work-graph/S5-user-messages.test.ts
```

If a frozen test and the spec disagree, change neither: report the test id, the assertion, the spec line and a
minimal counter-example under UNSPECIFIED and leave that test failing (rule 17).

## 4. Lead decisions and corrections (binding; spec refs in brackets)

From the part-1 review (A1–A10):
- **A1 write scope.** Besides the 82 files of the part-1 book's "Write scope", these 6 may stay changed (type-forced
  changes only, already made): `src/contracts/query-job.ts` (InitialPlanAnswerFacts moved here and re-exported
  from `tasks/initial-plan.ts`; `model → tasks` is a forbidden edge), `src/core/work-graph/queries/query-job-service.ts`,
  `src/ui/views/sessions/render.ts`, `src/ui/api/routes.ts` (only the 12 `ROUTE_LABELS` entries of this slice's
  routes), `tests/app/orchestration-mechanism.test.ts`, `tests/state/message-machine.test.ts` (frozen). Part 2 must
  still change `state/goal-machine.ts` (F87) and `tests/architecture/production-reach-allowlist.json` (F78).
  The lead's own source changes made at the test freeze (D1–D9 below) are inside the 82-file scope (`contracts/goal-decisions.ts`, `model/communication-contracts.ts`, `model/plan-contracts.ts`, `state/plan-machine.ts`, `state/message-machine.ts`, `tasks/plan-service.ts`, `sessions/message-record-codecs.ts`). The test freeze added 4 frozen helper files that are NOT yours to edit: `tests/helpers/S5-goal-settings-support.ts`, `tests/helpers/S5-application-support.ts`, `tests/helpers/S5-queue-support.ts`, `tests/helpers/S5-user-message-support.ts`. Today `git status --short` shows 90 paths; at the end it shows 92 (+ `state/goal-machine.ts`, + the allowlist) and nothing else.
- **A2** S5-MSG-05 is the event `decision_application_recorded` refused when `requiresApplication=false` [§3.1,
  paragraph after the first code block].
- **A3** keep `proposal_accepted` for the old callers [§5.5]; `proposal_adopted` carries the existing acceptance
  inputs plus the request association; `proposal_replaced`/`proposal_recorded` carry what is needed to build the
  new candidate and the slot effect.
- **A4** `proposal_read` is read-only; the closed/goal_cancelled verdict is the pure
  `derivePlanProposalReadVerdict` (plan-machine).
- **A5** `SentEventBase` lives in model and is re-exported.
- **A6** reader factories `createGoalDecisionCauseReader(deps)`, `createPlanningQuestionReader(deps)` whose method
  has the spec signature [§4.2]; composition builds one each and the read model gets its card sources from them.
  Correction: their dependency types must be READ-only (records read/lookup/eventAt and the named readers); today
  `tasks/goal-decision-reader.ts:26` and `tasks/planning-question-reader.ts:29` expose transaction/commit
  capabilities — narrow them.
- **A7** one `decodeNoticeOrigin`, in `persistence/decision-record-codecs.ts` (the re-export in
  `sessions/message-record-codecs.ts:72` may stay; no second implementation).
- **A8** guard contexts hold only facts named by the spec's guard column; unconditional rules are invariants;
  read failures are returned by the service before the state call [§3.1 "source 读失败由服务先返回"]. The
  part-1 field sets are frozen as they are in the code, with D2/D4 below.
- **A9** scenarios keep the harness seed scope (`tests/scenarios/harness.ts` must not change, §5.4), Q1/Q2 on one
  Goal, canonical keys.
- **A10** early implementations inside existing codec/tool/pump bodies stay as early part-2 work; you own them now.
  Known defects: (6) the `SessionMessageResponded` validator excluded the Host actor of a user decision answer
  [§2.3] — fixed by the lead (D9 below), keep it; to fix by you: (7)
  `configuration/project-bootstrap-record-codecs.ts` ~:201 casts a present `decisionSettings` without validating
  it [§2.2]; (8) the wire-only `since`/`noticeAutomationCap` leak through the Round and Requeue public DTO decoders
  (`persistence/evidence-record-codecs.ts` ~:353, `tasks/claim-record-codecs.ts` ~:617) and a persisted
  `since:null` is accepted [§2.5: origin separate from the public DTO; null only in a PreparedCommit; a
  persisted null origin reads `unavailable`]. Composition still lacks the operator/duties wiring
  (`composition/create-platform.ts` ~:500–513) [§3.2 last paragraphs, §2.6].
- P1/P2 (part-1 production fixes, done; keep): `business/workflow/consultation.ts` discriminates the recipient
  union inline (ordinary Session paths never call a throwing helper; `tests/app/AG2-consultation.test.ts` 4/4);
  `app/collaboration-driver.ts` awaits the advance ordering BEFORE the busy check and registers the handle
  synchronously (no race between `handles.get` and `handles.set`).

From the test freeze (D1–D10, made by the lead in this copy):
- **D1 source keys** [§3.3 line 629]. `src/contracts/goal-decisions.ts` has `DecisionSourceIdentityV1` and
  `decisionSourceKey(identity)` (implemented, pure): the canonical JSON of the natural identity only (message =
  full messageRef; candidate = goalRef + requestRef, or proposalRef without a request; goal_cause = goalRef + cause
  code + affected pins sorted/deduplicated; planning_question = answerRef + questionIndex; note_review = note pin;
  message_release = messageRef + revision; goal_conflict = the unordered Goal pair sorted by Goal key, each with
  its active Plan pointer). No CAS pins, bases, Goal revision or order. Every reader, owner and the read model
  builds `source.key` only through this function; `source.pins` and `source.goalBases` stay separate.
- **D2 plan machine** [§3.1 S5-PLAN-01…05, §2.4]. `proposal_replaced` and `proposal_abandoned` carry
  `requestedBy: ActorRef; at: string` (→ `notAdopted.requestedBy/at`). New effects:
  `{kind:'write_replaced_proposal'; record}` = the replaced old head's complete next record (not_adopted,
  revision+1, `notAdopted.reason='replaced'`, `replacedBy` = the new candidate); `next` stays the new candidate;
  a second `PlanProposalRecorded` append effect; and `{kind:'request_slot'; goalRef; requestRef; expectedOwner;
  nextOwner}` = the unique-claim change (PLAN-01 null→new, PLAN-02 old head→new, PLAN-03 adopt and PLAN-04
  abandon owner→null; never for a null requestRef). The service maps it to ONE `UniqueClaimChange` with key
  `s5-request-candidate:` + canonicalJson({goalRef, requestRef}) and owner = the full proposalRef key [§2.4].
  `PlanRequestCandidateFacts.adoptionPolicy` = the `decisionActionPolicy` verdict for the adopting action and
  adopter (`adopt_first_plan` for a first plan, the future-revision action otherwise), `null` for an explicit
  configured-operator adoption; `user_only`/`needs_decision` reject `forbidden`; the existing PLAN-04/05/06 guards
  stay unchanged. `tasks/plan-service.ts` has a stub branch for the two new effect kinds in the commit compiler
  switch (`not implemented: plan commit effect …`): implement it.
- **D3 duties seam** [§2.6, S5-AU-04]. `SessionMailboxDependencies.duties?: MessageDutiesFactsPort`
  (`model/communication-contracts.ts`). The mailbox reads the sender's duties only from it; absent = a new user
  send is `unsupported`; old Session→Session paths never read it. Composition injects the
  `configuration/message-duties-adapter.ts` adapter.
- **D4** `MessageDecisionApplicationFacts.receiptReadable` = "the formal receipt and its event were found" (absent →
  `incomplete`); read/decode failures are returned by the service first.
- **D5** `derivePlanProposalReadVerdict` and `onProposalRead` (plan-machine) are accepted early work.
- **D6** seeded preconditions in the frozen tests use the real codecs and existing owners; your codecs must decode
  them unchanged (old records without the new fields keep their exact old public shape; rule 13).
- **D7 message constructors** [§2.3, §3.1 S5-MSG-01/03, §2.7]. `state/message-machine.ts`:
  `NewSessionMessageInput` has optional `goalRef` and `decision` (S5-MSG-01: `createSessionMessageRecord` writes
  them only when present; false flags stay omitted as today); new stub
  `createSyntheticDecisionAnswerRecord(NewSyntheticDecisionAnswerInput)` = the synthetic answer of a non-message
  card: sender = the operator as Host sender, recipient user, `intent: 'notify'`, `decision.syntheticAnswer:
  true`, `status: 'responded'`, revision 1, `readAt` = the answer time, `response` = the answer, `application:
  null`. The `s5-decision-answer:` unique claim (§2.5) and the `SessionMessageDecisionAnswered` event are the
  service's. An ordinary message card answer writes the original response slot and appends
  `SessionMessageResponded` (MD03 effects); `SessionMessageDecisionAnswered` is only for synthetic answers.
- **D8 plan proof data** [§2.8, §3.3]. `PlanTaskPort.applyPlanChange` (and the plan-service input type) has an
  optional `decisionSource?: DecisionSourceV1` = the answer's `response.decision.source`, passed by the trusted
  caller (Workflow `resolveDecision`, scenario SC01) next to `acknowledgementRef`. Proof data only, never
  authorization: with it the `PlanRevisionAccepted` event's `decisionApplication` =
  {acknowledgementRef, capturedPins: source.pins, changes: exact before/after of every changed aggregate,
  basisRebases}. Only aggregates that this change modifies AND that appear in `source.pins` are checked
  (§3.3: every changed object's before must match the captured version; read guards need not be modified):
  their before must equal the captured pin, except the Goal, whose newer revision gives a §2.8 control rebase
  only when `goalDecisionBasisMatches(basis, current)` and the Goal is active (else `revision_conflict`).
  Captured pins of objects the change does not modify are recorded as-is and not re-checked (SC01: the answered
  stale candidate U2 is replaced before the adopting change). CAS stays on `meta.expected`. Without
  `decisionSource` the proof has `capturedPins: []`, `basisRebases: []`. `decisionRefs` and every existing PLAN guard stay unchanged (a future
  adoption is still never authorized by non-empty `decisionRefs`, `plan-service.ts:21`).
- **D9** (A10 defect 6, fixed by the lead): the `SessionMessageResponded` validator in
  `sessions/message-record-codecs.ts` accepts the trusted Host actor when the message is a user-recipient decision
  card whose response carries `decision`; old Session replies keep work_run/query_run. Keep it.
- **D10** member notices in this slice come only from user-recipient `intent: notify` messages (§4.4 item 5); the
  "ack" of NR04 is the `markNoticesSeen` acknowledgement. The formal planning question (source 5) exists only for
  an `initial_coordination` Query of a Goal without an active Plan (`query-job-service.ts:704`,
  `plan-service.ts:967`); DQ01 therefore has it on a fourth Goal D.
- **Fixture facts you can rely on** (frozen `tests/helpers/S5-decision-fixture.ts`): P/W, Goals A/B/C at revision
  7 with orders 0/1/2, PA1/PB1/PC1 adopted through the real plan service (A and B both plan module M, C plans N),
  U1 (Q1) → PB2 planRevision 2 and U2 (Q2) → PB2-Q2, both based on PB1 and adoptable today; Session S owns the
  entered Run RA, RB is claimed-not-entered; `messages.decision` pending@1 and `messages.answered` (pending@1 Sent,
  then responded@2 Responded); `source.pins` never contain the message's own pin (§2.3); `storeSnapshot()` and the
  allocation counters are the §5.1 observations. Other test helpers: `tests/helpers/S5-goal-settings-support.ts`,
  `S5-application-support.ts`, `S5-queue-support.ts`, `S5-user-message-support.ts`,
  `tests/scenarios/support/S5-decisions.ts` (all frozen).
- `grep -rn "not implemented: " src` (not `git grep`) is the stub list; at the end it prints nothing. The
  part-2 book's final check uses `git grep`, which misses untracked new files.

## 5. Interfaces between groups (frozen; only you, the coordinator, may change them)

- Pure shapes: `src/contracts/goal-decisions.ts`, `src/contracts/platform-duty.ts`, the extensions in
  `src/contracts/{ledger,plan,query-job}.ts`, `src/contracts/core/session-message.ts`.
- Ports and dependency types: `src/core/work-graph/model/decision-contracts.ts` (GoalSettingsPort,
  DecisionMessagePort, RequestCandidatePort, WorkspaceDecisionSettingsPort, DecisionSourceFactsPort,
  MessageWriteOwnerPort, DecisionCardSourcePort, DecisionNoticeSourcePort, NoticeDisplayTokenPort,
  NoticePositionComparatorPort, GoalExecutedFilesPort, MessageDutiesFactsPort, CandidateRequestFactsPort, the
  owner dependency types), `model/communication-contracts.ts`, `model/plan-contracts.ts`.
- State signatures: the exported functions/types of `state/goal-settings-machine.ts`, `state/decision-policy.ts`,
  `state/notice-settings-machine.ts`, and the S5 members of `state/message-machine.ts` / `state/plan-machine.ts`
  [§3.1 code block].
- Codec exports (`persistence/decision-record-codecs.ts`, the S5 index constants and encoders in
  `sessions/message-record-codecs.ts`, `persistence/plan-record-codecs.ts`, `queries/query-record-codecs.ts`).
- Module edges: only those in `docs/refactor/module-target.json` (`npm run check:architecture`); rule 18:
  `tasks/` and `evidence/` never import `communication/` or `views/`; `configuration/` never imports `views/` or a
  source owner; no owner calls `views/`; `state/` imports only `src/contracts/` and its own folder.

## 6. Step 0 (you, before any group)

1. Read sections 1–5 of this message, spec §0, and run `npm run typecheck` (expected exit 0) and
   `grep -rn "not implemented: " src | wc -l` (expected 84).
2. Write `./.dsh-scratch/stubs.txt`: each stub with the group (G1–G6 below) that owns its file.
3. Do not start implementing yourself; start wave 1.

Today's new-test state (lead measurement on this copy, before part 2): typecheck 0, check:architecture 0 (44 submodule edges); new tests 16 files / 224 runs: 214 fail, 10 pass (RT01–RT05, RT07, PC05, PC09, UM12 x2 — existing behaviour or pure forwarding). Failures: 200 throw `not implemented: …`; 14 are AssertionErrors of missing part-2 behaviour (PC01–04/06–08/10: `proposal_recorded` drops `requestRef`/slot effects; RC03/RC04/RC07 x2: replacement, slot transfer, request/Goal validation). Regression: equal to the baseline below except `production-reach` 3/1 (the allowlist is yours). AG2-consultation 4/4.

## 7. Work groups

Order: wave 1 = G1 ∥ G2; wave 2 = G3 ∥ G4 ∥ G5 (they code against the frozen ports of section 5 and the
codecs/state of wave 1); wave 3 = G6 (wiring, needs everything). After each wave run `npm run typecheck` and the
test files of that wave's groups; fix integration errors before the next wave. Each group's subagent gets: its
block below, sections 2–5 of this message, and rules 1–20 (part-1 book "Rules" + part-2 book "Rules added").
Each group replies to you with FILES, the test numbers of its files, and UNSPECIFIED items.

### G1 — codecs, indexes, notice origin (wave 1)

- Files: `WG/persistence/decision-record-codecs.ts` (F13), `WG/persistence/record-codecs.ts` (F14),
  `WG/persistence/plan-record-codecs.ts` (F15), `WG/persistence/rework-codecs.ts` (F16),
  `WG/persistence/evidence-record-codecs.ts` (F17), `WG/configuration/project-bootstrap-record-codecs.ts` (F18),
  `WG/sessions/message-record-codecs.ts` (F21), `WG/sessions/message-body-envelope.ts` (F22),
  `WG/queries/query-record-codecs.ts` (F23), `WG/tasks/claim-record-codecs.ts` (F33),
  `src/contracts/core/session-message.ts` stub (F03). (`WG/` = `src/core/work-graph/`.)
- Spec: §2.1–§2.5, §2.7, §2.8 (proof/event shapes), §0.6 (4 new events, 5 indexes), rule 13.
- Provides: exact codecs for Goal `settings`, Workspace `decisionSettings`, the message extension (user
  recipient, goalRef, decision, application, Host response variant), candidate `requestRef`/`notAdopted`, the four
  events (`GoalSettingsChanged`, `WorkspaceNoticeSeenChanged`, `SessionMessageDecisionAnswered`,
  `SessionMessageDecisionApplied`), the 5 indexes (§2.5 table + `query-job-by-workspace-goal`), `since`
  commit-cursor bindings on SessionMessage, TaskRequeue and Round records, `decodeNoticeOrigin`.
- Fix the A10 defects (6), (7), (8) of section 4. Old records without the new fields decode to their exact old
  public shape; the origin never leaks into an old DTO or receipt.
- Tests that depend mostly on it: UM12, RC09, RC11, NR05, NR08, `tests/architecture/state-writes.test.ts`, and the
  setup of every service row (the frozen fixture seeds through these codecs: they must accept what it writes).

### G2 — state machines and policy (wave 1)

- Files: `WG/state/goal-settings-machine.ts` (F08), `WG/state/decision-policy.ts` (F09),
  `WG/state/notice-settings-machine.ts` (F10), `WG/state/message-machine.ts` S5 rows (F11),
  `WG/state/plan-machine.ts` S5 rows (F12), `WG/state/goal-machine.ts` (F87: `nextGoalDesiredState` keeps an
  existing `settings`; an old Goal without it keeps its old shape).
- Spec: §3.1 (all 23 rows, refusal codes and order), §3.2 (autonomy table exactly, duties rule), §2.7 (protected
  fields: only state constructors write them), §2.8 (`goalDecisionBasisMatches`, control rebase), §4.3 footprint
  rules for `goalConflictFacts`, D2 of section 4.
- Provides the pure functions the owners call; imports only `src/contracts/` and the state folder; no clock,
  random or crypto.
- Tests: `tests/state/S5-goal-settings.test.ts` (15), `S5-decision-policy.test.ts` (16),
  `S5-message-decision.test.ts` (14), `S5-request-candidate.test.ts` (10), `S5-notice-settings.test.ts` (8); the
  regression `tests/state/message-machine.test.ts`, `plan-machine.test.ts` must stay green.
- Note: GS01, NS01 and MD03–MD14 also call G1 functions (`readGoalSettings` and `effectiveWorkspaceDecisionSettings`
  in `persistence/record-codecs.ts`, `encodeUserDecisionBody` / `decodeStoredUserDecisionBody` in
  `sessions/message-body-envelope.ts`): judge the state test numbers after both wave-1 groups are done.

### G3 — tasks and evidence owners, readers (wave 2)

- Files: `WG/tasks/goal-settings-service.ts` (F24), `WG/tasks/executed-files-stub.ts` (F25),
  `WG/tasks/request-facts-reader.ts` (F26), `WG/tasks/goal-decision-reader.ts` (F27),
  `WG/tasks/planning-question-reader.ts` (F28), `WG/tasks/initial-plan.ts` (F29), `WG/tasks/plan-service.ts`
  (F30), `WG/tasks/plan-readers.ts` (F31), `WG/tasks/plan-commit-compiler.ts` (F32), `WG/tasks/claim-service.ts`
  (F34), `WG/tasks/execution-entry-service.ts` (F35), `WG/tasks/requeue-service.ts` (F36),
  `WG/evidence/evidence-service.ts` (F37), `src/contracts/plan.ts` (F04 acknowledgementRef/proof fields),
  `WG/model/plan-contracts.ts` only if you (coordinator) approve a change.
- Spec: §3.3 rows for `goal-settings-service.ts` and `plan-service.ts` (check order, receipts, pin sets line
  625), §2.4 (request slot), §2.6 (executed-files stub, request seam), §2.8, §3.1 S5-GS rows and S5-AU-01/02
  (waiting guards in claim/entry: read versions become commit guards), §3.2 (autonomy in requeue/reverify), §4.2
  sources 2, 3, 5 (readers; the planning reader reuses `readInitialPlanAnswerFacts` / the existing parser,
  never `proposeInitialPlanFromAnswer`), §4.4 (requeue/reverify write the notice origin `since` and
  `noticeAutomationCap`; counts unchanged), rule 2, 4, 5, 9; `findPendingProposal` must not be used for "the"
  request head.
- Consumes: G1 codecs, G2 state. Provides: GoalSettingsPort, RequestCandidatePort, PlanTaskPort extensions
  (`proposePlan` with `ProposedPlanRequestV1`, `applyPlanChange` + optional `acknowledgementRef`), the readers
  behind the card source ports.
- Tests: `tests/work-graph/S5-goal-settings.test.ts` (SS, 32 runs), `S5-request-candidates.test.ts` (RC, 22), and
  the plan/settings receipts used by AP; regression C8/A4/R3e/A2/W1/W2/R3c/R5b files must stay as baseline.

### G4 — communication and configuration owners (wave 2)

- Files: `WG/communication/mailbox-service.ts` (F38: `sendUserMessage`, `createMessageWriteOwner`; the original
  send/respond move onto the same facade without behaviour change), `WG/communication/decision-service.ts` (F39),
  `WG/communication/decision-application.ts` (F40), `WG/communication/decision-source-facts.ts` (F41),
  `WG/configuration/decision-settings-service.ts` (F19), `WG/configuration/message-duties-adapter.ts` (F20).
- Spec: §3.3 rows for mailbox `sendUserMessage`, `answerDecision`, `readApplicationReceiptFacts`,
  `recordDecisionApplication`, `markNoticesSeen` (check order, receipts, pin sets, the synthetic answer claim
  `s5-decision-answer:` §2.5), §2.3, §2.6 (duties adapter: exact mapping only), §2.8 (proof whitelist: only
  `GoalSettingsChanged` and `PlanRevisionAccepted`; architecture/policy → `unsupported`, §0.2 L1), §3.1 S5-MSG
  rows and S5-NT rows, §3.2 operator rule, rules 1, 3, 8, 10, 12.
- Consumes: G1 codecs, G2 state, the ports of section 5 (source facts read tasks readers through their ports —
  G3 implements them in parallel; code against the port signatures). Provides: DecisionMessagePort,
  WorkspaceDecisionSettingsPort, MessageWriteOwnerPort, DecisionSourceFactsPort, MessageDutiesFactsPort adapter.
- Tests: `tests/work-graph/S5-user-messages.test.ts` (UM, 26), `S5-decision-application.test.ts` (AP, 28), the
  markSeen rows of `S5-notices.test.ts`; regression C1/C2 mailbox files must stay green.

### G5 — read model in `views/` (wave 2)

- Files: `WG/views/decision-read-model.ts` (F42), `WG/views/goal-conflicts.ts` (F43),
  `WG/views/automatic-rework-notices.ts` (F44), `WG/views/notice-position.ts` (F45),
  `WG/views/notice-display-token.ts` (F46).
- Spec: §4.1–§4.4, §2.5 (ordering, display token: HMAC with an injected key bound to Workspace/categories/filter/
  caller/read watermark/after key; invalid after a restart), rule 7, 8, 9, 20, §0.4 I-5/I-6 (not yet wired sources
  read `not_available` with honest capabilities, never "0 items").
- Consumes: the card/notice source ports (G3 readers), G1 codecs. No owner calls `views/`; `views/` never writes.
- Tests: `tests/work-graph/S5-decision-queue.test.ts` (DQ, 18), `S5-notices.test.ts` (NR, 16).

### G6 — Workflow, Runtime, Host, composition, allowlist (wave 3)

- Files: `src/business/workflow/decision-actions.ts` (F47), `contracts.ts` (F48), `ports.ts` (F49), `workflow.ts`
  (F50), `consultation.ts` (F86, keep P1), `src/core/agent-runtime/communication-tools.ts` (F51),
  `execution-contracts.ts` (F52), `execution-driver.ts` (F53), `execution-inputs.ts` (F54),
  `src/composition/create-platform.ts` (F55), `src/app/core-http-types.ts` (F56), `core-routes.ts` (F57),
  `collaboration-driver.ts` (F58, keep P2), `src/ui/views/execution/actions.ts` (F88), `src/ui/api/routes.ts`
  (labels only), `tests/architecture/production-reach-allowlist.json` (F78, text edit; only `kept-for` entries
  naming a later slice, part-2 book step 6).
- Spec: §4.5 (12 routes, `resolveDecision`, `orderGoalAdvances`), §4.6 (3 user tools, the response input
  formatter `'用户答复\n' + canonicalJson(body)`, once, original inputId), §6.2, §3.2 (operator from the Host's
  real start actor; never from HTTP JSON), §2.6 (composition injects the duties adapter and the request seam),
  rules 16, 19; the token key: 32 random bytes generated once in the composition, never stored.
- Tests: `tests/app/S5-decision-routes.test.ts` (RT, 8), `tests/runtime/S5-user-message-tools.test.ts` (TU, 7),
  `tests/business/S5-decision-workflow.test.ts` (WF, 2), `tests/scenarios/S5-two-request-decisions.test.ts`
  (SC01), `S5-goal-conflict-rework.test.ts` (SC02), `tests/app/AG2-consultation.test.ts`,
  `tests/app/orchestration-mechanism.test.ts`, `tests/architecture/production-reach.test.ts`.

## 8. Self-check pass (wave 4)

When all groups are done: one review subagent per group (G1–G6) reads that group's files against its spec
rows and its tests and reports defects (file:line, spec row); the owning group (or you) fixes them. Then you run
all checks of section 9. A review subagent must not edit files.

## 9. Checks (run exactly these; no other tests)

```
npm run typecheck
npm run check:architecture
npm run build
npx vitest run tests/state/S5-goal-settings.test.ts tests/state/S5-decision-policy.test.ts tests/state/S5-message-decision.test.ts tests/state/S5-request-candidate.test.ts tests/state/S5-notice-settings.test.ts tests/work-graph/S5-goal-settings.test.ts tests/work-graph/S5-user-messages.test.ts tests/work-graph/S5-request-candidates.test.ts tests/work-graph/S5-decision-queue.test.ts tests/work-graph/S5-decision-application.test.ts tests/work-graph/S5-notices.test.ts tests/app/S5-decision-routes.test.ts tests/runtime/S5-user-message-tools.test.ts tests/business/S5-decision-workflow.test.ts tests/scenarios/S5-two-request-decisions.test.ts tests/scenarios/S5-goal-conflict-rework.test.ts
npx vitest run tests/state/message-machine.test.ts tests/state/plan-machine.test.ts tests/state/task-failure.test.ts tests/state/task-machine.test.ts tests/state/verification-machine.test.ts tests/work-graph/C1-session-mailbox.test.ts tests/work-graph/C2-mailbox-admission.test.ts tests/work-graph/R3a-goal-replay-boundaries.test.ts tests/work-graph/R3c-plan-adoption.test.ts tests/work-graph/W1-future-plan.test.ts tests/work-graph/W2-agent-whiteboard.test.ts tests/work-graph/R5b-initial-plan.test.ts tests/work-graph/R5b-query-job.test.ts tests/work-graph/A2-goal-control.test.ts tests/work-graph/A2-requeue-service.test.ts tests/work-graph/R3e-reverify.test.ts tests/work-graph/R3c-canonical-task-state.test.ts tests/scenarios/C8-auto-rework-cap.test.ts tests/scenarios/C8-human-stop-respected.test.ts tests/scenarios/A4-duplicate-receipts.test.ts tests/architecture/state-writes.test.ts tests/architecture/boundaries.test.ts tests/architecture/production-reach.test.ts tests/record-store/lookup.test.ts tests/record-store/transaction-extensions.test.ts
npx vitest run tests/app/AG2-consultation.test.ts tests/app/orchestration-mechanism.test.ts
```

Expected at the end:
- typecheck, check:architecture, build exit 0.
- New tests: 16 files, 224 tests, all pass. A test that needs the check sandbox (`/usr/bin/bwrap`, missing in this
  environment; e.g. a Run that stays `waiting` at its check) may fail for that reason only: name it with the
  evidence; the lead confirms it in a full environment.
- Regression command (25 files): baseline `Test Files 3 failed | 22 passed (25)`, `Tests 7 failed | 1926 passed
  (1933)`; the 7 failures are bwrap-only, in `tests/scenarios/C8-auto-rework-cap.test.ts` (1),
  `C8-human-stop-respected.test.ts` (2: AV-4, VR-14 step 5), `A4-duplicate-receipts.test.ts` (4). Every other file
  passes all its tests; `state-writes` and `production-reach` must pass (today production-reach fails 1: the
  allowlist is part 2).
- AG2-consultation 4/4. orchestration-mechanism 14/15: its test "runs two explicitly selected same-Goal Tasks in independent Sessions …" fails in this environment only because `/usr/bin/bwrap` is missing (ENOENT in the run_check receipt; 15/15 in the lead's full environment at the base commit); any other failure there is yours.
- `grep -rn "not implemented: " src` prints nothing; `git status --short` shows exactly the files of section 4 A1
  (scope) and nothing else after you delete `./.dsh-scratch/`.

## 10. Reply format

Reply with these four sections and nothing else:
- FILES CHANGED: each file, `N` or `C`, one per line; then each allowlist entry you added (file#name and its note).
- CHECKS: each command and its result (exit code; for vitest the `Test Files` and `Tests` lines and the per-file
  numbers); for every failing test the id and the first line of its failure.
- UNSPECIFIED: each case the spec and this message do not describe that you met, one line each; each frozen test
  you believe contradicts the spec (id, assertion, spec line, counter-example); each spec sentence that
  disagrees with the code, with file:line. Every "not found" names the command that found nothing.
- NOTES: at most ten lines: the real call chain of `decisions/answer` from the route to the commits
  (file:function, in order); which subagents you ran (group, count); anything that blocked you or is undone.
