# Task: K3 group 4, session A — the gate everywhere (L11), "I'll handle it" without a card (L21), restart recovery without answers (L28, L29), the A parts of the group-4 rows; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, with **at most 3 subagents at once** (files of running subagents
disjoint; every vitest command `--maxWorkers=2`). Subagents write all code and tests; you split, brief, check and
reply. **Finish within 280 minutes** (the run stops at 290, with a handoff if needed; section 8). Finish whole items; an
unfinished item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch after 8A and 4C-2 session A merged, with K3 groups 1–3 on top (rebased; the lead
  resolved six both-sides-added conflicts and typechecked). `slice-base` adds `DSH-BASELINE.md`.
- What groups 1–3 built and left: `./.dsh-ref/k3-g2a-final.md` … `./.dsh-ref/k3-g3f-final.md` (DSH replies, in order).
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (frozen). Read only what each item
  names: §1 L11, L12, L21, L22, L28, L29; §2 for the names; §3.3, §3.4, §3.5; §5.2 rows.
- Code facts Codex checked on this copy: `./.dsh-ref/k3g4-facts.md` (Chinese; per row what exists with file:line, the
  A/B split, the interfaces to leave, the old tests that change, current line numbers for the spec's stale references).
  Use them.
- Group 4 is split in two sessions. **This session A** builds everything that does not need the card source, the
  decision application dispatch or the proof events (decision 72's U3/U6/U7, which slice 4C-2 session B is building
  now). **Session B** (later, after 4C-2 session B merges) builds the cards, the dispositions and answer application,
  the proposal round, the historical answers (UR7, UR7b, 6b (c) kinds 3–4), and L19a (the request tool, the `shell`
  hook, CRR). Do not build session B's parts.
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding)

1. **L11: the gate in every claim path** (closes the gap group 3 found: a `needs_decision` record still let a later
   advance requeue and claim — facts §1 and the "已确认旧缺口" paragraph).
   - **Workflow `selectNext`** (§3.4): add UR6 (`needs_decision` / `awaiting_approval` → skip; a named task →
     `waiting` with the card's source; whether the card has an answer is session B's UR7, so in this session every such
     record takes UR6), UR8 (`held` → skip) and UR3h (below, item 2). UR0–UR5 and UR9 exist (group 3).
   - **`gatePerform`:** `requeue_task` with a record that is not `resolved` → `waiting`, no write.
   - **Claim owner (RUN-01):** an ordinary claim (with or without `requeueRef`) of a task whose selected Run has a record
     that is not `resolved`, or is `held`, or cannot be read → `busy` with `unknown_call_review_pending` /
     `unknown_call_review_held`, or `unavailable` for the unreadable record (K3-47 (二)); produce the `reviewPending`
     fact the state machine already consumes (`run-machine.ts` ~633). Only the review claim (TASK-03r) passes.
   - **Requeue owner:** system and agent requeues → `busy` (same reasons); a human requeue is accepted while the record
     is unsettled (its claim still waits); while `held`, a human requeue without `archiveOrigin` → `busy`
     `unknown_call_review_held` with the text naming release-hold; with `archiveOrigin` it is accepted.
   - **RUN-02 entry:** a review round enters only if the record still awaits it (status, `activeRound` is this Run,
     `hold` is not `held`) and the binding digest matches; otherwise `stale`.
   - **D3 mutual guards** (L11 "领取和我来处理互相加守卫"): every claim of the task (ordinary, continuation, review) adds a
     read guard on the record (the revision read, or "still absent" with `expectedRevision: null` when the
     authoritative read is `not_found`), in the one place the claim guards are built (facts: `claim-service.ts` ~1294);
     the hold commit guards the TaskLease revision it read and the facts it read for "the original Run is still the
     selected Run".
   - **AV-2b, AV-4c and L22's three places:** feed the reviews into the failure facts (`workFailureInput`,
     `plan-service.ts` ~891) so AV-2b fires; the task row's record read must report `invalid`/`unsupported` read
     failures as `unreadable`, not skip them (`plan-readers.ts` ~1701, ~1722); wire `requeueConfirmed` through the
     Workflow (`workflow.ts` ~1383) and the decision reader (`goal-decision-reader.ts` ~383) and
     `pausedAutomationAction`, per L22 (the pure rule exists, `task-failure.ts` ~1091). In this session
     `requeueConfirmed` becomes true only by "I'll handle it" released (`hold: 'released'`); the card answers are
     session B's.
