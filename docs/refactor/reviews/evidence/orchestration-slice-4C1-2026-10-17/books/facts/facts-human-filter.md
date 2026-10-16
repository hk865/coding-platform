**Decision 68 applied to 4C: human cards, notices and scribe work**

**1. FACTS**

*Paths that put something in front of the person (4C)*
- **P1, structural card.** L17 (§0.3) sends `pending_review` notes with reason `structural` to the decision queue, with options `accept` / `reject`. `structural` is a boolean the writer declares itself (L5 table, L14 `write`). The code adds the reason whenever the flag is set (`state/note-machine.ts:62`).
- **P2, contradiction card.** Options `supersede` / `coexist` / `reject`. The reason `contradiction` is added whenever `contradicts` is non-empty, whatever state the target is in (`note-machine.ts:63`).
- **P3, understanding cards.** These carry the current pointer. When the pointer has moved, the card is re-read and shown again (L17, L8).
- **P4, scribe results in "please note".** Merge, mark stale and withdraw go to "please note" (L17 last item; decision 35 · Q23 option 甲). The notice category is `note_review` (`src/contracts/goal-decisions.ts:45`).
- **Pull-only views (no push, no attention cost):** the node-detail column and hover counts (L21), and the `{write, check}` envelope returned to your own write (R-03).

*Paths that put work on a scribe*
- **S1, pending count.** All `pending_review` notes counted from the review-status index, plus overQuota anchors; threshold 10 (L16).
- **S2, updateDue count.** Threshold 5 (L16). Where the trigger cursors come from is left for 4C to decide (§10 P3).
- **S3, manual archive.** You archive by hand, no agent is present, and the goal has `updateDue` → the scribe gets a message (L16).
- **S4, the `stale` read** (L12). The code lists only `accepted`/`reviewed` notes, and only for freshness, sources, facts, retired anchors and `invalid`. `conflicting` is not included (`notes/note-read-model.ts:1403-1423`).
- **S5, same-topic concurrent conflicts.** §0.1 告知 3 hands these to the scribe.
- **S6, leftovers after your decision.** When your answer leaves `quota_full` behind, the scribe tidies up (L6; D49-07).

*Code that constrains the rules*
- **Machine guard.** It checks the stored `reviewReasons`, not live facts: a stored `contradiction` blocks the scribe forever (`note-machine.ts:219-223`).
- **Accept clears all reasons** (`note-machine.ts:198`).
- **Supersession only touches current notes.** It skips anything not `accepted`/`reviewed` (`notes/note-service.ts:579`). A pending note named in `replaces` therefore stays pending.
- **Relation heads are already read at write time** (`note-service.ts:713-721`).
- **Nothing protects your own notes.**
  - `replaces` supersedes an accepted target immediately (L4 step 4).
  - No check looks at the target's `confirmedByUser`.
  - A scribe may withdraw any note in its scope (`note-service.ts:998-1018`).
- **Conflict derivation.** `conflictingOf` already tells whether a `contradicts` target is still current (`note-read-model.ts:260-266`). It reads targets one at a time.
- **Every card and notice needs a goal.**
  - `DecisionSourceV1.goalRef` is required (`goal-decisions.ts:79-81`), and so is `NoticeItemV1.goalRef` (`model/decision-contracts.ts:259`).
  - `readSource` resolves a `GoalSnapshot` (`communication/decision-source-facts.ts:375`, `:634`).
  - `sourceNeedsGoal('note_review')` is true (`views/decision-read-model.ts:1248-1249`).
  - Cards with no goal arrive in 7D2 (D62-4; slice-7 L36).
- **Existing closures.** Cancelled goals close cards; a completed goal closes only conflict cards (`decision-read-model.ts:892-898`). A candidate's `source_resolved` closure already exists (`:881`).
- **Proof reader.** `readApplicationReceiptFacts` whitelists only `GoalSettingsChanged` and `PlanRevisionAccepted`. Any other event comes back `incomplete` (`communication/decision-application.ts:59-76`).
- **Heartbeat.** It carries only `pendingInputs` and `messageCursor` (`src/app/attention-observer.ts:79`) and goes to one configured `targetSession` (`src/app/host.ts:1154-1239`). `resolveResponsibleLine` does not exist in `src/`.
- **Scope costs.** `relationAnchorsOf` does one `readMany` per relation (`notes/scribe-scope.ts:301-319`). `countCurrentNotes` reads every current head and then the relations of each (`:331-349`).

