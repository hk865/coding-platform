# Task: slice 4C-2 session B rework — the review's findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: report it under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), **at most 3 subagents at once — strictly**, every vitest command `--maxWorkers=2`.
**Finish within 200 minutes** (the run stops at 210, with a handoff if needed). Finish whole items.

## 1. What this copy is

- `slice-setup` = the lead branch after 8A and 4C-2 session A merged (`247fcd57`). Your session-B build
  (`./.dsh-ref/s4c2b-impl.md`, your reply `./.dsh-ref/s4c2b-final.md`) is cherry-picked on top, cleanly (the lead
  rebased it; `create-platform.ts` auto-merged with 8A's changes); `s4c2-b-r` (HEAD) adds `DSH-BASELINE.md`.
  Typecheck passes. **Line numbers in the review files refer to the old base and may have moved a little.**
- Codex reviewed the build read-only (`./.dsh-ref/s4c2b-review.out.md`, Chinese: 8 must-fix, one suggestion, and the
  F06 count). A Claude subagent verified every item in the code (`./.dsh-ref/verify-s4c2b.md`: verdicts, evidence,
  minimal examples, the recommended fix with its size and the tests per item, plus three things Codex missed). **The
  verifier's fixes and tests are binding, with the lead's rulings in section 2 on top; where section 2 differs,
  section 2 wins.**

## 2. Items (binding)

1. **A failed answer-text read is not "no condition"** (verify §1): the verifier's fix and test.
2. **`source_stale`** (verify §2): `readSource` compares the request's pin set with the fresh card's pins (one
   comparison: moved head, moved pointer, new pointer) and answers the CoreRejection `code: 'source_stale'`; the
   adapter maps the owner's pin-move `revision_conflict` to `code: 'source_stale'`. The two locked tests change to
   `source_stale`; the new pointer test and D-02 as the verifier writes them.
3. **One disposition core** (verify §3): the shared `finishDisposition` split at `transitionNote`, the two fronts as
   the verifier designs them; a read-only pointer guard whenever the pointer was read but not written. **The scribe
   path's behaviour does not change** (its contradicted-only target set, its pointer read only on accept); every
   existing `S4A-*`, `S4C-*`, `S4C2-*` note test stays green unedited. **M2:** the actor goes on the card
   application's own event only; superseded targets' events carry `actor: null`, `proof: null` (book §7.3). The
   race test with the `RaceSeam` as the verifier writes it.
4. **The proof's `changes`** (verify §4): `{ before: NoteHead@v, after: NoteHead@v+1 }` of the same head, for the
   card's note and each superseded target. The `CurrentPointer` change is not listed (book §2.1: per changed head).
   Remove the `NoteVersion` row from `AGGREGATE_REF_RULES` if nothing else needs it (say which you did).
5. **U7 and U6** (verify §5): `createCollectionCardSource<T>(spec)` with the verifier's spec shape; the note source
   becomes a spec registration; the queue and the note source must not need edits when K3 registers its source.
   **U6: do the suggestion** — the `goal_conflict` adapter is the default registration inside `createDecisionActions`
   (`{ goal_conflict: …, ...deps.decisionApplications }`), one lookup, no adapter → `answered`; existing decision and
   conflict tests stay green unedited. The U7 test with a real pending card and a call-counting wrapper.
6. **The card source's reads** (verify §6): `userReasonFacts(ctx, heads)` on the note service built on the same
   per-head facts the guard uses (`reasonFactsOf`), injected in place of `check`; per head only its own targets;
   `window.goal` instead of a second goal read; `targetFactsOf` deleted. **The relation-target batch stays one per
   goal** (the lead post-notes §11.7). Also fix the same O(heads × targets) pattern in session A's
   `notes/note-scribe-todos.ts` (~147; verify §6 aside): per head only its own targets; its existing tests stay green.
   The read-count test on the verifier's example (memory and SQLite): note-index lookups plus NoteHead /
   CurrentPointer `readMany` calls = 3 per goal, 6 in total; plan reads counted separately.
7. **Notice grouping** (verify §7): no argument spread (both places).
8. **Tests through the owners** (verify §8): one fixture over memory and SQLite, no `vi.spyOn`, deterministic note
   ids; N1/N2/N3 seeded through real writes and real scribe dispositions (no hand-built `NoteVersion`, no hand-filled
   `noticeClass`); a real contradiction card for D-01 (the fixture contradicts a current user-confirmed note) with the
   supersede and coexist edits of `contradicts` and the old version keeping its `contradicts`; queue-level card
   assertions for D-04, D-05, D-08, D-09, D-11, D-12, D-13 through `queryDecisionQueue` / `readDecisionCard` /
   `resolveDecision`; expected values literal and hand-computed. Delete the fact-injected versions they replace. Keep
   the U3 forged proof (fault injection).
9. **M1, the card's goal** (verify "What Codex missed" M1): the verifier's fix and test.
10. **F06** (verify §9): `tests/composition/WP2-wiring.test.ts` ~539 → `另有 2 条`, with the hand count in a comment
    (after B: note_review hint 0 + message_release hint 1 + goal-understanding update-due 1).
11. **2C-26's wall-clock dependence** (`./.dsh-ref/inv-2c26.md`, `./.dsh-ref/inv-2c26-recheck.out.md`; not caused by
    your work, found in the session-A merge suite): in `tests/scenarios/S2C-K-legacy-provenance.test.ts`, fix `Date`
    to `HOST_NOW` for each case and restore it after, the way `tests/app/S1-session-routes.test.ts` ~43/~44/~62 (`vi.useFakeTimers({ toFake: ['Date'] })`, `vi.setSystemTime`)
    does (Codex's recheck, item 3); then the claim's `+ 60_000` stays relative to the fixed time. No production change.
    All three cases stay green; one run of the file with a simulated backward step of the clock between the requeue
    and C's creation (a throw-away probe under `./.dsh-scratch/`) must stay green — report it.
12. **Not changing:** M3 (`seenThrough` counts lines shown on the earlier pages of the same read; N3 needs it): no code
    change, the lead post-notes book §7.8 and the spec.

## 3. Checks (close-out subagent)

`--maxWorkers=2`: `tests/work-graph/S4*.test.ts`, `tests/work-graph/S5*.test.ts`, `tests/work-graph/SP-*.test.ts`,
`tests/app/S4C*.test.ts`, `tests/app/S5*.test.ts`, `tests/business/`, `tests/composition/` (platform, WP2-wiring,
S4C2-*), `tests/scenarios/WP2-wiring-scenario.test.ts`, `tests/scenarios/S4C2-*`, `tests/scenarios/S2C-K-*`,
`tests/runtime/S3-context-assembler.test.ts`, `tests/architecture/`, the new and changed test files; then
`npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected
in your sandbox. No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
deleted. Any existing assertion that fails beyond what section 2 changes: do not edit it; report it.

## 4. Reply

Under 900 words: files changed (production net before and after; tests), each item RED → GREEN (how you made each
fail first), checks with numbers, UNSPECIFIED, subagents (most at once).
