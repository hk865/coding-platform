# Task: K3 group 4 session B1 — the review cards, the dispositions and their application (L18, L19, UR7, UR7b, L28 kinds 3–4); coordinator mode; test-driven


You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, with no fixed limit on subagents (decision 76; files of running subagents
disjoint; every vitest command `--maxWorkers=2`). **Do not end your turn while a subagent has not reported back.**
Subagents write all code and tests; you split, brief, check and reply. **Finish within 250 minutes** (the run stops at
260, with a handoff if needed). Finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch f15f25a4 (4C-2 session B merged as f4171d51), with K3 groups 1–3 and group 4 session A (after
  its reworks) on top; `slice-base` adds `DSH-BASELINE.md`.
- What K3 built so far: `./.dsh-ref/k3-g3a-final.md` … `k3-g3f-final.md`, `./.dsh-ref/k3-g4a-final.md` and the g4a
  rework replies (in order).
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (frozen). Read only what each item
  names: L9, L17, L18, L19, L21 (the card entry), L22, L28, L29 rows 5, 5b, 10, 11; §2 for the names; §3.2 (UCR rows
  for the disposition), §3.4 (UR6, UR7, UR7b); §5.2 rows in section 3.
- Code facts Codex checked before group 4: `./.dsh-ref/k3g4-facts.md` (Chinese; §1 rows marked B, §2 the seams session A
  left, §3 the open questions now ruled in `./.dsh-ref/k3-g4b-rulings.md`). Line numbers there are older than this
  copy; find the current ones.
- **The pieces slice 4C-2 session B built for you (decision 72; reuse, do not copy):**
  - U7, the card source: `createCollectionCardSource` (`src/core/work-graph/views/decision-read-model.ts`); the note
    source (`notes/note-decision-source.ts`) is the worked example of a registered source.
  - U6, the application dispatch: `DecisionApplicationAdapter` and `decisionApplications` in
    `src/business/workflow/decision-actions.ts` (① answer, ② the adapter, ③ `recordDecisionApplication`); the
    `goal_conflict` default registration is the worked example.
  - U3, the proof decoder table: `PROOF_EVENT_DECODERS` in `src/core/work-graph/communication/decision-application.ts`;
    `NoteDispositionChanged` is the worked example (an ordinary change carries `proof: null` and stays `incomplete`).
- Group 4 is split into three sessions. **This session B1:** the review cards, the dispositions of a `needs_decision`
  record and their application, UR7/UR7b, start-up 6b (c) kinds 3–4, and the card parts of earlier rows. **Session B2**
  (later): the proposal round (L20: `safer_method` → `awaiting_proposal` → the proposal tool and admission → the
  `awaiting_approval` card → `approve`/`decline`), K3-16, K3-35 (二)(三), K3-46, K3-48 (二). **Session B3** (later):
  L19a (the CRR owner, the request tool, the `shell` hook, script expansion, the CRR card source, B2-01..B2-18).
  Do not build B2's or B3's parts; where this session's code is shared with them (the card source, the adapter, the
  UR7 step), build it for both record states and both kinds as the rulings say, and test only this session's rows.
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding)

1. **The card source `unknown_call_review` (L18).** Registered through `createCollectionCardSource`; derived from
   records in `needs_decision` (this session's cards) or `awaiting_approval` (B2's; the source reads both states, B2
   adds the approval options and their tests). Source identity `{ kind: 'unknown_call_review', reviewRef, revision }`
   (`decisionSourceKey` gains this kind); pins record@revision, original Run@revision, goal@revision, with
   `goalBases`; the objects (the record, one file object per target path); `dispositionTargets` and
   `proposalTargets` fixed when the card appears and written into the record (D7); the options (L18: at most four;
   `safer_method` only when `proposalTargets` is non-empty and at least 2 round slots remain, else three); the mixed
   card's line; availability `available` when the UCR owner is wired. A cancelled goal or a task no longer active →
   the card is read-only history (`closed`); a direct "I'll handle it" (UCR-15, built in g4a) closes it too.
2. **Answers (L18 "答复").** An option from the card is required; text and annotations ride along; text only, or an
   option not on the card → `invalid`, nothing written; an answer to an older revision → `revision_conflict`; answering
   while the goal is paused is accepted, the application waits for resume.
