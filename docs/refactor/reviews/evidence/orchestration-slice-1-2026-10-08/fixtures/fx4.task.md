# Group fx4: Runtime (changed files, brief, routed replies), scenarios, invariant S1-5

Read RULES.md first (same folder). Your files:

- `tests/runtime/S1-archive-files-brief.test.ts` — IT01, IT02, IT03, IT04, IT05, IT32 (spec §5.4; §2.6 incl. last paragraph; §2.7; §0.2 T1, T7; §4.1 "历史输入")
- `tests/runtime/S1-routed-replies.test.ts` — IT28, IT29, IT30 (spec §5.4; §2.5; §0.2 T8)
- `tests/scenarios/S1-archive-restart.test.ts` — IT19, IT21, IT22, IT23, IT24, IT25 (spec §5.4 and the paragraph after its table; §4.1; §4.2 "plain continueArchiveLine …")
- `tests/scenarios/S1-wait-copy-retirement.test.ts` — IT20 (spec §5.4; §2.5; §4.2 last paragraph)
- `tests/state/invariants.ts` — ONLY the S1-5 rule (anchor does not change phase) and how S1 rules get the previous
  world; do not change other rules or exported signatures that other files use (grep the callers).
- New helper allowed: `tests/helpers/S1-runtime-scenario-fixture.ts` (only if needed; scenario harness additions go
  here, `tests/scenarios/harness.ts` stays unchanged).

## Lead decisions for this group (binding)

- **K7 (IT01).** Changed-files `possible` for an edit-type tool call whose outcome was never observed (the Run ended /
  became unknown while the call was open, no tool result recorded) = that call's requested path; never `confirmed`.
  The continuation brief's own selfChanged extraction is unchanged. So IT01's given is a real Kernel history with a
  confirmed edit of `a` and an edit-type call on `b` whose result was never observed — not a deterministic failed edit
  (`expectedRevision: '0'.repeat(64)` is a known failure with no side effect, so `b` could never be `possible`).
  Expected `source=kernel`, `confirmed=['a']`, `possible=['b']`, `status=partial`.
- **D10 (restart receipts, spec §4.2).** Once start-up maintenance (or the continuation) finished the archive and
  cleared R, plain `continueArchiveLine` returns the current archived state with `receipts: []` (it does not replay
  write receipts). The original receipts / values / cursors are verified by replaying the ORIGINAL `archiveLine`
  GraphWrite (same request); check the continuation's current-state result separately.
- **D11 (S1-5).** "Anchor does not change phase" is checked across the mutation that records the anchor only, not
  across an interval that also contains legitimate stop / requeue commits (scenario restart checks span
  reconciliation + maintenance, `tests/scenarios/harness.ts:541`, `:851`). Pick a formulation that a correct
  multi-commit archive (stop → anchor → drop → requeue → final) can never violate, and that still catches an anchor
  commit that changes a Task phase.

## Findings for your files (from review-codex2.md; 2 verified by the lead)

1. (verified) IT05 (`S1-archive-files-brief.test.ts:399–405`): nine anchors for the same Run r0 with
   `subjectKey = index + ':' + canonicalJson(r0)`; spec §2.3 / §2.6: the canonical RunRef identity and at most one
   anchor per Run. Build nine distinct stopped executions (nine Runs) each with its anchor through the real path; the
   ninth is omitted (8 assembled, omitted 1), the omitted one's `pickedUpBy` stays null; warning and fixed sentence
   kept. The mixed-ownership warning needs warning-bearing file facts (worktree fallback), not Kernel-only anchors.
2. (verified) IT01 (`:149–150`): see K7.
3. IT03/IT05 (`:433`): `base.buildRequest()` claims the still-archiving source S → correct admission says `busy`.
   Finish the archive first (or use the real archive flow) and make the successor claim in another Session D before
   preparation. IT03: brief section ref = r0 anchor, inputBinding the same ref, digest fixed, capture only on the first
   prepare.
4. IT04 (`:279–288`): generates a current manifest and compares it with itself after reload. Use a frozen old
   manifest / old brief (literal old encoding, no `anomalies`) and assert the old marker / digest / text are
   byte-equal to the frozen values; no new section.
5. IT28–30 (`S1-routed-replies.test.ts:209`, `:356`, `:383`): D is entered in every fixture, including IT30's idle
   case. IT30: D idle, not responsible for the original Task, reply saved → kept unaccepted, 0 new Task / Query /
   model; at D's next legal execution's safe point exactly 1 item supplied. IT29: the same message from outbox and
   routed pages with a real overlapping multi-page read; supplied once; after formal acceptance 0. IT28: drive the
   real `before_model` safe point / acceptance boundary, not only the input-supply component; original sender gets 0.
   Compare Task / Query / model creation deltas where the row says so.
6. Restart tests (`S1-archive-restart.test.ts:109`, `:168`, `:205`, `:235`, `:271`): see D10. Faults are armed before
   the restart (already fixed; keep). IT19: exact successor-Session exclusion (old S gets no new Run) and the anchor
   ref compared; new execution's brief contains the anchor. IT23: compare the closed link's interval / revision with
   the original values.
7. IT25 (`:285–299`): the final response is not lost. Inject loss of the final commit's response after the durable
   final commit, restart, replay the original request; compare the original final value / cursor with the replay;
   R null; 0 extra stop / anchor / requeue.
8. IT20 (`S1-wait-copy-retirement.test.ts:122`, `:151`, `:165`): three independent lines: (a) S yields a real wait →
   transfer to D → reply → D CONSUMES it at a real safe point (answering is not consuming); question unchanged,
   response consumed once; (b) a copy answers through the real consultation path; the copy is archived at
   attachment (§4.2 last paragraph) — do not expect maintenance to newly report a copy the consultation already
   archived; (c) a retired line without continuation (retired through its owner, wait relieved by the retirement
   exception) receives a late reply → exactly one undelivered-reply item, not auto-forwarded. The original S is not
   re-dispatched by Query / Work; reads / refresh add 0 model calls.
9. `tests/state/invariants.ts:2197` (S1-5): see D11.