2. **L21 without a card: `holdReview` and `releaseHold`** (UCR-15, UCR-14; facts §1 "hold/release").
   - The owner operations behind `UnknownCallReviewPort.holdReview` / `releaseHold` (today the public owner rejects
     `unsupported`, facts: `unknown-call-review-service.ts` ~729), human operators only, with the D3 guards, replay of
     the same request, `busy` when already `held` ("已经在等你处理"), `busy` on release while `activeRound` is not empty
     ("核对轮还没收尾").
   - Routes `unknown-call-reviews/hold` and `unknown-call-reviews/release-hold`. Release-hold on a task whose original
     Run has a human fence (D9): the route calls `releaseHold`, then the human `requeueTask` (afterRun R) with the same
     operator; each call idempotent on its own (K3-41 (二)(三), L29 row 13).
   - **The round in progress** (L21's three cases): entered or running → runs to its end, its conclusions are kept;
     ended, not settled → `settle_review` only closes the round (UCR-08b); claimed, not entered → **UR3h**
     `cancel_review_round`: the Workflow, as automation, submits `cancel` through the control port pinned to the Run
     revision it read (RUN-09(U)), using the cancellation predicate `isUnenteredReviewRoundForCancellation` (§2:
     Claimed, Authorized, Revoked, including paused; not `isUnadmittedStarting`). A revision change before the commit →
     `revision_conflict`, nothing changes. Then UR4 `settle_review` (UCR-08b). Zero model calls.
   - Hold from the card (K3-15 (三)'s entry) is session B; the effects after `held` (requeue refused, release, the
     continuation) are this session.
3. **Start-up 2b and 6b (c) kinds 1–2** (L28, KR2): step 2b pages `open = 'yes'` records (100 per page, at most 100
   pages; unread rest → `problems`), read only; the report gains `reviews: ReconcileLine[]` (facts:
   `startup-reconcile.ts` ~118, ~374 — today there is no `reviews`, and 6b scans all un-entered Runs, not only the
   selected Run; keep that). 6b (c) kinds 1 and 2 hand the goal to the start-up re-drive. Kinds 3 and 4 (answers) are
   session B: leave a typed place for them, not built.
4. **Recovery without answers (L29 rows 1–4, 4b, 6–13):** the existing Workflow rows (UR3a, UR4, UR5, nearest holder)
   plus items 1–3 must make each row's example end with one continuation (or a stop at "I'll handle it" / at a record
   waiting for a card), and a final restart with zero writes. Rows 5 and 5b are session B.
