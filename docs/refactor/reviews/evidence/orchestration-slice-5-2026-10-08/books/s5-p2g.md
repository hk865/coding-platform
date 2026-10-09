# Task: orchestration slice 5, part 2 — one correction round (implement against frozen tests)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have
not seen this copy before. Everything you need is in this message and in files of this copy. The corrections
below are decided; do not make design decisions. Where the spec and this message do not determine something, do
not invent behaviour: list it under UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends and every subagent that is still running is
killed.** After starting subagents, stay in your turn until every one of them has finished and reported: wait
with a blocking shell command (for example `sleep 540`) and check with `list_agents`, again and again; no
notification wakes you after your turn ends. End your turn only after the checks of section 8 and the reply of
section 9.

**Work with subagents.** You are the coordinator: keep your own context small. Do not read the whole spec or
every file yourself. Give each group of section 6 to its own subagent with: sections 1–5 of this message
verbatim, its own group block verbatim, and the instruction to reply with FILES, what it changed per item, the
test numbers of its files and UNSPECIFIED items. Groups in one wave run in parallel and write disjoint files. A
subagent never edits a file of another group; if it needs a change there, it stops and tells you; you decide and
tell the owning group.

## 1. What this copy is and what is already done

- Base: commit 48c8d473 (`git log`: one commit, tag `slice-base`). Uncommitted on top: slice 5 complete
  (types, implementation of every former stub, 16 new test files and their support files). An earlier session
  implemented it; the lead re-measured: `npm run typecheck`, `npm run check:architecture`, `npm run build` exit 0;
  new tests 223 of 224 pass in this environment (the one failure, SC02, stops only because `/usr/bin/bwrap` is
  missing here; it passes in the lead's full environment); regression = baseline; `grep -rn "not implemented: "
  src` prints nothing; `git status --short` shows 92 paths.
- The lead's independent review (a second model plus the lead's own reading, every item below checked at the
  cited lines) found production defects that the frozen tests do not catch. This round fixes them. **All tests
  that pass today must still pass afterwards.**

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
  `slice-5-book-part2.md`: rules 17–20 and step 6 (allowlist).

## 3. Frozen test files (never change them, not even temporarily)

Do not edit any file under `tests/` (also not `tests/scenarios/harness.ts`) — not even to debug and revert. To
probe something, write a throw-away script or test under `./.dsh-scratch/` and delete it at the end. Never use
`/tmp`. At the end `sha256sum <file>` must print exactly:

```
50a7d9771d036114231c2dfbeded9f2e23f40d40c5acc3f3183e7bc5a3eebc7f  tests/app/S5-decision-routes.test.ts
2f1b2a42357c5ae511cd02a21a984463dbb9d7176def8cf62cade3237bc5b395  tests/app/orchestration-mechanism.test.ts
83589ecd06a5ab655aae959145b015704a0b6acd26be93bdb8aa7a864e73f044  tests/architecture/state-writes.test.ts
52466fedd9ee781b679f92fcbe42dcf3b9aa047779a8ee50479e91b0c83ff685  tests/business/S5-decision-workflow.test.ts
72189afd038a69727d0a72899f7960887db54b0126dce1a4a4994d0c70ce00b8  tests/helpers/S5-application-support.ts
46f16a5647bfa31fb8168aed7e1d122c0e0450a515e6fdfbd5965f05298be317  tests/helpers/S5-decision-fixture.ts
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

(The lead fixed one fixture gap since the last session: `tests/helpers/S5-decision-fixture.ts` now registers
`SESSION_LIFECYCLE_RECORD_SCHEMAS`, so DQ04 passes; its new sha256 is above.) If a correction below seems to
contradict a frozen test, keep the test passing and report the test id, the assertion, the spec line and a
minimal counter-example under UNSPECIFIED (rule 17).

## 4. Lead decisions for this round (binding)

- **L1 write scope.** Exactly the 92 paths of `git status --short` today plus ONE new path:
  `src/app/host.ts`, where the only allowed change is one property in the existing `createTargetPlatform({...})`
  call (~line 368): `operatorActor: actor` (the Host's real start actor; spec §3.2 "Host 从真实启动 actor 注入").
  No other file. No new files. `git status --short` at the end: 93 paths.
- **L2 operator fallbacks.** Keep `options.operatorActor ?? options.checks?.executor` in
  `src/composition/create-platform.ts:461` (the frozen scenario harness builds the composition with only
  `checks`; both values are trusted composition options, never HTTP/model JSON). But the composition must pass
  the SAME resolved operator to every owner that checks it, including the plan owner (`planDependencies`,
  ~line 519, today omits it). In `tasks/plan-service.ts:hostOperatorMatches` (~2602) the "unconfigured →
  bound non-automation Host actor" rule stays (frozen fixtures build `createPlanService` without an operator);
  with a configured operator it must compare exactly.
- **L3 allowlist.** The 27 `wire-format` entries for the HTTP DTO aliases in `src/app/core-http-types.ts` are
  accepted (valid vocabulary of the test; the note names the reader). The 4 `kept-for` "slice 6" entries are
  NOT accepted (the spec names no such slice-6 seam): `readGoalSettings` / `effectiveWorkspaceDecisionSettings`
  must be used by the owners/read model instead of the inline defaults (§2.2), `tasks/plan-readers.ts`
  `enumerateGoalCandidates` must be used by the read model (or deleted if G-C keeps its own reader-backed
  enumeration — then say so), `tasks/goal-settings-service.ts` `notFound` (~82) deleted. Remove those 4 entries.
  `production-reach` must still pass.
- **L4 settings command of `resolveDecision` (§4.5 line 884 vs frozen AP09).** AP09 calls the owner
  `resolveGoalConflict` directly with `expected` = the CURRENT Goal pins; that must keep working. The Workflow
  (`business/workflow/decision-actions.ts`) must instead send a STABLE settings command: `meta.expected` and
  fingerprint from the answered card's captured source pins (the committed answer's
  `response.decision.source`, restricted to the exact §3.3 line-625 pin set), so that a retry of the same
  `requestId` replays the original settings receipt BEFORE any new business read. The owner therefore accepts
  an expected Goal pin older than current only through the §2.8 named control rebase
  (`goalDecisionBasisMatches` + Goal active), records guards on the verified current version, and returns
  `revision_conflict` for every other difference. A retry after the settings commit must not end in
  `idempotency_conflict` or a false `application_not_recorded`.
- **L5 no test edits, no new tests.** You cannot add tests in this round (scope). Each group's self-check is a
  review subagent (section 7) plus the full frozen suite.

## 5. Rules for every group

Rules 1–20 of the two books hold. In particular: state transitions and protected fields only through
`src/core/work-graph/state/` constructors; replay of an original receipt comes before any new business read;
`forbidden` for another Workspace is decided before reading foreign objects, same-Workspace missing objects are
`not_found`; read failures are returned (`unavailable`/`incomplete`), never turned into empty or `not_found`
results; module edges only as `docs/refactor/module-target.json` (`tasks/`/`evidence/` never import
`communication/`/`views/`; `configuration/` never imports `views/` or a source owner; `state/` imports only
`src/contracts/` and itself). Keep every existing (pre-slice) path's behaviour and public shapes unchanged.

## 6. Work groups

Wave 1: G-A ∥ G-B ∥ G-C ∥ G-D (disjoint files). Wave 2: G-E (wiring; needs wave 1). After each wave run
`npm run typecheck` and the test files named for that wave's groups, fix integration errors, then go on.
(`WG/` = `src/core/work-graph/`; line numbers are today's.)

### G-A — communication and runtime reads
Files: `WG/communication/decision-source-facts.ts`, `WG/communication/decision-service.ts`,
`WG/communication/decision-application.ts`, `WG/communication/mailbox-service.ts`,
`src/core/agent-runtime/communication-tools.ts`.
1. **Canonical source facts** — `decision-source-facts.ts:178–245`. The candidate, planning_question and
   goal_cause branches read only the Goal and copy the caller's `source.pins`; a key naming a nonexistent
   candidate/question/cause passes and can take the synthetic answer claim; conflict membership (both Goals in
   scope, both active Plan pointers equal the key, the pair actually conflicting per §4.3) is not established.
   Rule: §3.3 answerDecision "canonical source 读取（不依赖 views）", S5-MSG-03 "source canonical facts/pins…来源不是
   仅 UI 自报", §4.2. Direction: re-derive identity, objects, pins, closure and allowed readers of every kind from
   the formal records (the tasks read helpers you may import — e.g. the request head reader, the initial-plan
   answer reader — are allowed edges; the helper construction `createDecisionSourceFacts({ records })` in the
   frozen tests must keep working); a missing source object is `not_found`, a read failure `unavailable`. Check
   scope of every object (both Goals of a pair) before reading anything else.
2. **Agent reader gate** — `communication-tools.ts:350–362` (`decisionReadContext`) replaces a work_run/query_run
   principal with a synthesized Host principal, so `decision-service.ts:545–551` skips the agent gate; the gate
   also only checks that `allowedReaderSessionRefs` is non-empty. Rule: §4.6 paragraph 3. Direction: keep the
   caller's real principal; an agent reads only when its own Run/Query Session is in
   `allowedReaderSessionRefs` (empty → `forbidden`); the Host user can always read. TU rows must still pass.
3. **Exact pin sets and CAS** — `decision-service.ts:436–462, 466–524, 641–655`; `mailbox-service.ts:2796–2799`.
   Rule: §3.3 line 625 (answer message card = original message + captured source pins; non-message card = source
   pins; application = exactly the message pin; duplicate, foreign, missing or extra pins → `invalid`) and §8.2
   CAS. Today a message answer inspects only the message pin, a synthetic answer never compares `meta.expected`
   with the source pins, and the application write guards `before.revision` instead of the caller's accepted pin
   (a message @2 accepts expected @1). Direction: validate the exact set, then compile the accepted pins into the
   commit guards.
4. **User-message source objects** — `mailbox-service.ts:1114, 2548–2579`: object pins of a decision request
   are copied into the source metadata without being read or guarded (only the Goal is). Rule: §3.3 sendUserMessage
   "真实 Goal/职责/source 对象→state→…带原事实 guards 的一次 commit". Direction: read each object (same Workspace,
   exists, revision equals the pin) before state and add the guards.
5. **One message writer** — `mailbox-service.ts:1477–1530` vs `2610–2834`: the original send/respond still commit
   through the old `writeMessage`; the new facade re-implements body storage/replay/commit (and carries defect 3).
   Rule: §3.3 line 684 / book G4 "the original send/respond move onto the same facade without behaviour change".
   Direction: one writer path for both, original identities/receipts unchanged (C1/C2 regression green).
Tests: `tests/work-graph/S5-user-messages.test.ts`, `S5-decision-application.test.ts`,
`tests/runtime/S5-user-message-tools.test.ts`, `tests/work-graph/C1-session-mailbox.test.ts`,
`C2-mailbox-admission.test.ts`, `tests/app/AG2-consultation.test.ts`.

### G-B — tasks and evidence owners, readers
Files: `WG/tasks/plan-service.ts`, `WG/tasks/goal-settings-service.ts`, `WG/tasks/requeue-service.ts`,
`WG/evidence/evidence-service.ts`, `WG/tasks/goal-decision-reader.ts`, `WG/tasks/planning-question-reader.ts`,
`WG/tasks/plan-readers.ts`, `WG/tasks/plan-commit-compiler.ts`.
1. **First-plan request adoption** — `plan-service.ts:1576–1588` with `state/plan-machine.ts:1673`:
   `basedOnIsActivePointer` is false when both the candidate's `basedOn` and the Goal's active pointer are null
   (the legitimate first plan), so a request-linked first plan is always `revision_conflict`. Rule: S5-PLAN-03,
   D2. Direction: null/null is the valid initial relationship; the first-plan operator rule stays.
2. **Agent proposals drop the request** — `plan-service.ts:1445–1451, 3034–3132`: `proposePlan` parses
   `requestRef`/`replaces` but `proposePlanAsAgent` gets neither, fingerprints neither and commits `claims: []`.
   Rule: §2.4, S5-PLAN-01/02. Direction: carry both through the Agent path with the same record/event/claim
   transaction as the Host path.
3. **Autonomy in the modifying owners** — `requeue-service.ts:124` (`goalSettings?`) and
   `evidence-service.ts:777` (`automaticReverifyPolicy?`) are declared but never read; the future-plan autonomy
   check in `plan-service.ts:2875–2892` runs only when `requestRef !== null`. Rule: §3.2 table (agent_requeue,
   system_requeue, auto_reverify, refine_future), S5-AU-03, §4.5 paragraph 4 (direct owners also guard what they
   read). Direction: each modifying owner applies `decisionActionPolicy` from the current Goal settings it reads
   (and guards that read) for non-human automatic actors; a person's explicit action keeps its existing rights;
   `needs_decision` refuses with the spec's code and writes nothing. Old C8/A2/R3e tests stay green (their Goals
   have no settings = default `after_plan_confirmation`).
4. **Goal-settings owner** — `goal-settings-service.ts`: (a) 224–257: Workspace Goal enumeration stops after
   `LOOKUP_MAX_PAGES` without refusing and replaces the watermark with later reads; rule §3.3 "集合枚举用首读
   ledgerHorizon", §4.1 limits line 772 (over the bound → `capacity`): refuse an unfinished listing and keep the
   first read's horizon. (b) 391–399 and 639–647: a failed successor read or depth 64 is treated as "no cycle";
   return the read failure / refuse an unfinished walk (S5-GS-01/03). (c) 595–677, 705–713: the Goal-active
   check exists only in the rebase branch and `selection.earlier/later` is not checked against the actual order;
   rule S5-GS-03/06 (application waits for resume: paused → `busy`), §4.5. (d) S5-GS-02: a cancelled historical
   Goal may still appear in a pure reorder list; S5-GS-04: the same pair and same Plan versions under a new
   identity is a no-op with a receipt-only result, not a revision increment. (e) L4 above (accept a captured
   Goal pin only via the §2.8 rebase). (f) Use `readGoalSettings` from `persistence/record-codecs.ts` instead of
   the inline default (~87); delete `notFound` (~82).
5. **Goal-cause identity and honest failures** — `goal-decision-reader.ts:172–192, 235–239`: causes use
   `affected: []`, so two Tasks/Runs with the same cause code share one source key; 157–160, 205–211: failed
   display/governance reads become `[]`; `planning-question-reader.ts:129–137`: a failed formal Answer read is
   skipped. Rule: D1 / §3.3 line 629 (affected pins are part of the key), §4.2 ("不能把 unavailable 当可用空数组").
   Direction: affected = the formal Task/Run pins of that cause; propagate failures.
6. **Proof of the changed aggregates** — `plan-service.ts:431–465`, `plan-commit-compiler.ts:231`: the
   `PlanRevisionAccepted` proof lists only proposal and Goal changes although adoption also creates the
   PlanRevision (before = absence pin revision 0, §2.1). Rule: D8 "exact before/after of every changed aggregate".
   Direction: build `changes` from the actual write set. (The codec side is G-D item 3.)
7. **Request-candidate read** — `plan-service.ts:2197–2215` never reads the QueryJob: a nonexistent same-Workspace
   request reads `{head:null,status:'closed'}`. Rule: §3.1/§3.3 request facts (missing request → `not_found`).
8. **Abandon pins** — `plan-service.ts:2232–2269`: abandon requires the proposal pin but lets the Goal pin be
   absent; §3.3 line 625 "abandon=proposal + Goal" exactly.
Tests: `tests/work-graph/S5-goal-settings.test.ts`, `S5-request-candidates.test.ts`, `S5-decision-application.test.ts`,
`tests/work-graph/R3c-plan-adoption.test.ts`, `W1-future-plan.test.ts`, `W2-agent-whiteboard.test.ts`,
`A2-requeue-service.test.ts`, `R3e-reverify.test.ts`, `R5b-initial-plan.test.ts`, `tests/scenarios/C8-*.test.ts`.

### G-C — read model in `views/`
Files: `WG/views/decision-read-model.ts`, `WG/views/goal-conflicts.ts`, `WG/views/automatic-rework-notices.ts`,
`WG/views/notice-position.ts`, `WG/views/notice-display-token.ts`.
1. **Scope first** — `decision-read-model.ts:189, 436–455` (`readDecisionCard` reads the supplied Goal/message
   refs without comparing them with ctx; notice-only queries use the supplied Workspace unchecked),
   `goal-conflicts.ts:203`. Rule: §8.2 scope row, §4.1. Direction: compare every explicit Workspace/Goal/message
   ref with the bound scope before any read (`forbidden`), then `not_found` for same-scope missing.
2. **Sections before paging** — `decision-read-model.ts:386–418`: `flat` is sliced before the requested sections
   are selected (50 waiting cards + 1 pending application, sections=[pending], limit 50 → empty page). Rule §4.1.
   Direction: filter by requested sections, then page.
3. **Notice paging must not skip** — `decision-read-model.ts:365, 387–389, 421`: the offset cursor indexes a
   list that shrinks after `markNoticesSeen` (show N10, ack, cursor 1 now returns N12 and its ack crosses N11).
   Rule §2.5, §8.2 notice-cursor row. Direction: a continuation tied to stable notice positions, not an offset.
4. **Honest windows and failures** — `goal-conflicts.ts:91–115`, `decision-read-model.ts:258–277, 394, 526–528,
   781–789`: no stable-window retry (§4.1 line 772: ≤4 retries), `atLeastCursor` not enforced, candidate
   truncation dropped, provider failures turned into `not_found`, `refreshSourcePins` replaces every object
   revision (only the §2.8 Goal-control refresh is allowed). Direction: as the rules say; failures stay visible.
5. **Exempt recovery label** — `automatic-rework-notices.ts:98`: interrupted (not counted) requeues are summarized
   as counted rework. Rule §4.4 ("自动恢复、不计次"). Direction: use the saved counted/exemption facts.
6. **Defaults and enumeration** — use `effectiveWorkspaceDecisionSettings` / `readGoalSettings`
   (`persistence/record-codecs.ts`) instead of inline defaults (`goal-conflicts.ts:144` and the read model), and
   `tasks/plan-readers.ts` `enumerateGoalCandidates` instead of the inline re-enumeration (`decision-read-model.ts:
   243–266`) — L3.
Tests: `tests/work-graph/S5-decision-queue.test.ts`, `S5-notices.test.ts`, `tests/app/S5-decision-routes.test.ts`.

### G-D — state and codecs
Files: `WG/state/goal-settings-machine.ts`, `WG/state/message-machine.ts`, `WG/persistence/decision-record-codecs.ts`,
`WG/persistence/plan-record-codecs.ts`, `WG/sessions/message-record-codecs.ts`,
`WG/configuration/decision-settings-service.ts`.
1. `state/goal-settings-machine.ts:113–119` `isLegalSettings` does not validate `waitForGoalRef` (GoalRef or null)
   or each `parallelRisks` entry (S5-GS-01 "settings 形状", §2.2).
2. `state/message-machine.ts:1054–1072` `createSyntheticDecisionAnswerRecord` copies `input.decision`; the
   constructor itself must establish `syntheticAnswer: true` (D7, §2.7 protected fields).
3. `persistence/plan-record-codecs.ts:660–668`: proof pins must allow revision 0 for an absence `before` (§2.1),
   while keeping every other check.
4. `persistence/decision-record-codecs.ts:72–102, 171–178`, `sessions/message-record-codecs.ts:352–361`: the
   settings-event decoders do not require the outer envelope and the JSON body to agree on event id/type/version/
   time, and pin validators accept a ref that has only `aggregateType`. Rule §2.8, §8.2 data row (bad field →
   `unavailable`). Direction: bind envelope and body; validate complete aggregate-specific refs.
5. `configuration/decision-settings-service.ts:178`: use `effectiveWorkspaceDecisionSettings` (L3).
Tests: `tests/state/S5-*.test.ts` (5 files), `tests/state/message-machine.test.ts`, `plan-machine.test.ts`,
`tests/architecture/state-writes.test.ts`, `tests/work-graph/S5-notices.test.ts`.

### G-E — Workflow, Host, composition (wave 2)
Files: `src/business/workflow/decision-actions.ts`, `src/business/workflow/workflow.ts`,
`src/app/collaboration-driver.ts`, `src/composition/create-platform.ts`, `src/app/host.ts` (L1 only),
`tests/architecture/production-reach-allowlist.json` (L3 removals only; text edit).
1. **Stable settings command** — `decision-actions.ts:126–178`: L4. Today it re-reads the source (a retry after
   the settings commit sees a stale/closed source and stops) and passes freshly read pins as `meta.expected` (a
   retry changes the fingerprint). Direction: replay first with the original command; only a first execution
   depends on current facts.
2. **conflict_wait** — `decision-actions.ts:107–123` `conflictPins` sends only the two Goal pins; the owner
   requires `[earlier, later, earlier GoalPhase]` (§3.3 line 625; absent phase = revision 0). Every `wait`
   answer through the Workflow is `invalid` today.
3. **Goal-cause identity in the Workflow** — `workflow.ts:1035–1053`: the automation cause uses `affected: []`
   (same defect as G-B 5); affected = the Task/Run pins of the failure.
4. **orderGoalAdvances is never effective** — `collaboration-driver.ts:451–458, 843`: the only call passes one
   advance and the helper returns early for length ≤ 1. Rule §4.5 line 890: at the claim/create safe point pass
   the current pending competing advances.
5. **Operator wiring** — L1, L2: `host.ts` passes `operatorActor: actor`; `create-platform.ts` passes the
   resolved operator to the plan owner as well. Inject the G-B autonomy seams (requeue `goalSettings`, reverify
   policy) from the one Goal-settings service.
6. **Allowlist** — remove the 4 `kept-for` entries of L3 once the helpers are used; `production-reach` passes.
Tests: `tests/app/S5-decision-routes.test.ts`, `tests/business/S5-decision-workflow.test.ts`,
`tests/scenarios/S5-two-request-decisions.test.ts`, `S5-goal-conflict-rework.test.ts` (bwrap here),
`tests/architecture/production-reach.test.ts`, `tests/app/AG2-consultation.test.ts`.

## 7. Self-check (wave 3)

When G-E is done: one read-only review subagent per group (G-A…G-E) with fresh context checks every numbered
item of its group against the cited spec rule and reports file:line for anything not done or done differently;
the owning group (or you) fixes it. Then run section 8.

## 8. Checks (run exactly these)

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
- New tests: `Tests 1 failed | 223 passed (224)`; the only failure is SC02 with `waiting` instead of `stopped`
  because `/usr/bin/bwrap` is missing here (do not instrument the harness to prove it; the lead confirms it).
- Regression: `Test Files 3 failed | 22 passed (25)`, `Tests 7 failed | 1926 passed (1933)`; the 7 failures are
  bwrap-only: `C8-auto-rework-cap` 1, `C8-human-stop-respected` 2, `A4-duplicate-receipts` 4. Every other file
  passes all its tests, including `state-writes` and `production-reach`.
- AG2-consultation 4/4; orchestration-mechanism 14/15 (its "runs two explicitly selected same-Goal Tasks…" test
  fails here only on bwrap `ENOENT`).
- `grep -rn "not implemented: " src` prints nothing; the 25 sha256 of section 3 unchanged;
  `sha256sum src/contracts/platform-duty.ts` = `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`;
  `git status --short` = 93 paths (today's 92 + `src/app/host.ts`) after you delete `./.dsh-scratch/`.

## 9. Reply format

Reply with these four sections and nothing else:
- FILES CHANGED: each file changed in this round, one per line; each allowlist entry removed.
- CHECKS: each command and its result (exit code; for vitest the `Test Files` and `Tests` lines and per-file
  numbers); for every failing test its id and the first line of the failure.
- UNSPECIFIED: per item of section 6 (G-A1 … G-E6): `done` with file:line, or what was not done and why; each case
  the spec and this message do not describe; each frozen test you believe contradicts a correction.
- NOTES: at most ten lines: the subagents you ran (group, count); anything that blocked you or is undone.
