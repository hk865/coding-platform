# Fixture repair for slice 5 tests: common rules (all groups)

## What this checkout is

- Base commit 48c8d473 plus an uncommitted change of 86 paths (see `git status`). The change is "part 1" of a
  two-part task done by another agent: new types, `not implemented: ...` stubs in `src/`, 16 new test files
  `tests/**/S5-*.test.ts` and 2 support files (`tests/helpers/S5-decision-fixture.ts`,
  `tests/scenarios/support/S5-decisions.ts`). `git grep -n "not implemented" -- src` lists the stubs. Part 2
  (later, by another agent) replaces the stubs with real code and MAY NOT EDIT ANY TEST FILE.
- After your work the lead freezes the test files. So every test must, once part 2 implements the spec exactly,
  pass for the right reason, and must not need part 2 to change its fixture. A wrong implementation must not pass.
- Authorities: `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md` (§0 wins over the body;
  §2–§4 behaviour; §3.3 line 625 = exact pin sets; §3.3 line 629 = source keys; §5.1 fixture and observation
  rules; §5.2 unit rows; §5.3 owner-service rows, memory + SQLite; §5.4 routes and scenarios); book part 1
  `docs/refactor/design/orchestration-2026-10/slices/slice-5-book-part1.md`.
- References in this folder (D:/cxt/impl-s5-fx-msg/): `review-codex2.md` = the latest review of these tests
  (24 defects; your group's are repeated, verified, in your group file), `guided-round.md` = the earlier
  correction (lead decisions A1–A10, items B1–B19; still binding), `fail-reasons.txt` = the measured first failure
  line of every failing run in part 1 today (test name, error), `file-to-case-map.txt` = which case ids live in
  which file (must not change).

## Lead decisions made for this repair (binding; the src changes are already in this checkout)

- **D1 source keys.** `src/contracts/goal-decisions.ts` now has `DecisionSourceIdentityV1` and
  `decisionSourceKey(identity)`: the key is the canonical JSON of the natural identity only (message = full
  messageRef; candidate = goalRef + requestRef, or proposalRef without request; goal_cause = goalRef + code +
  affected pins; planning_question = answerRef + questionIndex; note_review = note pin; message_release =
  messageRef + revision; goal_conflict = the unordered Goal pair, each with its active Plan pointer). It contains
  no CAS pins, no goalBases, no Goal revision or order. EVERY `source.key` in tests and fixtures is built by
  `decisionSourceKey({...identity})`; never hand-write a key, never pass a `DecisionSourceV1` or a previous key
  into it, never use an empty key. `source.pins` (CAS) and `source.goalBases` stay separate fields of
  `DecisionSourceV1`.
- **D2 plan machine** (`src/core/work-graph/state/plan-machine.ts`): `proposal_replaced` and
  `proposal_abandoned` now carry `requestedBy: ActorRef; at: string` (they become `notAdopted.requestedBy/at`).
  New effects: `{kind:'write_replaced_proposal'; record}` = the replaced old head's complete next record
  (not_adopted@rev+1, reason 'replaced', replacedBy = new candidate; `next` stays the new candidate) and
  `{kind:'request_slot'; goalRef; requestRef; expectedOwner; nextOwner}` = the request-slot unique-claim change
  (PLAN-01 null→new, PLAN-02 old→new, PLAN-03 adopt and PLAN-04 abandon owner→null; never for a null requestRef).
  `PlanRequestCandidateFacts.adoptionPolicy: 'user_only'|'needs_decision'|'automatic'|'automatic_notice'|null`
  = the §3.2 verdict for the adopting action/adopter (null = explicit configured-operator adoption);
  user_only/needs_decision reject `forbidden`.
- **D3 duties seam.** `SessionMailboxDependencies` now declares `duties?: MessageDutiesFactsPort`
  (`src/core/work-graph/model/communication-contracts.ts`). Pass trusted duties through this typed field; no
  `as unknown as SessionMailboxDependencies` casts. Absent `duties` = a new user send is `unsupported`.
- **D4.** `MessageDecisionApplicationFacts.receiptReadable` stays: it means "the formal receipt and its event were
  found" (absent → incomplete); read/decode failures are returned by the service before the state call.
- **seedCommit** (raw seed with real codecs) is allowed only for PRECONDITIONS that an existing production path
  could have produced, with a coherent history (events matching the snapshots they carry, revisions in order,
  claims consistent with owners). It never replaces the operation the row tests (answering, acknowledging,
  applying, changing settings, marking seen). A `SessionMessageSent` event carries the message as sent
  (pending@1), never a responded snapshot.
- `tests/scenarios/harness.ts` must not change (spec §5.4). Widened fixture Run permissions are acceptable test
  admission setup.
- Exact pin sets (§3.3 line 625): setGoalSettings = target Goal + current wait target Goal and its GoalPhase (pin
  0 when no phase), reorderGoals = every listed Goal (no Workspace pin), resolveGoalConflict = both Goals (+ the
  earlier GoalPhase for wait), answer on a message card = original message + captured source pins, non-message
  card = source pins, application = exactly the original message pin, markSeen = Workspace, abandon = proposal +
  Goal. Duplicate, foreign, extra, negative or fractional pins are invalid. Setup calls assert their own result
  (`committed`) before the row continues.

## What you may change

- ONLY the files listed in your group file, plus at most ONE new helper file under `tests/` whose name your group
  file gives. Never edit `src/`, never edit any other test or helper unless your group file lists it. If you need
  a helper that the shared fixture does not offer, put it in your group's new helper file (copy code if needed).
- Keep every case id and the file-to-case map. Keep the number of `it` per file; service rows keep
  `describe.each(['memory','sqlite'])` (every service row runs on both backends; at least one row per file closes
  and reopens the same SQLite file where the row says reopen). Keep the case id at the start of each `it` title.
- You cannot run node, npm or tests here (no Node). Be careful with TypeScript: read the types you use
  (`src/contracts/**`, `src/core/**`), keep imports correct, no `any`/`as unknown as` shortcuts that hide wrong
  shapes. The lead runs typecheck and the tests afterwards. Today `npm run typecheck` fails only in test files
  that still use the old `decisionSourceKey(source)` call or the old plan event shapes; your files must typecheck.

## How each case must look

1. **Exact row.** Each case builds the given of its spec row and asserts the expected values of the row exactly
   (row text plus §5.1). Expected values are exact (`toEqual`/`toMatchObject` on the named fields), not "truthy",
   not "non-decreasing", not "any increasing revision".
2. **Real histories.** A given that an existing production entry can produce is produced through that entry and
   the state machines it uses (fixture seed APIs, claim → authorize → enter, mailbox send/ack/respond, Query
   submit/claim/answer, plan propose/apply, Goal control, requeue/reverify owners). A given that is new slice-5
   behaviour is produced through the new owner entry (`setGoalSettings`, `reorderGoals`, `resolveGoalConflict`,
   `sendUserMessage`, `answerDecision`, `recordDecisionApplication`, `abandonPlanProposal`, `markNoticesSeen`, …);
   in part 1 such a step throws `not implemented: …`, which is allowed. Hand-made records only per the seedCommit
   rule above or where the row says old/legacy/raw records (codec compatibility).
3. **Part 1 RED only from stubs.** Today a case may fail only because a `not implemented` stub throws or because a
   part-2 behaviour is missing. It must never fail at a setup step that uses EXISTING code: before you use an
   existing entry, read it and check that its guards accept your inputs today (registered schemas, correct ids
   and scopes, legal state order, an adoptable plan delta, a Session that is not occupied when archived, …).
   Think through the setup of each case step by step against the code.
4. **Consistent givens.** One case's fixture must be a legal history (see seedCommit rule).
5. **Observations (§5.1).** "0 writes" = records/events/claims counts and versions before and after on the store
   the owner under test actually writes to (not a mock call counter; a body orphan alone is allowed). "1 commit"
   is read from the Store's events/receipt. Replay: `replayed: true`, the original cursor and complete original
   value, and newId/now/body-put/model counters unchanged. Refused or read-only calls add no model call. Counts
   that setup already changed are measured as deltas.
6. **No tautologies, no escapes.** No comparing a value with itself or with the test's own input as if it were an
   output, no `if (...) return;` (or `?? skip`) before the row's assertions, no `.every` over a possibly empty
   array, no `Promise.allSettled` that drops a rejection, no fake replacing the code under test (call the entry
   the row names). Recorders are allowed only in the route file for pure forwarding rows (B14).
7. **Clock and ids.** T=`2026-10-08T00:00:00.000Z`; P/W, Goals A/B/C (order 0/1/2, revision 7), PA1/PB1 (aggregate
   revision 1), PA2/PB2 really different PlanRefs, message revision 1, Workspace revision 3, operator =
   human:operator, automation = WORKFLOW_AUTOMATION_ACTOR, modules M=`src/m/`, N=`src/n/`, fm=`src/m/a.ts`,
   Q1/Q2 real user-initiated root QueryJobs of Goal B, U1/U2 their candidates (§5.1).
8. **Do not invent.** If the spec does not determine something a case needs, or a row cannot be built with a legal
   history, do not invent behaviour: write the case as close to the row as the spec allows and list the point
   under UNDETERMINED (case id, what is missing, spec line).

## Your final answer (in English, the -o file)

- FILES: each file you changed or created.
- PER CASE: one line per case id of your group: REWRITTEN / KEPT, in a few words how the given is now built
  (which entries), and which part-1 stub the case is expected to hit first (or "passes in part 1" with the
  reason; a case describing new behaviour should normally not pass in part 1).
- FINDINGS: for each finding in your group file: DONE / NOT DONE (why).
- UNDETERMINED: see rule 8.
- RISKS: any setup step you are not sure passes today with the existing code (file:line), so the lead checks it.