**2. GAPS**

- **G1.** A note that contradicts a note that is no longer current still produces a user card. Once a card is up, there is no rule for what happens when its target is later superseded, withdrawn or rejected.
- **G2.** An agent or scribe can supersede or withdraw a note you confirmed with no card at all, at most a "please note" item. Decision 68 says exactly this kind of change must reach you.
- **G3.** "Structural" for a general note is self-declared and changes nothing (§4 rule 1). DESIGN §1.4 item 4 and §3.6 speak of structural *repairs*, and slice 8 carries those on `repair_approval`.
- **G4.** A pending note that a newer pending note replaces stays pending, and both show as cards.
- **G5.** Project-level pending notes (`goalId` null, from 4C's `role_exploration` writers) have no card or notice until 7D2.
- **G6.** S1 counts notes the scribe is forbidden to act on, against slice-5 §4.2 row 4 ("not every scribe task is escalated").
- **G7.** S5 conflicts show up in no counter and no `stale` read.
- **G8.** "No agent present" (S3) is not defined. Pending notes and `updateDue` of cancelled goals have no rule.
- **G9.** Unknown whether an outdated pending understanding should still reach you. P3 shows the new pointer, and accepting would overwrite a newer understanding.

**3. PROPOSAL**

The label after each rule says who decides it: **U** = product decision for the user, **L** = technical decision for the lead.

*Live user reasons.* Define one pure function in `state/note-machine.ts`: `userReasonsOf(head, targets) ⊆ {structural, contradiction, user_note_replaced}`. The card source, the machine guard and S1 all use this one result.

*P2 contradiction*
- **R1 (L) — write time.** `contradiction` is recorded only if at least one `contradicts` target is `accepted`/`reviewed` at write. A note that only contradicts a non-current note is admitted like any other note; the same-topic gate (L4 step 4) still applies.
- **R2 (L) — read time.** If no target is still current, the card closes as `source_resolved` (the slice-5 precedent).
  - The note stays pending without a user reason, so the scribe can `accept` or `reject` it.
  - The machine guard checks `userReasonsOf`, not the stored reasons. The stored `reviewReasons` are left alone (history).
- **R3 (U) — who resolves contradictions.** A contradiction reaches you only if some current target is `confirmedByUser` or has `source.kind = 'user'`. Contradictions between agent notes go to the responsible scribe, with the same three outcomes through `record_note`. This changes decision 35 · Q23 option 甲 and decision 49.
  - Alternative (a): keep every contradiction with you.
- **R4 (U) — retired target.** A target whose primary anchor is retired (L23, non-file reasons only) counts as not current.

*New card for your own notes*
- **R5 (U) — your note replaced.** When a non-user write has `replaces` covering a current `confirmedByUser` note, the write goes to `pending_review` with a new reason `user_note_replaced`. You get a card with options `accept` (which supersedes your note) / `reject`.
  - Understanding notes are excluded: they get a notice instead. Otherwise every routine understanding update after one you wrote would become a card.
- **R6 (U) — scribe withdraws your note.** A scribe withdrawing a `confirmedByUser` note → `forbidden`, reason `user_confirmed`. The scribe writes a replacing note instead, which goes through R5. The author and you keep the right to withdraw.

*P1 structural*
- **R7 (U)** — three options:
  - (a) keep L5 as it is;
  - (b) agent-written structural general notes are `accepted` in their own goal, keep the `!` in the header, and post a "please note" item. The structural change itself is still carded when the architecture revision is proposed (60-7, 62-3);
  - (c) as (b), but the card appears when a scribe tries to `review` the note for project-wide use.
- **R8 (L) — retired anchor.** If the primary anchor is retired with `task_ended`, `module_removed` or `stage_not_in_current_plan`, the card closes as `source_resolved`. The note goes to the scribe.

*Duplicates and timing*
- **R9 (L) — same-author revision.** If a write's `replaces` names a pending note by the same author, that note is withdrawn in the same commit, reason `revised_while_pending`. One card is left.
- **R10 (L) — goal state.** A cancelled goal closes its note cards (existing rule). Its pending notes and `updateDue` anchors are not counted in S1/S2.
- **R11 (U) — outdated pending understanding.** If the current understanding's version 1 has a later `since` than the pending one's version 1, close the card (`source_resolved`) and send it to the author or scribe as `updateDue`. The rule is conservative: when unsure, the card is shown.

*Project-level cards*
- **R12 (L) — until 7D2.** Pending notes with `goalId` null stay pending: no card, not current, visible in `notes/list`. They become cards when 7D2 adds project-level cards. Write this into L17 explicitly.

*Scribe work*
- **R13 (L) — S1 count.** Count only pending notes with no user reason (from `userReasonsOf`), plus overQuota anchors.
  - Hand-check: 10 notes with only `quota_full` → reminder goes out. 9 such notes plus 1 structural → count 9, no reminder.
- **R14 (L) — S5 conflicts.** Add `conflicting` notes to `stale`, and count them in S1 as "conflicts".
  - Exact duplicates (same `topicKey` and the same normalized conclusion on a shared anchor) are reported as `duplicate`, not `conflicting`. The scribe withdraws one.
- **R15 (L) — "no agent present" (S3).** There is no Run of that goal in a non-terminal state at the archive commit.
- **R16 (L) — notice filter.** Scribe results in "please note" include only actions on notes you confirmed or wrote. Everything else is folded into one count line per goal (the existing §1.4 folding).
  - If the user prefers today's Q23 option 甲 ("every scribe result is a notice"), this becomes **U**.

Under R3–R6, everything that still reaches you is something you decided yourself that is being overturned, or a structural statement.

**4. COST (decision 69)**

- **R1, R5, R9 at write:** no extra store reads (the relation heads are already in hand, `note-service.ts:713-721`). R9 adds one head, one version and one event per withdrawn note, in the same commit.
- **Card source `readNoteDecisions`, per queue window:**
  - (G+1) review-status lookups for `pending_review`;
  - one `readMany` for all `contradicts`/`replaces` targets, batched; it replaces the one-read-per-target in `conflictingOf`;
  - a plan read and a catalog read per goal for R8, memoized per call, no file reads;
  - R11 adds 2 version reads per pending understanding.
  - Each record is decoded once, reusing the speed-round per-call memo (s4f §S2.7).
- **S1 per heartbeat:** the same (G+1) lookups and one batched `readMany`.
  - Scope facts (`deriveFacts`) are read once per heartbeat, not once per note.
  - While only the project-scope scribe exists, skip `managingScopeOf` entirely.
- **S2 cost:** unknown until the updateDue trigger sources are chosen (§10 P3).
- **Reuse:**
  - `conflictingOf` derivations;
  - `note-anchor-facts.ts` and the L23 non-file anchor code;
  - `decisionSourceKey`;
  - `finalizeCard`'s `source_resolved` closure;
  - the review-status index;
  - `readApplicationReceiptFacts`, with `NoteDispositionChanged` added to its whitelist (needed anyway).
- **New source lines:** about 180–260 — machine about 30, note-service about 50, card source about 90, counting about 50. This is a rough estimate.

**5. TESTS (public interfaces; NE4 and NE6 unless stated)**

- **D-04 (R1):** a note that `contradicts` an already superseded note → `accepted`, no card.
- **D-05 (R2):** a card is up; the target's author withdraws the target → card `closed`/`source_resolved`. The scribe's `accept` succeeds; before the withdraw it was `forbidden`.
- **D-06 (R5):** an executor writes `replaces` on your note → `pending_review` / `user_note_replaced`, card `accept`/`reject`. `accept` → your note `superseded` and the proof event carries `acknowledgementRef`.
- **D-07 (R6):** the scribe withdraws your note → `forbidden`/`user_confirmed`.
- **D-08 (R9):** the author writes P2 with `replaces: [P1]`, where P1 is pending → P1 `withdrawn`, one card.
- **D-09 (R12):** a `role_exploration` writer leaves a structural note with `goalId` null → no card; `notes/list` with state `pending_review` shows it.
- **D-10 (R13):** the counts above (10 → reminder sent; 9 + 1 → no reminder).
- **D-11 (R10):** after a goal is cancelled, its card is `goal_cancelled` and the S1 count drops by that goal's notes.
- **D-12 (R14):** the N-14 race with differing conclusions → listed in `stale` and counted; with the same conclusion → `duplicate`.
- **Existing rows:** D-01–D-03 still hold. D-01's contradiction fixture must use a current target, or it falls under R1.

**For the user:** R3, R4, R5, R6, R7, R11 (and R16 if the user keeps Q23 甲). **For the lead:** R1, R2, R8, R9, R10, R12, R13, R14, R15.