5. **`record_note` meets K3 (decision 72's U1; slice-4 §12 item 9):** add `record_note` to the L3 kinds table as a
   platform tool and to the tool-commit lookup dispatch table (facts: `unknown-call-kinds.ts` ~31,
   `create-platform.ts` ~1634), with the request id from the shared builder (`recordNoteRequestOf` /
   `toolCommitRequestId`); one K3-39-style case each way (committed → `done`, not committed → `not_committed`).
6. **Size admission (K3-48 (三), A part):** `settle_review`, `holdReview`, `releaseHold` on a record near the threshold
   commit and the result stays ≤ 512 KiB; add the final 512 KiB check that is missing today (facts:
   `state/unknown-call-review.ts` ~222, `required` passes directly).

## 3. Rows (§5.2) for this session

Write each row's A part as the facts file §1 splits it; assert nothing that needs a card, an answer or a proof event
(those assertions are session B's and are listed under "B left" in your reply).

- R1/R2: **K3-08** (both), **K3-09** (both), **K3-18** (二)(三)(五) and (四) "no `system_requeue` confirmation card"
  (the review card's presence is B), **K3-48** (三) for settle/hold/release.
- R4: **K3-25**; **K3-26** (一)–(六) and (九) up to the record state and reasons (the card is B); **K3-27**; **K3-28**;
  **K3-29** rows 1–4, 4b, 6–13 and extras (一)(二)(三); **K3-41** (二)(三); **K3-43** (一)–(四), memory and SQLite;
  **K3-44** (二); **K3-47** (二); **K3-15** (四)(五)(六)(七) incl. M1's revision-conflict case.
- U1: the `record_note` cases (item 5).

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id. Expected values literal, from the rows or hand-computed.
- **Tests through public owners and routes.** Fault injection is fine (a store wrapper that fails one read, a blocked
  stand-in tool, a crash point); fact injection is not (hand-encoded records, rewritten Run states, a faked
  `acceptedInputs`). States that only tampering can make are not tested (AGENTS rule 4). Memory and SQLite where the
  row says so.
- State transitions only through `src/core/work-graph/state/` (AGENTS rule 9). Production-reach allowlist: remove the
  entries your wiring reaches; add new ones only with the reason "K3 group 4 session B wires it".
- **Old tests** (facts §4): `tests/helpers/WP1-handover-fixture.ts` ~370/~390 (attested stop then requeue: add the
  human hold/release or settle the record first, whichever the scenario means), `K-W-maintenance.test.ts` ~269/~310
  (KA-14) and `K-R-attested-facts-source.test.ts` ~154/~183/~252/~321 (KA-09) must pass the gate the way the rule
  says, not by weakening the gate; `K3-34-tool-name-constants.test.ts` ~17 gains `record_note`. The proposal-refusal
  assertions (`review-admission.test.ts` ~120, `K3-19-review-admission.test.ts` ~73) stay (session B). Any other
  assertion that fails: do not edit it; report it (test id, assertion, rule, minimal counter-example).
- **Interfaces left for session B** (facts §2): keep `recordProposal`, `applyDisposition`, `listUnappliedAnswers`
  unsupported; leave the Workflow operation table ready for `apply_review_disposition`, the 6b (c) kinds 3–4 slot and
  the continuation brief's disposition fields as they are. Do not build U3/U6/U7 pieces.
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end.
- **Line budget (decision 69):** about 1,400 new production lines (soft; Codex estimated 1,100–1,700 for this part).
  Report the count.

## 5. Order (suggested; you decide the briefs, files disjoint, at most 3 at once)

1. The gate (item 1) first, one subagent: owner guards, facts, AV-2b/AV-4c wiring, Workflow UR6/UR8 and `gatePerform`,
   with K3-47 (二), K3-43 (一)(二), and the old tests in section 4.
2. Then in parallel: (A) hold/release owner, routes, UR3h, D3 hold guards (K3-15 (四)–(七), K3-41 (二)(三), K3-43
   (三)(四), K3-48 (三)); (B) start-up 2b/6b (c) kinds 1–2 and the recovery rows (K3-09, K3-27, K3-29, K3-44 (二)); (C)
   K3-08, K3-18, K3-25, K3-26, K3-28 and item 5.
3. Close-out (one subagent): the checks below.

## 6. Checks (close-out subagent)

- `--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/K-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`,
  `tests/scenarios/S1-archive-flow.test.ts`, `tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`,
  `tests/composition/`, `tests/app/S4C*.test.ts`, `tests/architecture/`, the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox (no bwrap). Name any other failure. **Do not run
  the full suite.**

## 7. Reply

Under 900 words: FILES CHANGED (production / tests, production line count); each scope item and row: done or not,
RED → GREEN; "B left" (the assertions you left to session B, per row); CHECKS with numbers; UNSPECIFIED (short, with
options); subagents (task, time, most at once); anything surprising.

## 8. Answers to the read-through (lead, 2026-10-17 08:55; binding like the sections above)

**Time:** the run gets **280 minutes** (it stops at 290, with a handoff if needed); the header says the same. Keep your plan's order (T1 gate → T2 wiring → T3 and T4 in parallel → close-out). If time still runs short,
leave in this order and report each: K3-29 extras (一)–(三), K3-15 (七)'s second (revision-conflict) example, the SQLite
twins of K3-43 and K3-48 (三). Everything else is required.

1. **Claim and requeue facts for held/unreadable:** replace `reviewPending?: boolean` (`run-machine.ts` ~505,
   `task-machine.ts` ~288) with `reviewBlocker?: 'pending' | 'held' | 'unreadable'`; the state machines map
   `pending` → `busy` `unknown_call_review_pending`, `held` → `busy` `unknown_call_review_held`, `unreadable` →
   `unavailable`; the requeue machine applies L11's human/archive exceptions. The claim and requeue services produce
   the fact from their one record read. `tests/state/k3-review-claim.test.ts` ~102–107: `reviewPending: true` becomes
   `reviewBlocker: 'pending'` (same assertions), plus one case each for `held` and `unreadable`.
2. **The hold's D3 guards:** (a). The UCR owner gets the existing task-projection and TaskLease readers (the same ones
   the claim service uses; reuse, do not copy) through its dependencies; `holdReview` reads the lease and the
   "original Run is still the selected Run" facts (the task's Run list, the covering TaskRequeue) and pins them as read
   guards in its one commit. Guards never come from the request or the route.
3. **UR3h:** (a). A `cancel_review_round` WorkflowOperation whose call is `RunControlPort['submitControl']` (the
   Workflow's existing `controls?` dependency), pinned to the Run revision read. No generic `submit_control`.
4. **release-hold route:** (a), one response `{ hold: <releaseHold receipt>, requeue: <requeueTask result or its
   rejection> | null }`. The route succeeds when `releaseHold` succeeded; `requeue` is `null` when the original Run's
   fence is not human. A rejected requeue is reported in `requeue`; clicking release-hold again replays `releaseHold`
   and retries the requeue (L29 row 13).
5. **`record_note` lookup:** (a). The note service publishes `lookupToolCommit` built on the SAME identity and
   fingerprint helpers its write uses (factor `noteCommandIdentity`/`fingerprintOf` out so the write and the lookup
   call one function, no copy); the composition adds a fourth row `record_note` → notes to the dispatch-by-name table
   (`tool-commit-lookup.ts`). The kinds table gets `record_note` as a platform tool.
6. **UR6's source:** (b). `waiting` gains an optional typed `source` (the existing decision-source type with kind
   `unknown_call_review` and the L18 key of the record's current revision); the reason text stays.
7. **Start-up `reviews`:** (a). `StartupReconcilePlatform` gets the open-record read (the `k3-ucr-by-workspace-open`
   paging, through the existing UCR read owner; add a narrow method if `listReviews` cannot page by `open`). Each line:
   `row: 'UCR'`, `status: 'left'`, `reason` = `<status>` + (when there are reasons) a space and the reasons joined by
   `,` + (when `activeRound` is set) ` active_round`, e.g. `needs_decision inventory_incomplete active_round`.
   `emptyStartupReport` gets `reviews: []`.
8. **UR8 is `skip`, not `pass`** (`workflow.ts` ~1222/~1238): change it; a named held task → `waiting` with
   `unknown_call_review_held`.
9. **The 32 bytes:** the reserve table sums to R = 365,536, so 524,288 − R = 158,752; the spec's B = 158,720 is 32
   bytes smaller. **Keep the code's 158,720** (32 bytes of extra margin; K3-48 (一) names this number); the lead
   post-notes the spec. Item 6's final check compares the serialized record with `UNKNOWN_CALL_REVIEW_MAX_BYTES`
   (524,288) for every write, required ones included (M3: over 512 KiB → `capacity`, nothing written; by the reserve
   it never fires for a legitimate required write). `tests/state/unknown-call-review.test.ts` ~743: rename the title
   to what it proves (required writes are not held to the 512 KiB − R threshold); its 200,000-byte example stays.
10. **Allowlist:** the close-out re-diffs `production-reach-allowlist.json` against the reach report and removes every
    entry your wiring reaches (e.g. `isUnenteredReviewRoundForCancellation`).
