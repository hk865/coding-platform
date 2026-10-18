# Task: K3 group 2 — test seams, takeover proof, start baseline and capture, classifier, RUN-25, recognition entry (R1 end part, R3); test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec and the
lead's rulings are binding; do not make design decisions. Where they do not determine something, choose nothing: list
it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** You may start subagents (at most 2 at a time, on
separate files). Stay in your turn until every subagent has reported (wait with `sleep 300`, then `list_agents`).
**Keep your context small:** `grep -n`, `sed -n a,bp`, `git diff --stat`; never print whole files or whole diffs (the
spec is ~1,770 lines; the first group's session ran out of context by reading too much). **Finish within 200 minutes**
(the run stops at 210); finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch `6f900eaa` (K3 spec frozen, eighth draft); `slice-base` adds `DSH-BASELINE.md`;
  tag `k3-g1` = K3 group 1 (contracts, state modules, pure functions, R5 tests), lead-checked.
- K3 is built in four groups (spec §7). **This is group 2.**

## 2. Inputs

- **Binding:** the K3 spec `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`: §1 the rules your rows
  cite (A: L1, L2, L4, L5, L8; B: L3, L6, L7, L25; F: the start-up steps), §2 types (use the names), §3.1 RUN-25, §3.5,
  §5.1 (entries R1, R3, R4-owner, and **the fixture seams**), §5.2 rows **K3-01, K3-02, K3-03, K3-04, K3-21, K3-22,
  K3-23, K3-24, K3-26 (七)(八)(九), K3-35 (四), K3-39, K3-40, K3-47 (一), K3-48 (一)**, §5.3 rows that touch what you
  build (A2-reconcile-runtime W-13/RUN-21, A8-host-restart A8-3j/A8-3f/A8-3g, A8-host-restart-attestation, A8-2b,
  IT26, WP1/WP2 fixtures: their before/after assertions are written in §5.3 — apply exactly those), §6, §7 group 2.
- The first group's books `./.dsh-ref/k3-g1-impl.md` (section 8) and `./.dsh-ref/k3-g1-impl-2.md`, and its reply
  (`./.dsh-ref/k3-g1-reply.md`) for the names it added (e.g. the `RunGuardContext` fields `takeoverProof`,
  `sessionClosable`, `priorAutoCleanup`, `priorUnknownProcess`, `streakResetRunRef`; the candidate's `unresolvedCalls`).
- The TDD skill: `./.dsh-ref/tdd/`.

## 3. Scope of group 2 (spec §7 item 2, plus)

1. **Test seams first (spec §5.1 "夹具的接缝"; decision 56 as amended on 10-14: DeepSeek writes them, the lead and Codex
   review them).** Exactly the seams your rows need: the stand-in `shell` (`vi.hoisted` + `vi.mock` of
   `createShellToolDefinition`, a switchable blocking handler, name `shell`, `effectClass` `process`, no
   `isolated_process`; off = the real one), the read-only command capability stand-in (as K's KE6), the store wrapper
   that fails the next `lookupCommit` once (`HostScenario.start` option, `wrapRecords` style), the git workspace option
   (`HostScenario.open`: `git init`, commit initial files, one file under a denied prefix), long commands and long ids,
   the person-stopped original Run (K3-41's setup), the crash points. Put them under `tests/helpers/` or
   `tests/scenarios/support/`. They must only drive public paths; no database reads to verify.
2. **Production:** the takeover proof (`HostInstanceFacts.takeover`, HL-03 lease file), the start baseline and workspace
   change capture (new `src/core/workspace/workspace-change-capture.ts`, L5), the classifier (L3 kinds, L25 guards in
   order, `autoCleanup` with `blockedBy`), RUN-25 committed through the owner (`reconcileRun`), the recognition entry
   (`executions/resolve-unknown`'s inventory draft, L8), the start-up steps this group owns (F), and the files §6 names
   for them (`run-reconcile-service.ts`, `run-reconcile-contracts.ts`, `startup-reconcile.ts`, `host-instance-lease.ts`,
   `host.ts`, `create-platform.ts`, `reconcile-reads.ts` as far as these rows need).
3. **Two items left from group 1 (lead rulings):**
   - K3-38's ordinary claim (`first`, `requeue`) when the selected Run's review record is not yet settled → `busy`,
     `unknown_call_review_pending`: add the review-status fact to the claim facts and the guard in the state machine;
     test it in R5 (pure) and in K3-47 (owner).
   - TASK-03's `requeueClaimProblem` uses `leaseReleasedForContinuation` via `ClaimRequeueFacts.leaseRelease` (not the
     old boolean); the owner fills `leaseRelease`.
   - K3-34's comparison of L3's table with `BUILTIN_TOOL_NAMES`, `RESERVED_TOOL_NAMES` and `EXPLORATION_TOOL_NAMES`
     (group 1 could not import them): add it.
4. **Not in group 2:** the review record owner and tools, the review round and settlement (group 3); cards,
   dispositions, safer methods, "I'll handle it", the Workflow gate, the CRR owner, the `shell` hook (group 4).

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id; every case a row lists has an assertion. Memory and SQLite backends each once for service-level rows.
- **Entries as §5.1 says:** R1 = business flow with the scenario Host (`restart({ crash: true })`, real SQLite and lease
  file, `workflow.advanceWork`); R3 = the classifier fed through the hand-written dependencies as in
  `tests/runtime/A2-reconcile-runtime.test.ts:95-98`; R4-owner = owners called directly through the store boundary.
  No reading the database to verify. Expected values literal and hand-computed.
- **§5.3 changes:** apply exactly the before/after assertions §5.3 writes for the tests listed in section 2; any other
  existing assertion that fails: do not edit it; report it under UNSPECIFIED (test id, assertion, rule, minimal
  counter-example).
- State transitions only through `src/core/work-graph/state/` (AGENTS rule 9). Production-reach allowlist: remove the
  entries your wiring now reaches; add new ones only with the reason "K3 group N wires it".
- No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted at the end.
- **Line budget (decision 69):** about 2,000 new production lines (soft); report the actual count.

## 5. Order and priority

1. Seams (item 1) with a tiny self-test each (the stand-in `shell` blocks and releases; the store wrapper fails once).
2. Takeover proof and the K3-47 (一) owner assertion; the two group-1 leftovers.
3. Start baseline and capture with K3-40; classifier with K3-21 … K3-24 (R3).
4. RUN-25 through the owner and the recognition entry with K3-26 (七)(八)(九), K3-39, K3-48 (一), K3-35 (四).
5. The R1 flows K3-01 … K3-04 and the §5.3 changes.

When time runs short: finish 1–4; leave 5 and report it.

## 6. Checks (the machine is shared with another DSH run: keep it light)

- While working: only the files you touch, `--maxWorkers=2`.
- At the end, once: `tests/state/`, `tests/runtime/`, `tests/scenarios/A8-*.test.ts`, `tests/app/A2-host-instance-lease.test.ts`,
  `tests/business/S1-archive-flow.test.ts`, `tests/composition/platform.test.ts`, `tests/architecture/`, your new test
  files, with `--maxWorkers=3`; then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- **Do not run the full suite.**

## 7. Reply

Under 900 words: FILES CHANGED (production / tests / seams, with the new production line count); per row done or not,
RED → GREEN; the §5.3 changes made; CHECKS with numbers; UNSPECIFIED (short, with options); anything that surprised you.

## 8. Answers to the read-through (lead, 2026-10-16 19:30; binding like the sections above)

- **Q1 candidate shape:** (a). `AutoCleanupCandidateV1.unresolvedCalls` stays as group 1 added it (group-1 book U1 is
  binding); §2 is stale on this point (lead post-notes it at merge). The machine recomputes kinds from
  `unresolvedCalls` names (G3), not from `draft.items` (items can be cut by the creation budget).
- **Q2 `lookupToolCommit` home:**
  - Type `ToolCommitLookup` (the §2 signature, lines 1065–1069) goes in `src/contracts/unknown-call-review.ts`.
  - Each L3 row-4 owner that exists today publishes an optional read-only `lookupToolCommit` of that type:
    - `mailbox-service.ts`: `send_session_message`, `ack_session_message`, `respond_session_message` (K3-01..03
      need it);
    - the slice-5 owner of `send_user_message`;
    - `decision-service.ts`: `record_decision_application`, using L4's `applicationIdentity` with the sender taken
      from the origin;
    - the whiteboard owner: `propose_future_plan`.

    `request_command_rerun`'s lookup is group 4.
  - The Runtime side gets ONE dependency `lookupToolCommit?: ToolCommitLookup`, for the classifier deps and the Host
    entry.
    - It is built in `create-platform.ts` as a dispatch by `toolName` over the owners. A small helper file
      `src/composition/tool-commit-lookup.ts` is allowed if `create-platform.ts` would grow by more than ~40 lines;
      report it.
    - A row-4 name with no published owner method → `{ status: 'undetermined', reason: 'lookup_not_published' }`.
  - The dependency is not a guard. When it is not wired, every `platform` item gets `undetermined` with evidence
    `{ kind: 'lookup_failed', reason: 'lookup_not_wired' }` (no `blockedBy`).
  - The "arguments → owner request" step is extracted from `communication-tools.ts` / `whiteboard-tools.ts` into pure
    functions that the tool handler and the lookup share (L4).
- **Q3 who builds the draft:** (a), with one shared Runtime function.
  - **The function.** New `src/core/agent-runtime/unknown-call-draft.ts` exports
    `readUnknownCallReviewDraft(deps, ctx, input)`. The classifier (RUN-25 candidate) and the Host entry
    (`create-platform.ts` `resolveUnknownRun`, RUN-22) both call it.
    - Input: the Run record and the Kernel facts already read: whether the Turn was found; the unresolved calls with
      name, arguments, callId and positions; the RUN-20(ii) history.
    - Deps: `{ lookupToolCommit?, captureWorkspace? }`.
    - Returns the **untruncated** draft:
      - inventory and problem per L8, except `too_large`;
      - items with alias, `kind` and `contained` from `state/unknown-call-kinds.ts`, the `kernel` ref,
        `argumentsDigest`, `summary`, `startedAt`, and `observed`: `read_only` → `no_review_needed`; `platform` → from
        the lookup; `file_edit` → `compare_in_continuation`; `process` → `pending`;
      - `workspace` from the capture.
  - **The creation-budget cut happens in WorkGraph,** in group 1's `newUnknownCallReview` /
    `truncateUnknownCallReviewItems` (→ `incomplete/too_large`, `itemsOmitted`).
    - The owner order: check the receipt; validate the draft per L8, including L8's rule for a draft that already
      arrives as `too_large` from a direct owner caller; construct.
    - The Runtime never truncates (lead post-notes L8's wording at merge).
  - **`captureWorkspace?(ctx: CoreCallContext, input: { workspaceId: string; bundleRef: ArtifactRef }): Promise<WorkspaceCaptureV1>`.**
    The implementation is wired in `create-platform.ts`. It:
    - reads the prepared manifest at `bundleRef` and takes its `workspaceBaseline` (absent or `unavailable` → compare
      with the current HEAD, `runBaselineKnown: false`);
    - resolves the workspace root and `deniedPrefixes` from the Host configuration;
    - runs the new traversal;
    - writes the capture Artifact;
    - returns `WorkspaceCaptureV1`.

    Not wired → the Runtime uses
    `{ status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'capture not wired' }`.
  - **G8 mapping in the classifier:** `unavailable` → `workspace_<reason>`; `captured` with
    `runBaselineKnown: false` → `no_baseline`.
  - **`turnClosureSupport`:** exactly §2 (lines 1169–1170), on `RuntimeExecutionPort`; the classifier calls the same
    check.
- **Q4 streak (G9) in group 2:** (a). Hard-coding is not allowed. `run-reconcile-service.ts` (RUN-25 and RUN-22):
  - walks the chain as `task-failure.ts:chainRunIds` does;
  - reads the chain Runs, and their records by key. The `UnknownCallReviewRef` is `{ projectId, goalId, runId }`, so
    this is a direct key read through the new codec; an absent key means no record;
  - computes with group 1's pure `streakOf(run, runs, reviews)` and fills `priorAutoCleanup`, `priorUnknownProcess`
    and `streakResetRunRef`;
  - puts every Run and record it read into the commit as version guards; an absent record key is guarded as absent.

  A read failure → `unavailable`, no write (the report line is `failed`).
- **Q5 G7:** (a). In `run-reconcile-service.ts`, reuse `createSessionFactsService({ records }).readSessionFacts` (as
  `claim-service.ts:696` does); no new port. G7 holds only when all three hold:
  - `session` is active and has no archive request;
  - `continuations` is empty and `legacyPending` is false;
  - `latestWork` is this Run with the same claim generation.

  Otherwise `session_not_closable`. A read failure → `unavailable`, no write.
- **Q6 `review`:** (a). Required. Update every direct owner caller in the same item: the four §5.3 rows
  (A8-host-restart-attestation, IT26, WP1, WP2) exactly as §5.3 writes, plus S2B (below).
  - **WP1 in group 2:** only the draft. The `holdReview` / `releaseHold` steps come in group 4, together with the
    owner-level claim guard (next bullet).
  - **New §5.3 row (lead, binding): `tests/app/S2B-be2-late-evidence-activity.test.ts` 2B-14 (c) (line 172).**
    Change the input, not the assertions.
    - Why: its Run went RUN-20(i) with one unresolved call (`s2b-14-c-call`, tool `s2b-14-c-tool`, outside L3's table
      → `process`, not contained), so a literal empty draft would be false.
    - How: the test gets its draft from `readUnknownCallReviewDraft` over the restarted Host's Runtime deps (the same
      path as the Host entry; no lookup and no capture wired → workspace `not_configured`), then passes it as
      `review`.
    - Every existing assertion stays word for word.
- **Changes to section 3 item 3 (group-1 leftovers):**
  - K3-38's claim guard: group 2 adds the optional review-status fact to the claim facts and the pure guard, tested in
    R5. **The owner fills the fact in group 4,** with K3-47 (二) and WP1's hold/release. Filling it now would make
    every WP1-based HO test fail before `holdReview` exists. Until then an absent fact means "no record".
  - TASK-03's `leaseRelease` and K3-34's constant comparison: as written.
- **Record storage is group 2.** RUN-25 and RUN-22 create the record in their own commit, and R1/§5.3 assertions read
  it. Group 2 adds:
  - `tasks/unknown-call-review-codecs.ts`: the snapshot, `UnknownCallReviewChanged@1`, schema registration in the
    platform, and the two indexes `k3-ucr-by-goal-status`, `k3-ucr-by-workspace-open`;
  - in `tasks/unknown-call-review-service.ts`, the read side `readReview` (by ref and by `runRef`);
  - the Host route `unknown-call-reviews/read` (`core-routes.ts`, `core-http-types.ts`);
  - the platform key `unknownCallReviews`, with the §5.3 change to `tests/composition/platform.test.ts:56`.

  Group 3 adds the writes, `listReviews` and `listUnappliedAnswers`. The new aggregate is filtered out of
  `tests/state/invariants.ts` (`WORLD_AGGREGATE_TYPES`); the lead writes I-23 later. Do not touch the invariant files.
- **K3-03 split:** group 2 asserts the item `undetermined` (`lookup_failed`) and the record `needs_decision` with
  `undetermined`, read through the route. "出卡、没有接续" is group 4 (cards, Workflow gate); do not assert
  continuation either way now.
- **L6 in item 5:** K3-01/02/04 need the record's continuation-note section: a verdict per alias, the file-edit diff
  with its size cap, and the fixed sentence that not being listed does not prove "not done". Group 4 adds the approved
  methods and the blocked-command lines. HO tests that assert the full note text and break: do not edit; list them,
  and the lead writes the after-assertions.
- **§2 vs code drift** (line numbers, already-exported names): noted; use the code.
- **WP2-wiring F10:** if any assertion fails, do not edit it; report it.
- **Time:** your order is accepted, with subagents A (capture + baseline + K3-40 + K3-35 (四)) and B (owner lookups +
  K3-39) as you planned, at most 2 at once. **Finish within 200 minutes** (the run stops at 210). Item 5 may be left
  and reported; the lead will run a continuation session for it.