3. **The disposition owner step and its proof (L19).** `UnknownCallReviewPort.applyDisposition` (today `unsupported`,
   left by g4a): ② writes the record (revision + 1, `UnknownCallReviewChanged` with `change: 'disposition_applied'`
   and a `DecisionChangeProofV1`: the answer message, the captured pins, the record's before/after); request identity
   = hash(record ref, `answerMessageRef`, phase) and fingerprint = canonical (source key, option, `answerMessageRef`),
   independent of the caller's request id and operator; replay returns the original commit receipt; the guards of
   L19 "② 的守卫" checked after the receipt lookup. The four options' effects (L19): `rerun_as_is` and `skip_as_done`
   → `resolved` (observation untouched; the continuation brief's disposition text), `safer_method` → `awaiting_proposal`
   with `stateEntry + 1` (the state change only; the proposal round is B2), `handle_myself` → `resolved` with
   `hold: 'held'`. D9 (the human fence keeps the task stopped at AV-4) as L19 says.
   - U3: one decoder row `UnknownCallReviewChanged` (a non-application change has `proof: null` → `incomplete`, like
     `NoteDispositionChanged`).
   - U6: one adapter `unknown_call_review` in the `decisionApplications` table, wired in the composition; ③ as today.
   - The continuation brief's disposition fields (left by g4a as `disposition: null`): filled from the record per L19's
     texts.
4. **UR7 and UR7b (§3.4), start-up 6b (c) kinds 3–4 (L28), M2 (ruling 1).**
   - `listUnappliedAnswers` takes `{ reviewRef } | { goalRef }`: one internal reader over a new lookup index
     `k3-decision-answer-by-source-goal` (L28, on the SessionMessage codec, `K3_SESSION_MESSAGE_LOOKUP_INDEXES`; the
     slice-5 contract and its index constants unchanged), full paging (2A), the `goalRef` form returning each answer
     with its own `reviewRef`; a hit = ②'s identity found by `lookupCommit`; read failure → `unavailable`.
   - UR7: an answered card whose disposition is not applied → `apply_review_disposition` (Workflow automation
     identity; the identity from the answer) then ③. **Build the step over U6's one advance function keyed by source
     kind** (ruling 4: session B3 adds `command_rerun_request` to the same step); test only `unknown_call_review`.
   - UR7b: driven by the answers start-up hands over, by each answer's own `reviewRef`, independent of the selected Run,
     the task's eligibility and the record's `open`; replays ② and does ③ only; never releases `hold`, never continues.
   - Start-up 6b (c) kind 3 (an answered current card) and kind 4 (the `goalRef` form per active goal), in the typed
     slot g4a left.
5. **L22's confirmation with a disposition:** `requeueConfirmed` becomes true also from an applied card disposition
   (g4a wired it for the released hold); the automatic requeue after a disposition shows no `system_requeue`
   confirmation card (K3-18 (一)(四)).
6. **"I'll handle it" from the card (L21 entry, K3-15 (三)):** `handle_myself` through the card reaches `held` by the
   same owner effect as the direct hold (g4a), with `disposition.source: 'card'`.

## 3. Rows (§5.2) for this session

- **K3-15** (一)(二)(三); **K3-17**; **K3-18** (一) and (四)'s card; **K3-20** (the three-page card reads through U7);
  **K3-41** (一); **K3-44** (一)(三) (M2); L29 rows **5** and **5b** (and K3-29's rows that end at a card: drive them to
  the answer and the continuation now).
- **The card parts group 3 and session A left** (`./.dsh-ref/k3-g4a-final.md` "B left" and the g3 replies): K3-03,
  K3-10, K3-11, K3-13, K3-19, K3-26 (七)–(九)'s card, K3-37, K3-42, K3-45. A record state alone does not pass a row
  whose text names the card.
- **The two start-up 6b variants session A dropped** (its rework-1 reply, UNSPECIFIED 5; the lead accepted the move):
  a held Session whose record has a round with an answered card, and a record in `awaiting_proposal`. Build both from
  real answers through the card (no hand-made records); for `awaiting_proposal`, stop at the state entry (the proposal
  round is B2).
- Memory and SQLite where the row says so (§5.1 R4).

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id. Expected values literal, from the rows or hand-computed.
- **Tests through public owners and routes** (`decisions/answer`, the decision queue and card reads, the Workflow, the
  Host start-up). Fault injection is fine (a store wrapper that fails one read, a crash point between ② and ③); fact
  injection is not (hand-encoded records or answers, rewritten states). States only tampering can make are not tested
  (AGENTS rule 4).
- State transitions only through `src/core/work-graph/state/` (AGENTS rule 9). Production-reach allowlist: remove the
  entries your wiring reaches; add new ones only with the reason "K3 group 4 session B2/B3 wires it".
- **Reuse:** U3/U6/U7 as above; the identity and fingerprint helpers the UCR owner already has; the decision
  reader's answer lookup (`findAnswerMessage`). No second card framework, no second dispatch table, no second scan.
- **Old tests:** the proposal-refusal assertions (`review-admission.test.ts`, `K3-19-review-admission.test.ts`) stay
  (B2). Any other assertion that fails: do not edit it; report it (test id, assertion, rule, minimal counter-example).
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end.
- **Line budget (decision 69):** about 1,400 new production lines (soft). Report the count.

## 5. Order (suggested; you decide the briefs, files disjoint, no fixed limit at once)

1. The card source, the answer rules and the U3 row (items 1, 2; K3-20, K3-17's card), one subagent.
2. Then in parallel: (A) the disposition owner, the U6 adapter, the brief's disposition text (item 3; K3-15 (一)(二),
   K3-41 (一)); (B) `listUnappliedAnswers`, UR7, UR7b, start-up kinds 3–4 (item 4; L29 rows 5, 5b, K3-44 (一)(三));
   (C) the left card parts of earlier rows, K3-18 (item 5), K3-15 (三) (item 6) — after (A) lands.
3. Close-out (one subagent): the checks below.

## 6. Checks (close-out subagent)

- `--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/K-*.test.ts`, `tests/**/S5*.test.ts`,
  `tests/**/S4C2-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`, `tests/scenarios/A8-host-restart*.test.ts`,
  `tests/state/`, `tests/composition/`, `tests/app/S4C*.test.ts`, `tests/architecture/`, the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox (no bwrap). Name any other failure. **Do not run
  the full suite.**

## 7. Reply

Under 900 words: FILES CHANGED (production / tests, production line count); each scope item and row: done or not,
RED → GREEN; "B2/B3 left"; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at
once); anything surprising.

## 8. Answers to the read-through (lead, 2026-10-17 14:00; binding like the sections above)

The read-through reply is `./.dsh-ref/k3-g4b1-preread-final.md`. Where it says the book differs from the code, the code
is right unless an answer below says otherwise.

1. **How start-up hands answers to UR7b (its Unclear 1): option (a).** Spec L28 (line 738) and §3.4 UR7b (line 1319):
   start-up step 6b reads, for each active goal, `listUnappliedAnswers({ goalRef })` once and hands the goal over
   **with** those answers. Add an optional `answers: { reviewRef, answerMessageRef }[]` to the goal entries
   `redriveGoals` returns and to the Workflow advance input the Host sends for that goal; UR7b drives each one by its
   own `reviewRef`, independent of the selected Run, the task's eligibility and the record's `open`; it replays ② and
   does ③ only. The field is optional everywhere, so `K3-29-startup-reconcile-2b.test.ts`'s `{ listReviews }` seam
   keeps working. No read of answers on ordinary (non-start-up) advances: UR7 covers those through the selected Run's
   record.
2. **One reader for both kinds (Unclear 2): option (c).** One internal reader over the new index
   `k3-decision-answer-by-source-goal`, parameterized by the source kind, with full paging (2A). The UCR port's
   `listUnappliedAnswers` calls it with `unknown_call_review`; session B3 will call it with `command_rerun_request`.
   The UR7 step dispatches by kind through the one advance function (answer 9). Test only the UCR kind.
3. **Where the card projection lives (Unclear 3): option (a).** One pure projection (pins, objects, options, the
   mixed-card line, availability) in the lowest layer both `views/decision-read-model.ts` and
   `communication/decision-source-facts.ts` may import (check `docs/refactor/module-target.json` and
   `npm run check:architecture`; `tasks/` if both may import it, else `model/`). No injection, no second copy.
4. **K3-15 (二) (Unclear 4): option (c).** B1 asserts the disposition line of the continuation brief only; the fixed
   "平台拦下原命令…" sentence needs `blockedCommands` (L19a) and is asserted in B3. With no blocked command the
   section is absent (ruling 6).
5. **`awaiting_approval` (Unclear 5): option (a).** B1 builds the disposition phase only; the approval options, the
   approval application and `approvedMethods` are B2. The card source reads both states (book item 1) but B1 projects
   options only for `needs_decision`; an `awaiting_approval` record gives a card with no options and
   availability `unavailable` until B2 (no test for that state in B1).
6. **"Task no longer active" (Unclear 6): option (b).** The card source reads each goal's current plan window once
   per attempt (the attempt cache, as the note source does) in `readCollection`/`readByKey`, and the projected item
   carries whether the record's task is still active; `closedReasonOf` closes on a cancelled goal, a task no longer
   active, a terminal record or a held record (the direct "I'll handle it"). No extra read per card.
7. **Labels (Unclear 7): fixed strings (spec line 66, the user's own words).** `rerun_as_is` "照原样重跑";
   `safer_method` "换个稳妥的跑法再跑"; `skip_as_done` "跳过，当作已做"; `handle_myself` "我来处理". The mixed-card line
   (L18, line 433), shown only when the card has both a proposable command and an entry the check could not settle:
   "选“换个稳妥的跑法再跑”并同意方案以后，查不清的平台条目在接续说明里写“结果查不清，重做前先核实”。". Tests assert
   these literals.
8. **Text-only answers (Unclear 8): option (a), as a table, not an if.** At ①, a small set of source kinds whose card
   requires an option (`unknown_call_review` now; B3 adds its kind): for them `{ kind: 'other' }` without an option is
   `invalid`, nothing written. Other kinds unchanged.
9. **No standalone U6 advance function (its section 2): extract it.** Move the ②-then-③ sequence out of
   `createDecisionActions` into one exported function keyed by `source.kind` (the adapter table stays the only
   dispatch); `resolveDecision` and the UR7/UR7b step both call it. No behaviour change for `goal_conflict` and
   `note_review` (their tests unchanged).
10. **Other differences (its section 2):**
    - `DecisionSourceV1` / `decisionSourceKey` already carry the kind: nothing to add there.
    - `K3_SESSION_MESSAGE_LOOKUP_INDEXES` is new: a constant list for the K3 index, spread into the SessionMessage
      codec's indexes next to the existing ones (`message-record-codecs.ts:1147`); the slice-5 contract and its
      index constants unchanged.
    - `createDecisionSourceFacts` gets the UCR case (B1 cannot avoid it; without it every answer fails at ①).
    - `CARD_KINDS` gains `unknown_call_review`; the card source is registered in the composition.
    - The disposition identity/fingerprint: one helper next to the existing prefixes in
      `unknown-call-review-service.ts` (identity from the record ref, `answerMessageRef` and the phase; fingerprint
      from the canonical source key, option and `answerMessageRef`).
    - The original receipt comes from the commit's receipt (`applicationReceipt(cursor)`), not from `WriteResult`.
    - **Proof field:** keep the UCR codec's existing rule (`proof` absent on non-application changes, required on the
      two application changes); read the book's "`proof: null`" as "absent". The decoder row: absent → `incomplete`.
    - `findAnswerMessage`: move it (one function) to a layer both the views and `tasks/` may import, and have the
      decision read model use the moved one. No copy.
    - `goal-decision-reader.ts` is in `tasks/`; `requeueConfirmed` already exists there — B1 adds tests only, unless a
      row fails.
11. **Tests you expect to break (its section 3):** the fake world in `K3-review-workflow-rows.test.ts` may grow for
    the new step (a helper change, not an assertion change); K3-29 cases that end at an **answered** card are driven
    to the application and the continuation (book section 3 already allows it); cases that end at an unanswered card
    must not change — if one does, report it. Remove the production-reach allowlist entries your wiring reaches
    (`listUnappliedAnswers`, `applyDisposition`); `recordProposal` stays (B2). Any other failing assertion: report it,
    do not edit it.
12. **Your plan is accepted** (A first; then B and C in parallel; D after them; E the close-out). Run as many
    subagents at once as the files allow (decision 76); every vitest `--maxWorkers=2`.
