# Task: slice 4C-2, session B — the note cards and their application (L17, §11.6), the proof table (U3), the application dispatch (U6), the card-source adapter (U7), the notices and their grouping (U9); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, with **at most 3 subagents at once — strictly** (do not start a
fourth while three run, even if one reports early). Files of running subagents disjoint; every vitest command
`--maxWorkers=2`. Subagents write all code and tests; you split, brief, check and reply. **Finish within 230 minutes**
(the run stops at 240, with a handoff if needed). Finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch with 4C-2 session A applied after its four reworks (assembly, "update due", scribe
  reminders; the replies are `./.dsh-ref/s4c2a-final.md` and `./.dsh-ref/s4c2a-rework1..4-final.md` — the reworks
  deleted `NoteUpdateDuePort`, added `notes/note-batch-reader.ts`, and moved the update-due reading into
  `readGoalUnderstandingAnchors`); `slice-base` adds `DSH-BASELINE.md`. Your read-through reply is
  `./.dsh-ref/s4c2b-preread-final.md`; section 7 answers it.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`: **§11 and §12 first** (they override
  earlier sections), then L15, L17, §2's `NoteDispositionChanged` paragraph (~539), §11.6, §11.7's "注记卡源一次读",
  §5.2 rows named below, NE6.
- Code facts (Codex, on the 4C-1 merge): `./.dsh-ref/s4c2-facts.md` §1–§4 (current file:line for `resolveDecision`,
  `DecisionCardSourcePort`, `readApplicationReceiptFacts`, the notice sources; session A's changes are not in it).
- Reuse rulings (decision 72): `./.dsh-ref/reuse-rulings.md`, items **U3, U6, U7, U9**. K3 group 4 will add a second
  row, adapter and source to each of U3/U6/U7 (`UnknownCallReviewChanged`, the review-card application, the review
  card source): **build them so that adding one is a registration, not a change to the coordinator or the queue.**
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding)

1. **U3 — the proof decoder table** (`communication/decision-application.ts`):
   - `decodeProofEvent` becomes a table keyed by event type: rows `GoalSettingsChanged`, `PlanRevisionAccepted`,
     `NoteDispositionChanged`; `ArchitectureCatalogAdopted` and `ProjectCompletionPolicyActivated` stay rows that
     answer `unsupported`; an unknown type stays `incomplete`. Every other step of `readApplicationReceiptFacts` is
     unchanged.
   - **`NoteDispositionChanged` carries the standard proof:** the event gains `proof: DecisionChangeProofV1 | null`
     (null for every disposition that is not a card application; absent on old events decodes as null).
     `acknowledgementRef` stays and equals `proof.acknowledgementRef` when the proof is present. The proof's
     `capturedPins` are the card's pins, `changes` one `{ before, after }` per changed head (the card's note and every
     target superseded in the same commit), `basisRebases: []`.
2. **U6 — the application dispatch** (`business/workflow/decision-actions.ts`):
   - `resolveDecision` keeps step ① (the answer) and step ③ (the receipt and `recordDecisionApplication`). Step ②
     dispatches on `input.source.kind` to an adapter injected by the composition root
     (`deps.decisionApplications`, keyed by source kind). A kind without an adapter answers `answered`, as every
     non-conflict answer does today.
   - Today's conflict code moves **unchanged** into the `goal_conflict` adapter (a non-conflict selection on it stays
     `answered`). Every existing decision and conflict test stays green without edits.
   - The `note_review` adapter calls `NoteDecisionSourcePort.applyNoteDecision` (item 4). Retry = the same
     `decisions/answer` request again: the answer replays, the owner replays the original receipt by its `commandId`
     (derived from the answer message ref), the application replays. No start-up re-apply in this session (K3 g4 / 8C).
   - `ResolveDecisionReadV1.action` widens to a union that includes the note application's result; the HTTP response
     type follows. Report the exact type.
3. **U7 — the card-source adapter** (`views/decision-read-model.ts`, `model/decision-contracts.ts`):
   - One adapter: a source supplies `kind`, `needsGoal`, a collection read (assembled once per attempt, using the
     existing `attempt.cache`), the stable key (`decisionSourceKey`), the projection to `DecisionCardV1`, the close
     check, and a **read by key**. The adapter pages the assembled collection.
   - `DecisionCardSourcePort` gains `needsGoal` and an optional `readByKey`; `deriveOpenCard` uses `readByKey` when
     present (no paging to find one card); `sourceNeedsGoal` is deleted and the queue reads `source.needsGoal`. The
     existing registrations get `needsGoal: true` (`goal_cause`, `planning_question`, `message_release` — today's
     list). The three hand-rolled sources are **not** migrated (cleanup C1).
4. **The note cards (L17, §11.6):**
   - **Ports:** `NoteDecisionSourcePort` in `model/decision-contracts.ts` (L17): the card collection for a goal, the
     facts of one card by key, and `applyNoteDecision`. notes implements it; the composition root injects it into the
     queue's card source, into `decision-source-facts.ts`, and into the `note_review` adapter. communication and
     business never import notes.
   - **Which notes get a card:** `pending_review` heads of the goal (the review-status bucket) whose `userReasonsOf` is
     not empty. Gate order (§11.6, the note card's own, not `finalizeCard`'s conflict branch): (1) goal cancelled →
     closed `goal_cancelled`; (2) answered → the slice-5 answer and application states; (3) `userReasonsOf` empty, or
     `pendingUnderstandingOverridden(head, current)` (session A's predicate) → closed `source_resolved`; (4) otherwise
     `waiting_answer`. A note with `goalId: null` never gets a card (D-09). Whether a closed card that was never
     answered is listed follows today's `goal_cause` source; name the rule you followed.
   - **One read per queue call** (§11.7): the pending bucket per goal one scan, one batch read of all relation targets,
     each goal's plan and catalog once (per-call cache).
   - **Card shape:** identity `{ kind: 'note_review', note: <head pin> }`; `pins` = the head pin, plus for an
     understanding the current pointer pin (`CurrentPointer` ref, revision); `objects` = aggregate pins of the note and
     of each actual target (§11.6: replaces minus coexistWith, plus contradicts), labels from `renderNoteHeader`.
     Options: reasons contain `contradiction` or `user_note_replaced` → `supersede` / `coexist` / `reject`; only
     `structural` → `accept` / `reject`.
   - **`readSource` for `note_review`** (`communication/decision-source-facts.ts` ~620): through the port. The identity
     version is not the current head version, or the pointer moved → `source_stale` (nothing recorded).
   - **`applyNoteDecision`:** one disposition core in `notes/note-service.ts`, shared with the scribe's `resolution`
     path (§11.6: "和你的注记卡落实走同一组状态迁移"); state changes through `state/` only. The card mode differs only
     in: the authority is the answering user (from the answer, never a parameter); the guard is the card's pins
     (head version, pointer revision; moved → `source_stale`); `change.decisionMessageRef` and the event's
     `acknowledgementRef` are the answer; the last event carries the proof (item 1); the target set is the actual one
     (replaces ∪ contradicts as §11.6 defines), not only the contradicted targets. Effects (D-17, D-01, D-06):
     - `supersede`: a new version of the note with `replaces` + the resolved targets and `contradicts` − them,
       accepted; the targets `superseded`; one commit; for an understanding the pointer moves (L6).
     - `coexist`: a new version with `contradicts` − the targets and `coexistWith` + them; the answer's `text` (trimmed,
       empty → null) is `change.reason`; accepted; the targets stay current; the old version keeps its `contradicts`.
     - `reject`: `rejected`.
     - `accept` (structural only): accepted per L6.
     - The receipt is the commit's formal receipt (identity, fingerprint, cursor); the same `commandId` replays it.
5. **The notices ("请知悉", §11.1 item 8, §11.6, L17 last item):**
   - **Which versions are notices** (decided by the writer when it writes the version; `NoteVersion` gains
     `noticeClass: 'user_affected' | 'structural' | 'scribe_result' | null`, absent on old versions = null, never a
     notice):
     - `user_affected`: a version that superseded, withdrew or rewrote a note the user wrote or confirmed, made by
       anyone but the user — today the agent's goal understanding replacing a user-confirmed one (§11.6 "当前理解除外");
     - `structural`: an agent's structural ordinary note accepted (§11.6);
     - `scribe_result`: any other disposition by a scribe (`accept`, `reject`, `withdraw`, `supersede`, `coexist`,
       `merge`; not `write`, not `review`).
   - **Read:** one ordered lookup over `NoteVersion`, paths `['ref.projectId', 'noticeClass']`, ordered by `since`
     (declared like `S2A_REQUEUE_BY_PROJECT_LOOKUP`), read from the saved seen position per class; only goals of the
     workspace; goal-less versions are not notices until 7D2. Category `note_review`. Position
     `{ kind: 'commit', cursor: since, itemKey: <version ref key> }`.
   - **Summary text:** `注记 · <动作> · <renderNoteHeader(version)>` with 动作 写入 / 收下 / 拒绝 / 撤下 / 取代 / 并存 / 合并
     by `change.kind`; a folded line `书记整理 · <n> 条注记`.
   - **U9 — one pure grouping function** (new `views/notice-grouping.ts`): raw items + a strategy → shown items, each
     with its member identities and positions. 4C's strategy: `user_affected` and `structural` items each their own
     line; `scribe_result` items folded into one line per goal (position = its newest member's). Every other category
     passes through unchanged. `NoticeItemV1` gains optional `members?: { itemKey; position }[]` on a folded line.
   - **Seen positions advance only over members actually shown** (DESIGN §1.4 / :230): `seenThrough` for a category is
     the highest member position such that every member at or below it was shown on this page (a folded line shows
     all its members). Replace `seenThroughOf`'s "last shown item" with this rule; for unfolded categories the result
     is the same as today.
6. **Rows (§11.8, §5.2; NE6, service rows on memory and SQLite):** D-01, D-02, D-04 (card part: no card), D-05 (card
   part), D-06, D-08 (one card), D-09, D-11 (card closes `goal_cancelled`), D-12 (card closes), D-13, D-16 (no card),
   D-17. Plus:
   - `S4C2-N1`: in g1 a scribe withdraws two agent notes and accepts one pending; in g2 it rejects one → the queue's
     notices show one folded line for g1 (3 members) and one for g2 (1); the counts are 3 and 1.
   - `S4C2-N2`: an agent's goal understanding replaces the user-confirmed one → its own notice; an agent's structural
     note accepted → its own notice with "!" in the header.
   - `S4C2-N3`: positions 1 (`scribe_result`, g1), 2 (`user_affected`, g1), 3 (`scribe_result`, g1), page limit 1 →
     the page shows the item at 2 only; `seenThrough` stays below 1 (nothing is marked past an unshown member); the
     next page shows the folded line (members 1 and 3); after marking it seen, no `note_review` notice remains.
   - `S4C2-U7`: `readDecisionCard` for a note card on the second page of its source reads it by key (no paging);
     a missing key is `not_found`.
   - `S4C2-U3`: a forged `NoteDispositionChanged` receipt whose proof names another answer → `invalid`; an ordinary
     disposition (proof null) → `incomplete`.
7. **Not in session B:** the reminders and assembly (session A); start-up re-apply; migrating the three hand-rolled
   sources (C1); the review cards of K3; notices without a goal (7D2); 6A.

## 3. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id or `S4C2-<n>`. Expected values literal and hand-computed. Through public entries: the decision queue, the
  `decisions/answer` route or `platform.workflow.resolveDecision`, `readDecisionCard`, the note routes; no database
  or artifact reads to verify.
- State transitions only through `src/core/work-graph/state/` (AGENTS rule 9). Production-reach allowlist: remove the
  entries your wiring reaches; add new ones only with the reason "4C-2 wires it".
- **Old tests:** the "note_review not connected" assertions change (`tests/composition/WP2-wiring.test.ts` ~465, ~623;
  `tests/scenarios/WP2-wiring-scenario.test.ts` ~80). The isolated missing-source fixtures
  (`tests/work-graph/S5-decision-queue.test.ts` ~142, `WP2-context-extensions.test.ts` ~372) change only if wiring
  the source changes them. 4C-1's protection tests (`S4C-note-protection.test.ts`) and session A's tests stay. Any
  other assertion that fails: do not edit it; report it (test id, assertion, rule, minimal counter-example).
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end.
- **Line budget (decision 69):** about 1,000 new production lines (soft; Codex estimated 750–1,150 for these parts).
  Report the count.

## 4. Order (suggested; you decide the briefs, files disjoint, at most 3 at once)

1. Shared first, one subagent: the contracts (`NoteDecisionSourcePort`, `DecisionCardSourcePort.needsGoal/readByKey`,
   the proof field on the event, `noticeClass`, `NoticeItemV1.members`, the widened action type) and the pure
   `notice-grouping.ts` with its unit tests.
2. Then in parallel: (A) U3 + U6 (`decision-application.ts`, `decision-actions.ts`, composition wiring of the
   adapters); (B) the note side: the card collection, `readNoteDecision`, `applyNoteDecision` and the disposition core
   in notes, `noticeClass` at write time, the lookup (D rows); (C) U7 and the queue: the adapter, `readByKey`,
   `seenThrough`, the note notice source (N rows, U7 row).
3. Close-out (one subagent): the checks below.

## 5. Checks (close-out subagent)

- `--maxWorkers=2`: `tests/work-graph/S5-*.test.ts`, `tests/work-graph/S4*.test.ts`, `tests/work-graph/SP-*.test.ts`,
  `tests/composition/WP2-*.test.ts`, `tests/scenarios/WP2-*.test.ts`, `tests/composition/platform.test.ts`,
  `tests/app/` decision and note route tests, `tests/runtime/S4C-*.test.ts`, `tests/architecture/`, `tests/state/`,
  the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox. Name any other failure. **Do not run the full
  suite.**

## 6. Reply

Under 900 words: FILES CHANGED (production / tests, production line count); each scope item and row: done or not,
RED → GREEN; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at once); anything
surprising.

## 7. Answers to the read-through (lead, 2026-10-17 05:05; binding like the sections above)

1. **`change.reason` on a card application:** the answer's `text`, trimmed; when it is empty, the literal
   `决定卡：<optionId>` (e.g. `决定卡：reject`). The same rule for all four options, so `coexist`'s condition is the
   user's text when they wrote one.
2. **`source_stale`:** `applyNoteDecision` keeps returning `NoteDispositionResult`; a moved pin is its existing
   `revision_conflict`. The `note_review` adapter maps exactly that case to a `CoreRejection` `source_stale`.
   `readSource` returns the `CoreRejection` `source_stale` itself. `NoteErrorCode` does not change.
3. **The proof's actor and time:** a card application's `NoteDispositionChanged` carries `proof` **and**
   `actor: ActorRef` (the answering user, from the trusted call context, as `GoalSettingsChanged` does); both are null
   on every other disposition. `appliedAt` = the event header's `occurredAt`.
4. **`needsGoal`:** required on `DecisionCardSourcePort`. The two real registrations (`goal_cause`,
   `planning_question`, `create-platform.ts` ~761) get `needsGoal: true`; `message_release` has no source today, so it
   is simply no longer named anywhere. Add `needsGoal` to the test double `tests/helpers/S2C-L-line-support.ts` ~169
   (typing only; allowed).
5. **The port (spec §2 is revised by this book; the lead post-notes the spec):** `NoteDecisionSourcePort` keeps
   §2's `NoteDecisionCardV1` and §2's `applyNoteDecision` signature (`commandId`, `cardId`, `optionId`, `pin`,
   `expectedPointerRevision`, `answerMessageRef`, `conditions` = the item-1 text or null) returning
   `NoteDispositionResult`. `readNoteDecisions` takes `{ goalRef }` and returns the goal's open cards (gate steps 1
   and 3 applied); a by-key read `readNoteDecision(ctx, { pin })` returns the card or null plus its closed reason
   (`goal_cancelled` / `source_resolved` / null) for `readSource`, `readByKey` and an answered card's closure. Both
   return `ReadResult` (a failed read is `unavailable`, never an empty list). The U7 adapter projects
   `NoteDecisionCardV1` to `DecisionCardV1`.
6. **The notice source:** new `views/note-review-notices.ts`, reading records directly like
   `views/automatic-rework-notices.ts`.
7. **`noticeClass` when several apply:** `user_affected` > `structural` > `scribe_result`.
8. **`seenThrough`:** computed from the whole ordered, grouped notice list of the query and the set of lines this page
   shows; a line's members are its `members` (folded) or the item itself. `seenThroughOf` takes both.
9. **U6's key:** dispatch on `input.source.kind`; the `goal_conflict` adapter keeps `isConflictSelection` as its own
   first check (a non-conflict selection → `answered`). If any existing test answers a conflict selection on a source
   kind other than `goal_conflict`, stop that item and report it.
10. **Widening `action`:** the typing-only narrowing in `tests/business/S5R2-settings-replay.test.ts` (~50 and the
    `.value.goals` / `.cursor` uses) is allowed; no assertion changes.
11. **The scribe's `resolution` path keeps its contradicted-only target set**; only the card mode uses the full actual
    set (replaces minus coexistWith, plus contradicts). `S4C-note-protection.test.ts` ~142 stays green unchanged.
12. **Subagents:** at most 3 at once with `--maxWorkers=2` (the updated `coordinator-mode.md` says the same).
13. **Time:** the run has 230 minutes. If it is short, leave `S4C2-N3` last and report it unfinished rather than
    weaken it. The 20,000-note measurement is the lead's, not yours.
14. **Already-red `WP2-wiring.test.ts` ~537** (`另有 3 条` → 2, session A): the lead rules it during session A's
    review; leave it as you find it.
