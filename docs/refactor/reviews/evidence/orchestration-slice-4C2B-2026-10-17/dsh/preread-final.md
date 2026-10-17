Read-through complete. No files changed, no tests/builds run. HEAD is `99e2700` (facts file cites `5b445650`; session A's code is committed above it).

## 1. Unclear (guessing required)

- **Card `change.reason` for `supersede`/`reject`.** The machine (`state/note-machine.ts:347-349`) requires a non-empty reason for accept/reject; the book only defines coexist's reason ("answer `text`, trimmed, empty→null"). Options: (a) answer text if non-empty else a fixed literal (`optionId`/`"user card"`); (b) make the card's text mandatory.
- **`source_stale` is not representable.** `NoteErrorCode`/`NoteDispositionResult` (`model/note-contracts.ts:62,83-86`) lack it; only `CoreError` has it. Options: widen `NoteErrorCode`; map `revision_conflict`→`source_stale` in the `note_review` adapter; return a `CoreRejection` from the adapter.
- **Proof event actor/appliedAt.** `ProofEvent` needs `actor: ActorRef` and `appliedAt`; `NoteDispositionChanged` carries neither, and `head.source` is `NoteSourceV1`, not `ActorRef`. Options: add `actor`/`appliedAt` to the event; derive actor from the answer sender; derive from the note source.
- **`needsGoal` required or optional?** Required breaks the `DecisionCardSourcePort` literal at `tests/helpers/S2C-L-line-support.ts:169` (typecheck; it is `kind:'goal_conflict'`, which the queue skips anyway). Options: optional default `true`; or required and update that double.
- **`message_release` "existing registration" does not exist.** `create-platform.ts:761` registers only `goal_cause`+`planning_question`; `sourceNeedsGoal` (`decision-read-model.ts:1248`) lists `message_release` but no adapter. Options: treat the list as the old `sourceNeedsGoal` set and default `needsGoal=true`; or ignore.
- **Notice-source owner/file unspecified.** Only `views/notice-grouping.ts` is named; the `NoteVersion` ordered-lookup source could live in `views/` or `notes/`. Options: `views/note-review-notices.ts` (direct record read) vs `notes/…` behind a port.
- **`noticeClass` precedence when several apply** (e.g. a scribe's structural note replacing a user note). Options: `user_affected > structural > scribe_result`; or `structural > scribe_result`.
- **`seenThroughOf` input.** The new "every member at or below was shown" rule needs the full ordered/member set; today it receives only `displayedNotices` (`:1218`). Options: pass grouped items + displayed set; or read `members` off the lines.

## 2. Spec/book/facts vs code

- **Spec §2 vs book (biggest):** spec declares `NoteDecisionSourcePort.readNoteDecisions(ctx): readonly NoteDecisionCardV1[]` plus `applyNoteDecision` and the concrete `NoteDecisionCardV1` (`{cardId, optionIds, pointer}`); the book instead wants a collection read + `readByKey` + facts-by-card, projecting to the generic `DecisionCardV1` through the U7 adapter. §11 overrides §2, but the §2 declarations are now stale.
- **U6 dispatch key:** book says step ② dispatches on `input.source.kind`; `decision-actions.ts:254` today dispatches on `selection.kind` (`isConflictSelection`), never `source.kind`.
- **Proof/noticeClass absent:** `note-service.ts:1175,1387` hard-code `acknowledgementRef:null`; `:1342-1343` hard-codes `decisionMessageRef:null`; `NoteVersionSnapshot` (`contracts/note.ts:88`) has no `noticeClass`; `VERSION_KEYS` (`note-record-codecs.ts:101`) rejects unknown fields and the event envelope key list (`:613-614`) rejects `proof`.
- **Line refs:** `resolveDecision` 225, `readApplicationReceiptFacts` 79, `decision-source-facts.ts:620-622`, `DecisionCardSourcePort:320`, `sourceNeedsGoal:1248`, `seenThroughOf:1218`, `finalizeCard:885`, `deriveOpenCard:764` all match. `create-platform.ts` card wiring is at `:761`, not `:757`/`:758`.
- **Coordinator conflict:** `coordinator-mode.md:26` says "At most **2** subagents at a time"; the book/preread say **3** ("strictly"). Needs the lead's ruling.

## 3. Tests that will break (beyond the named ones)

- **Already red (session A):** `tests/composition/WP2-wiring.test.ts:537` expects `reminders: 另有 3 条` but production emits `2` (session A reverted the literal and reported it). Not named by the book; its rule says report, don't edit. Negative assertions `:538/:650/:675` stay green.
- **Typecheck:** `tests/helpers/S2C-L-line-support.ts:169` (card-source literal) if `needsGoal` is required.
- **Typecheck:** `tests/business/S5R2-settings-replay.test.ts:50` `committed(result.action)` — widening `action` past `WriteResult<{goals}> | CoreRejection | null` adds a non-`WriteResult` member, so the generic call at `:50` and `first.action.value.goals`/`first.action.cursor` usages stop compiling without narrowing.
- **Behaviour risk:** if the shared `dispose` core adopts the full `replaces ∪ contradicts` target set for the scribe path too, `tests/work-graph/S4C-note-protection.test.ts:142` (D-06: only a `replaces` user note ⇒ `resolution_not_applicable`) flips. Card mode must be the only one using the full set.
- Book-acknowledged (will need edits): `WP2-wiring.test.ts:465,:623`, `WP2-wiring-scenario.test.ts:80`, `S5-decision-queue.test.ts:142` (`note_review` becomes available), `WP2-context-extensions.test.ts:373` (hint row disappears; `message_release` row `:377` stays).

## 4. Plan (coordinator, ≤3 at once, disjoint files)

1. **S0 shared (~40 min):** `model/decision-contracts.ts`, `contracts/note.ts`, `contracts/goal-decisions.ts`, `state/note-machine.ts` (`noticeClass`, proof-carrying event), new pure `views/notice-grouping.ts` + unit tests.
2. Then parallel:
   - **A U3+U6 (~50):** `communication/decision-application.ts`, `business/workflow/decision-actions.ts`, `communication/decision-source-facts.ts`.
   - **B note cards/apply (~65):** `notes/note-service.ts`, new `notes/note-decision-source.ts` / `note-decision-application.ts`, `persistence/note-record-codecs.ts`.
   - **C U7+queue+notices (~50):** `views/decision-read-model.ts`, new `views/note-review-notices.ts`, `configuration/decision-settings-service.ts` (seenThrough).
3. **Close-out (~30):** `composition/create-platform.ts` wiring + the book's check list.

Total ≈ **235 min**, so 200 is not enough. If capped, I would leave the folded-member exactness row `S4C2-N3` (and §12.12's 20k-note perf run) to the next session and keep S0, U3/U6, note apply, U7, and the basic `S4C2-N1/N2` notices. Also report the coordinator-mode 2-vs-3 conflict before starting.