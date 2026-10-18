# Task: K3 group 3, session 2 — make the review round really run, the session-1 review's findings, K3-05; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, with **at most 3 subagents at once** (files of running subagents
disjoint; every vitest command `--maxWorkers=2`). Subagents write all code and tests; you split, brief, check and
reply. **Finish within 200 minutes** (the run stops at 210, with a handoff if needed). Finish whole items in the order
of section 4; an unfinished item is reported, not half-done.

## 1. What this copy is

- Tags: `k3-g2c` = end of group 2; `k3-g3a` (HEAD) = group 3 session 1, committed by the lead. Your session-1 reply is
  `./.dsh-ref/k3-g3a-final.md`.
- The group-3 book `./.dsh-ref/k3-g3-impl.md` stays binding: sections 4 (scope), 5 (rulings U4, U5), 6 (rules),
  8 (checks), 10 (answers). This book adds section 3 and the order; where they differ, this book wins.
- Codex reviewed session 1 read-only (`./.dsh-ref/k3g3a-review.out.md`, Chinese). Two Claude subagents verified every
  finding in the code (`./.dsh-ref/g3a-v1.md`, `./.dsh-ref/g3a-v2.md`, with file:line evidence and the recommended
  fixes). **Section 3 is the lead's ruling; where it differs from Codex or the verifiers, section 3 wins.**
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`. The TDD skill: `./.dsh-ref/tdd/`.
- Lead check of session 1 with bubblewrap: 83 files, 4,271 passed, 1 failed (`K3-R1-second-cleanup`, item H).

**Why this session matters:** in session 1 no real review round can run. The settlement request is refused, the
instruction section fails validation, production `reviewCapability` is always `unavailable`, and four admission checks
refuse the round's fixed tools. The tests stayed green because they stub the owner or stop at `prepare`. Every fix
below gets a test through the real chain where section 3 says so.

## 2. Rulings and post-notes (binding)

- **R1 — the review instruction is its own section** (L13 "任务段之后加一段核对说明"): a new context section name
  `unknown_call_review`, last in the section order, legal only for `callKind: 'work'`; the call stays `work` (L10: a
  Work Run). Not `continuation`, not `review` (that is the verifier's call kind).
- **R2 — "钉进 inputBinding 的摘要" means the binding's existing digests:** `manifestDigest` pins the structured copy,
  `inputDigest` the rendered text, and entry re-renders the structured copy and checks it against the section. No new
  `inputBinding` field.
- **R3 — `reviewCapability` takes the Role** (a §2 signature change): `reviewCapability(ctx, { workspace, role })`, with
  `role` = the binding's `sessionRole` that the round's prepare and start will use. Implemented through the same binding
  lookup as today's Work Run (`runtime-configuration.ts` `bind(scope, role)`), with the per-workspace switch narrowing;
  it never resolves the model (a missing API key must not settle a record as `review_unavailable`). Not "the first
  binding in the workspace"; no "one binding per workspace" rule.
- **R4 — the review round's tools are admitted by purpose** (L13 "不受职责的工具上限限制" and "Host 的两层照旧要成立"):
  one L13 constant in `src/contracts/` (`read`, `run_readonly_command`, `record_unknown_call_review`; the exploration
  tools come with `read` as in every Work Run) and one pure helper keyed on the trusted `run.purpose`, used at the four
  admission points (`execution-driver.ts` ~553 and ~577, `create-platform.ts` ~442, `execution-entry-service.ts` ~595
  in `recheckHostRoleAdmission`). For a review purpose: exact tool set and `writeScope = []`; the Role is still resolved
  and must be valid, only its tool ceiling is skipped; Host layer 1 (`read` and `run_readonly_command` allowed, read
  access `all_except_denied`, after the switch narrowing) and layer 3 (current at call time) stay;
  `record_unknown_call_review` is exempt from the Host tool list.
- **R5 — K3-14's test entry split:** overwrite (two new callIds), invalid alias as a tool result, and the conclusion read
  back through `unknown-call-reviews/read` go through R2 (a scripted-model round). Replay and `idempotency_conflict`
  cannot come from a scripted model; they stay at owner level, **through the real tool adapter and the real owner, not
  a stub**.
- **Post-notes only, no change:** a file deleted during the Run and then ignored is reported `deleted` (true; nothing
  depends on it; Codex item 9 second example).

## 3. Items (binding; each production fix starts with a failing test; literal expectations; memory and SQLite for
## owner rows)

**A. Settlement can commit, once per round** (Codex 1, verified high).
- `settleReviewStep(base, review, cause)` pins `expected: [{ ref: review.ref, revision: review.revision }]`; the pin is
  part of the request, so a retry keeps its identity and the next round gets a new one. UR2 and UR4 already have the
  record.
- The `start`/`observe` branches for review Runs (two identical blocks, `workflow.ts` ~2036–2057) become one helper that
  reads the record (`unknownCallReviews.readReview`) and builds the pinned step (waits if the read fails).
- In that helper, settle on any **known** end (item C's predicate); wait only while the Run has not ended or is
  `outcome_unknown` (L10 "however it ended"; Codex 2(a)).

**B. Workflow rows per §3.4** (Codex 2(b)(c)).
- UR3a: `if (run.status === 'starting') return await isUnadmittedStarting(...) ? prepare : skip('review_round_in_flight')`.
  The `skip` branch is required (otherwise the Run falls to UR4 and the owner answers `busy`).
- When the last holder's Session is busy (`claimContinuation` → `null`), return `skip` with a new source
  `review_session_busy`, not `waiting` for the whole goal; a named task turns it into `waiting` (U4).

**C. One "known end" rule** (Codex 3).
- One pure predicate in `core/work-graph/state/review-lease.ts` (next to `isUnenteredReviewRoundForCancellation`), e.g.
  `reviewRoundEndedKnown(run)`: ended with an outcome that is not null and not `outcome_unknown`. Used by the owner
  (`settleReview` → `busy`, nothing written, when not known), the UR4/UR5 gate and item A's helper.
- `round_unfinished` only from `pending_review`/`awaiting_proposal`; otherwise `settled` (the state machine routes it to
  `settleHeld`).
- `settleHeld`'s evidence for pending items is always "核对轮没有给出结论" (UCR-08b, L16).

**D. The review round can start** (Codex 4; R1, R2).
- Move `renderUnknownCallReviewZh` into `src/contracts/` beside its type (as `renderContinuationBriefZh`), so WorkGraph
  can re-render it. Rename one of the two `UNKNOWN_CALL_REVIEW_TOOL_NAMES` exports so there is one meaning per name.
- `context-input.ts`: an optional `reviewSuffix` (default null; Query unchanged); the four trailing-section checks move
  into one helper used for both continuation and review; the review section is present exactly when `reviewSuffix` is
  not null.
- `execution-entry-service.ts`: pass the re-rendered `manifest.unknownCallReview`; refuse (`forbidden`) when "the
  manifest has the field" differs from "the Run's purpose is a review-phase round"; at ~1564 a missing review field is
  a mismatch, never a match; an unreadable manifest returns its read error.
- `execution-preparation.ts` ~414: `reviewSectionStart` is a UTF-8 byte offset — slice by bytes (or return the prefix
  string), never as a JS string index (Codex 6(a)).

**E. `reviewCapability` in production; the fixed tools at admission** (Codex 5; R3, R4).
- R3 through `workflow.ts` (`reviewGate` calls `bindingForRole` before the capability call and passes
  `binding.sessionRole`), `ports.ts`, `runtime.ts`, `RuntimeHostBindings`, `create-platform.ts` (~992 forwards it),
  `runtime-configuration.ts` (implements it), `host.ts` and `host-settings.ts` (forward it; `host-settings` to
  `current`).
- R4 at the four admission points.
- Test through the real local Host (`createLocalWorkbenchHost`/`HostScenario`): with the read-only command enabled for
  the workspace, `reviewCapability` is `available`; switched off → `unavailable`; a Role whose tools are only
  `read`/`shell`/`edit` can still start a review round.

**F. L13 input** (Codex 6(b)(c)): the changed paths are the first 200 from the full capture (the existing
`readReviewCaptureChanges`; fall back to the sample only when the full one is not readable); cwd is cut to 4 KiB first
and the command gets the rest of the per-command 4 KiB.

**G. Smaller fixes.**
- Codex 7: the tool adapter drops its pre-read of the record; when no record pin is given, the owner reads and guards
  the current revision itself after the receipt check (L14 order); keep the Run guard; one retry on a real
  `revision_conflict`.
- Codex 8: `listReviews` reads a bounded page per status tuple after the refKey cursor (`lookup({ index, values, after,
  limit })`), merges and sorts, takes `limit`; `nextCursor` = the last refKey when there is more; all tuples'
  `readThrough` must be equal (retry the page a few times, then `not_ready`). No total cap (L7); drop
  `LOOKUP_MAX_PAGES`.
- Codex 9(a): after the containment check in `continuation-diff-reads.ts`, run the protection rule again on the real
  path relative to the real root; a protected real path is `protected`.
- Codex 9(c): `workspace-baseline-artifact.ts` catches a baseline read/parse error locally and keeps the manifest
  (baseline null); `create-platform.ts` ~1577 reports `runBaselineKnown` from whether the baseline was read.
- The codec accepts only a sha256 `argumentsDigest` (L7); move K3-48 (二)'s near-threshold fixture onto a legal input
  (K3-48 (一)'s long-command builder).
- Cleanups (decision 75: clean, readable): one helper for the two identical history-boundary scans in
  `context-assembler.ts` (~958 and ~1009); the settlement reads each round's displays once (a per-round
  `alias → display` map) instead of once per item.

**H. `K3-R1-second-cleanup` (L11, L23 example 1).** The only existing assertion change in this session. Keep everything
up to A's RUN-25 and the assertions at ~175 and ~190 exactly. Insert, before B is claimed:
1. assert A's record is `pending_review` through `unknown-call-reviews/read`;
2. advance and stop before the **review round's** `start`;
3. start that round with a scripted model that calls `record_unknown_call_review { item: 1, verdict: 'done', evidence,
   crashSuspicion: { verdict: 'unlikely', evidence } }` and ends (`completed`);
4. advance: `settle_review` → `resolved` (assert the status and empty `decisionReasons`), then the automatic requeue
   claims and prepares B; stop before B's start;
5. the rest unchanged.

The scenario Host needs the read-only command capability available (the KE6-style probe stand-in); without it UR2
settles `review_unavailable` → `needs_decision`, which needs group 4.

**I. Tests that prove the real chain** (Codex 10).
- **K3-05** (blocked in session 1): end to end through R2 — RUN-25 or the attestation entry → `workflow.advanceWork` →
  the review round starts with a scripted model → `record_unknown_call_review` → the round ends → `settle_review`
  commits; read the result through `unknown-call-reviews/read`.
- **K3-10:** keep the 12 literal cells at owner level, and add them as R2 runs (parameterise the scripted tool call).
- **K3-12:** in a started round, assert the tool names in the scripted provider's request, the empty write scope, and a
  write attempt through `run_readonly_command` failing with the mapped error.
- **K3-14:** per R5.
- **K3-48 (二):** one R2 case (capacity as the tool result).
- **K3-47 (三):** settle the record to `resolved` (enter, record done/unlikely, end, settle) before the requeue.
- **Rework 9(a), decision tool:** commit with the hand-rolled id, then look up through the production default table
  (`createToolCommitLookup` as composed) with a Host ctx: committed, and changed arguments → `idempotency_conflict`.

## 4. Order (suggested; you decide the briefs, files disjoint, at most 3 at once)

1. Wave 1, three subagents on disjoint files:
   - (W) Workflow and the review owner: A, B, C (`business/workflow/`, `unknown-call-review-service.ts`,
     `state/review-lease.ts`, `state/unknown-call-review.ts`);
   - (R) Runtime context and entry: D and F (`context-assembler.ts`, `context-input.ts`, `execution-entry-service.ts`,
     `execution-preparation.ts`, the contracts renderer);
   - (H) Host and admission: E (`runtime-configuration.ts`, `host.ts`, `host-settings.ts`, `ports.ts`, `runtime.ts`,
     `create-platform.ts`, `execution-driver.ts`, the contracts tool constant). E and D both touch
     `execution-entry-service.ts` (~595 vs ~1141/~1564): give that file to (R) and have (H) hand its one-line call to
     (R) through the shared helper, or run them one after the other — your choice, files must stay disjoint.
2. Wave 2: G (split by file), then K3-05 end to end (it proves A–F together).
3. Wave 3: H and the I rows.
4. Close-out: the checks of `k3-g3-impl.md` section 8 with `--maxWorkers=2`, one subagent.

The remaining rows K3-06, K3-11, K3-13, K3-19 (一), K3-35 (一), K3-37, K3-42, K3-45 (一) are **session 3**; do not
start them.

## 5. Reply

Under 900 words: FILES CHANGED (production / tests, production line count; session 1 was +2,578/−308); each item A–I:
done or not, RED → GREEN; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at
once); anything surprising.
