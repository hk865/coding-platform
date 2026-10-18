# Task: K3 group 3 — the review record owner, the review round, settlement, the Workflow rows for rounds (R2 first half); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it. Subagents write all code and tests; you split, brief, check and
reply. **Finish within 200 minutes** (the run stops at 210, with a handoff if needed). Finish whole items; an
unfinished item is reported, not half-done.

## 1. What this copy is

- Tags: `k3-g1` = group 1; `k3-g2a`, `k3-g2b`, `k3-g2c` (HEAD) = group 2 parts 1–3, committed by the lead.
- Replies: `./.dsh-ref/k3-g2a-reply.md`, `k3-g2b-reply.md`, `k3-g2c-reply.md` (names, seams, gaps).
- Group 2's books `./.dsh-ref/k3-g2-impl.md` (section 8), `k3-g2-impl-2.md`, `k3-g2-impl-3.md` stay binding where they
  name things this group uses (the seams, the record codec and read, the store-wrapper seam, `unresolvedCalls`).
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`. Read only the lines named below.
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Lead checks on group 2 (with bubblewrap, outside your sandbox)

- 28 files (A8-host-restart*, every `K3-*.test.ts`, WP1-continuation-handover, S1-archive-flow,
  S2B-be2-late-evidence-activity, A2-reconcile-runtime, WP2-wiring, WP2-undelivered-notices): 227 passed, 1 skipped
  (A2's `review_round`, which is yours, item 6 below).
- The Codex review of group 2 and the lead's rework rulings are section 3. Do them first.

## 3. Rework from the group-2 review (binding; do first)

Codex reviewed group 2 read-only ("先改完列出的几处"); two Claude subagents verified every item against the code. The
lead's rulings below are binding. Production first, each with a failing test first; about 80 production lines and
150 test lines in all.

1. **Tool commit lookup dispatch stops at the first owner.** `src/composition/tool-commit-lookup.ts:16-19` skips an
   owner only on `lookup_not_published`, but owners answer `unknown_tool: …` (`tool-commit-arguments.ts:152-154`), and
   the mailbox is first (`create-platform.ts:1498-1500`), so `propose_future_plan` and `record_decision_application`
   never reach their owners. **Fix:** dispatch by tool name through a fixed table (the four mailbox tools → mailbox;
   `record_decision_application` → decision; `propose_future_plan` → plan; any other name → `lookup_not_published`).
   Do not match on the `unknown_tool:` text. (k3-g2-impl.md §8 Q2 already said "by `toolName`".)
2. **One request-id algorithm for execution and every owner.** The real path (`execution-driver.ts:455,464-467`)
   hashes a plain `{projectId, sessionId}` Session ref; the draft passes the record's aggregate ref with
   `aggregateType` (`unknown-call-draft.ts:152`); the decision lookup hashes its raw input (`decision-service.ts:1194`);
   the plan lookup's actor id hashes the aggregate ref too (`plan-service.ts:2287-2289`, real writer
   `plan-write-admission.ts:208-214`). Result: a committed call is read back as `not_committed` ("没做").
   **Fix:** (a) the draft's origin Session is the claim Session `record.outbox.claim.sessionRef`, reduced to
   `{projectId, sessionId}` (L4); (b) `toolCommitRequestId` picks its fields explicitly (runRef's 4 fields, sessionRef's
   2) and `execution-driver.ts` calls it instead of its own copy; (c) one `agentActorOf(sessionRef, runRef)` helper used
   by `plan-write-admission.ts` and `plan-service.ts`; (d) the decision tool's fingerprint and its lookup pick the same
   fields of the message ref. This is the shared request builder of decision 72 (U1); 4C's `record_note` joins it when
   the two slices meet.
3. **RUN-22 owner: L8's draft checks.** `validatedReviewDraft` (`run-reconcile-service.ts:199-256`) lacks three of
   L8's checks (spec 284–289). **Fix:** pass the Run's facts in (`facts.run.reconciliation?.observation` and the
   recorded `unresolvedToolCallIds`, as `runStateOf` reads them) and add: observation reason `kernel_unreadable` ⇒
   inventory must be `incomplete`; `complete` ⇒ every recorded id is among the items; `too_large` ⇒ every listed item
   is a recorded id and the rest are counted in `itemsOmitted`. Mismatch → `invalid`, nothing written. One owner-level
   case per check (K3-26's family, R4-owner).
4. **`streakOf` throws the walk away at the reset point** (`task-failure.ts:589-600`; L23 spec 621–626: walk back to
   the reset point, excluding it, and judge the Runs between). Sequence X yielded → A (RUN-25) → B gives
   `priorAutoCleanup: false` today, so G9 lets B auto-clean a second time. **Fix:** at the reset point set
   `resetRunRef` to it, stop, and compute both flags from the Runs already collected. Add the K3-32 case
   X `runtime_terminal` → A RUN-25 → B: `priorAutoCleanup: true`, `resetRunRef` = X. Existing K3-32 cases stay green.
5. **L6 reads follow symlinks.** `context-assembler.ts:676-679` checks the path text; `continuation-diff-reads.ts:85-93`
   then follows links (`stat`, `readFile`). **Fix:** before reading the current file: `lstat` — a symlink (final
   component) is status only with reason `not_text` (L6: "现在是文本文件"); the real path must be inside the real
   workspace root; the protected check runs on the normalised workspace-relative path (so `./.env` is `protected`),
   with the Host's denied prefixes passed into WorkspaceTools. Reading through the Kernel `WorkspaceSandbox` instead is
   acceptable if it is no larger. One test: an edit path that is a symlink to a protected file at prepare time → status
   only, no bytes of the target anywhere in the note.
6. **L6 states unknown facts as facts.**
   - (a) `changeOf` (`continuation-brief-assembly.ts:225-233`) searches only the capture's 50-entry sample. **Fix:**
     classify from the full capture Artifact (`captureRef`, read like `readRunStartBaseline`). If the Artifact cannot
     be read and the path is not in the sample while `changedCount > sample.length`: the change is a new value
     `'unknown'`, rendered `不知道`; the diff rule is unchanged (it depends on the start baseline, not the capture).
     Add `'unknown'` to the contract, codec and renderer lists.
   - (b) `context-assembler.ts:752-756`: any path with a baseline entry (`present` dirty, or `deleted`) is status only
     with `diffOmittedReason: 'baseline_dirty'`; never read `HEAD:<path>` or a baseline blob for it (L6, spec 220).
7. **L5: a file ignored at capture time is not compared.** The walk skips ignored names
   (`workspace-change-capture.ts:165-166`) but the comparison (`:289-307`) records them `deleted`. **Fix:** the capture
   excludes paths ignored by the rules in force at capture time from the comparison on both sides; they appear only in
   `notVisible`. A change to the rules shows as the rule file's own change (`.gitignore` `modified`) — this is the
   lead's reading of "规则本身变了，按变了的路径报" (spec post-note at merge). One case on the git workspace seam.
8. **G11 must short-circuit** (L25 spec 687; KR1 1333). `run-reconcile.ts:470-475` builds the full draft (capture,
   capture Artifact write, owner lookups) before checking the inventory. **Fix:** a pure inventory check first (export
   it from `unknown-call-draft.ts`); then capture once and check G8; then the owner lookups last, reusing that capture.
   A Turn that fails G11 does no capture, writes no Artifact, makes no lookup. Assert it in the 33-call case with
   counting stand-ins (calls counted, not contents).
9. **Tests weaker than their rows.**
   - (a) K3-39: the expected identities are computed with the code under test (`toolCommitRequestId`, test `:58,97,165`;
     also `S5R2-agent-application.test.ts:361`). **Fix:** per owner, use the production origin shape (claim Session,
     Host ctx); one case per tool name through `createToolCommitLookup`; and one frozen, hand-computed literal request
     id for one fixed input, so a change to the algorithm fails.
   - (b) K3-R1 tests read SQLite: `manifestOf` (`tests/scenarios/support/brief.ts:97-101`, at
     `K3-R1-restart-flows.test.ts:139,187` and `K3-R1-file-change.test.ts:190`) and `h.ledgerEventTypes()` (`:183`,
     `:213`). **Fix:** read the prepared note through `materials/open` and "sent once" through `messages/inbox` /
     `messages/outbox`. Leave the older C3 users of `brief.ts` alone. If no public read can open the prepared note,
     report it with file:line; do not add a route.
   - (b′) K3-01: assert the close target (`steps[].next` of `close_open_turn` carries `afterRunRef` = the old Run) and
     that the receipt has `cursor` and `eventIds`.
   - (c) K3-04: two in-flight edits cannot occur (the real `edit` is `workspace_write`, not independent;
     `edit-tool.js:118-128`). **Fix:** two R1 cases, `replace` and `create`, each with a stand-in that keeps the real
     class and capabilities and only blocks. Keep the two-entry case, renamed as an injection example (not R1). The
     lead post-notes the K3-04 row at merge.
10. **Dedupe (Codex suggestion, accepted):** the start-baseline Artifact read/decode/degrade is written twice
    (`context-assembler.ts:695`, `create-platform.ts:1528`); make it one function. (The request-id copy goes in item 2.)

Not changed (Codex agreed with the agent): `<headCommit>:<path>` via `cat-file blob`; the `shell-work-root` helper; no
test for an applied pause with a call in flight (the state machine refuses it, `run-machine.ts:2110`).

## 4. Scope of group 3 (spec §7 item 3, and the split below)

Spec lines to read: §1 C and D, **L7 (226–265), L9 (291–304), L10 (305–323), L11 (324–339), L12 (340–350),
L13 (351–374), L14 (375–383), L15 (384–398), L16 (399–410), L17 (411–423)**; L29 (740–759) for the crash rows of what
you build; §2 the ports and tools (1072–1110, 1160–1215); §3.1 (1231–1247: TASK-03r, RUN-01r, ATT-16r, RUN-02's new
line, RUN-09 for review Runs); §3.2 (1248–1275); §3.4 (1305–1328); §5.2 rows **K3-05, K3-06 (1412–1413), K3-10..K3-14
(1424–1428), K3-19 (1433), K3-35 (一) (1435), K3-37 (1436), K3-42 (1437), K3-45 (1438), K3-47 (三)(四) (1465),
K3-48 (二) (1440)**; §6 for the files.

1. **The review record owner, writes** (`tasks/unknown-call-review-service.ts`): `recordConclusion` (UCR-04),
   `settleReview` with `round_ended` and `review_unavailable` (UCR-06, UCR-06b, UCR-07; it reads the round's Run and
   pointer and the prepared manifest for `display`, L15, L16), the review claim's record write (UCR-03 in the TASK-03r
   commit), and the read `listReviews` with the route `unknown-call-reviews/list`. The M3 admission (L7: optional model
   text that would take the record over 512 KiB − R → `capacity`, nothing written; settlement always admitted).
2. **The review claim** (TASK-03r, RUN-01r, ATT-16r; `review` basis with `afterRunRef = lastHolderOf(record)`), RUN-02's
   new line for review Runs, and `leaseReleasedForContinuation` in the three places §2 names (group 1 wrote the pure
   function; wire it).
3. **The review round in Runtime:** purpose `review` (L10); its preparation (L13: tools exactly the L13 list, empty write
   scope, `sessionBasis`, the review instruction measured over the whole inventory and trimmed from the back in L13's
   order, no callId in it, `display: 'truncated'` lines for commands over 4 KiB, D6); the context-assembler section; the
   tool `record_unknown_call_review` (new `agent-runtime/unknown-call-review-tools.ts`, L14: Run from `ctx.principal`,
   items by alias, replay and `idempotency_conflict`); the review round's own end (L15: no recursive review);
   `reviewCapability` (L13; see ruling U5 in section 5).
4. **Workflow rows for rounds** (§3.4): **UR0, UR1, UR2, UR3, UR3a, UR4, UR5, UR9**, `performStep`'s `start`/`observe`
   for review Runs (→ `settle_review{round_ended}`, never `open_checks`, never `afterNotNormalEnd`, L10),
   `create_session{review}`, `close_open_turn` with `afterRunRef = lastHolderOf(record)` (L12), the WorkflowCalls member
   `settle_review`. See ruling U4 in section 5.
5. **Rows:** K3-05, K3-06, K3-10, K3-11, K3-12, K3-13, K3-14, K3-19 (一), K3-35 (一), K3-37, K3-42, K3-45 (一),
   K3-47 (三)(四), K3-48 (二) for `record_unknown_call_review` only. Where a row also asserts a card ("出卡"), the
   proposal phase or a disposition, assert the record (state, `decisionReasons` in L17's order, items) through
   `unknown-call-reviews/read` and leave the card/proposal part for group 4; list which parts you left.
6. **A2's skipped `review_round` case** (`tests/runtime/A2-reconcile-runtime.test.ts`): unskip it now that a public path
   to a review-purpose Run exists, as K3-21's row writes it.
7. **Not in group 3 (group 4):** cards (L18) and the `unknown_call_review` card source; dispositions and approvals
   (`applyDisposition`, UCR-09..UCR-13, L19); safer methods (`recordProposal`, `propose_safer_method`, UCR-05, UCR-08,
   UCR-08c, L20); "I'll handle it" (`holdReview`, `releaseHold`, UCR-14, UCR-15, UR3h, UR8, L21); UR6, UR7, UR7b;
   `gatePerform`, `automationConfirmation`, `cancel_review_round`; `listUnappliedAnswers` and start-up steps 2b and 6b
   (it moves to group 4 with its only user); L19a (CRR, the `shell` hook); K3-09, K3-15..K3-18, K3-20, K3-25..K3-29.

## 5. Rulings for this group (binding)

- **U4 — one task-gate result for the UR rows (decision 72).** Implement the §3.4 rows through one finite result per
  task: `pass` (go on to today's selection), `skip` (with the blocking source: record unreadable, round in flight,
  waiting for a person's attestation of the round), or a `review` step (claim/close/create for the round, or
  `settle_review`). One function serves both goal-level selection and the named-task call; for the named task a `skip`
  becomes `waiting` with the source (UR0's fail-closed text). Group 4's rows (UR6, UR7, UR7b, UR8, UR3h) will add
  values to the same result; leave the type open for them, do not build them. **Do not change `automationConfirmation`'s
  goal-wide early return (`workflow.ts:1366-1367` in this copy, `if (gated !== null) return gated;`); that is slice 7B's.** Owner commit guards stay; the Workflow check never
  replaces them.
- **U5 — one read-only command capability.** `reviewCapability` probes with exactly the options the real
  `run_readonly_command` tool uses (`readonly-command-tool.ts:249-255`). The registration/tool construction duplicated in
  `agent-runtime/execution-driver.ts` (around 840–863, `let readonlyCommandTool`) and `agent-runtime/query-execution.ts` (around 361–384, the same block) becomes one shared function
  that both call; the review round uses it too. Query keeps its own authorization choice; behaviour of existing Work and
  Query Runs does not change (their tests must stay green unchanged).
- **The review round is a Work Run, not a Query** (L10). Do not add a general "special-purpose Run" framework.
- **Expected values:** K3-10's 12 cells and K3-11's reasons are literal, in L17's fixed order, hand-computed from the
  rows.

## 6. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id; every case a row lists has an assertion. Memory and SQLite backends each once for service-level rows.
- **Entries (§5.1):** R2 = a scripted-model review Run writing conclusions and crash self-checks, driven through
  `workflow.advanceWork` from a record that RUN-25 or the attestation entry created (use group 2's seams; the
  read-only capability stand-in as K's KE6); R4-owner for K3-47 = owners through the store boundary. No reading the
  database to verify; read through `unknown-call-reviews/read` / `list`. Literal, hand-computed expectations.
- **R2 tests run inside your sandbox:** drive only until the round's Run has ended and `settle_review` has committed;
  no check may run (checks need bubblewrap). A row assertion that needs a check: leave it and report it.
- State transitions only through `src/core/work-graph/state/` (AGENTS rule 9). Production-reach allowlist: remove the
  entries your wiring now reaches; add new ones only with the reason "K3 group 3 wires it".
- §5.3: no new before/after assertions in this group. Any existing assertion that fails: do not edit it; report it
  (test id, assertion, rule, minimal counter-example).
- No real model calls, no git writes in the repository (a git workspace inside a scenario's temporary directory is
  test data), never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted at the end.
- **Line budget (decision 69):** about 1,800 new production lines (soft). Group 2 ended near 3,700 against 2,000;
  prefer reusing group 2's helpers over new ones. Report the count.

## 7. Order (suggested split; you decide the briefs, keeping files disjoint)

1. Section 3 rework first, two subagents on disjoint files: (A) items 1–4 and the request-id part of 9(a)
   (composition, WorkGraph owners, `state/task-failure.ts`); (B) items 5–8 and 10 (WorkspaceTools, agent-runtime
   assembly and reconcile). Then the test items 9(a)–(c). Report the rework's production lines separately from
   group 3's budget.
2. **Shared first:** the owner writes and the review claim (items 1–2) with K3-14, K3-47 (三)(四), K3-48 (二) at the
   owner level; and in parallel U5 (item 3's capability and the shared tool construction), which touches only
   agent-runtime files.
3. Then the round in Runtime (item 3's preparation, tool, end) and the Workflow rows (item 4, U4), on disjoint files.
4. Then the R2 flows: K3-05, K3-06, K3-10..K3-13, K3-19 (一), K3-35 (一), K3-37, K3-42, K3-45 (一), and item 6.
5. Close-out: the checks in section 8, one subagent.

## 8. Checks (close-out subagent)

- `--maxWorkers=3`: `tests/state/`, `tests/runtime/`, `tests/scenarios/A8-*.test.ts`, every `K3-*.test.ts`,
  `tests/business/WP1-continuation-handover.test.ts`, `tests/business/S1-archive-flow.test.ts`, the Workflow test files
  you touched, `tests/composition/platform.test.ts`, `tests/composition/WP2-wiring.test.ts`, `tests/architecture/`, the
  new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox. Name any other failure.
- **Do not run the full suite.**

## 9. Reply

Under 900 words:
- FILES CHANGED (production / tests / seams, with the production line count);
- section 3 items, U4, U5 and each scope item: done or not, RED → GREEN;
- the row parts left for group 4 (row id, part);
- CHECKS with numbers;
- UNSPECIFIED (short, with options);
- for each subagent: its task and its context or time if you can see it;
- anything that surprised you.

## 10. Answers to the read-through (lead, 2026-10-16 23:10; binding like the sections above)

The read-through's path corrections are accepted: `tool-commit-arguments.ts` is in `src/core/work-graph/model/`,
`unknown-call-draft.ts` in `src/core/agent-runtime/`, `decision-service.ts` in `src/core/work-graph/communication/`;
the line numbers it gave (G11 at `run-reconcile.ts:468`, `isUnadmittedStarting` at `workflow.ts:898`/`:908`, `changeOf`
at `continuation-brief-assembly.ts:227-234`, the plan actor id at `plan-service.ts:2288-2291`, the claim guards at
`claim-service.ts:1142-1160`) replace the book's.

1. **U4's type:** a local union in `workflow.ts` (no other module uses it yet), e.g.
   `TaskGate = { kind: 'pass' } | { kind: 'skip'; source: TaskGateSource } | { kind: 'review'; step: <the existing
   Workflow step value> }`. `review` is one value carrying the step (`claim_task` with basis `review`,
   `close_open_turn`, `create_session{review}`, or `settle_review`). Group 3's sources: `review_unreadable` (UR0),
   `review_round_in_flight` (UR3), `review_round_unknown` (UR5). For a named task, `skip` returns `waiting` with the
   source; UR0's text says the record cannot be read. Names may differ; the shape may not.
2. **Denied prefixes (§3 item 5):** keep `WORKSPACE_DENIED_PREFIXES` (the capture uses the same constant,
   `create-platform.ts:1553`); add `lstat`, the realpath containment and the check on the normalised path. Do not plumb
   Host configuration.
3. **Precedence:** protection first — a protected path (normalised) is `protected` and is never opened or `lstat`ed;
   then a symlink is `not_text`.
4. **9(b):** yes, read the prepared note through `executions/brief` (`core-routes.ts:379`); assert on its `brief`.
5. **`settleReview`'s reads:** extend `UnknownCallReviewServiceDependencies` with the read ports it needs (the round's
   Run and pointer, the prepared manifest); the composition root wires them. The owner reads them itself and guards
   what it read in the commit.
6. **§3 item 3:** keep `validatedReviewDraft` pure; `runStateOf` computes a `reviewFacts` argument (observation reason,
   recorded `unresolvedToolCallIds`) and passes it in.
7. **9(a)'s literal:** after item 2's fix, compute the request id once for K3-39's claim-Session / run / tool / callId
   tuple, freeze the hex literal in the test, and write the input in a comment. The test fails if the algorithm drifts.
8. **§4 item 2:** wire `leaseReleasedForContinuation` into `claim-service.ts:269` and `requeue-service.ts:854` (the
   read-through found `attempt-machine.ts:767` already done).
9. **WP1 fixture (§5.3, spec 1514):** if group 3's L11 gate makes `attestedStop` → `f.requeue()` fail, apply §5.3's
   change now: the fixture calls `holdReview` and then `releaseHold` as the person. In that case build those two owner
   methods (UCR-14, UCR-15; the state rows exist) in this group; their routes, UR3h and UR8 stay in group 4. Never edit
   a WP1 assertion; list any HO test whose note text changes.
10. **Time: this group runs as two sessions.** This session: section 3 (all), §4 items 1–4 and 6, U4, U5, and the R2
    rows K3-05, K3-10, K3-12, K3-14, K3-47 (三)(四), K3-48 (二) — in that order of priority. Stop there and report.
    A second session (new book from the lead) does K3-06, K3-11, K3-13, K3-19 (一), K3-35 (一), K3-37, K3-42,
    K3-45 (一). Do not rush rows to fit; an unstarted row is not a failure.
