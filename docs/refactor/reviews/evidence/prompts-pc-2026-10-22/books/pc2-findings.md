# PC-2 findings, frozen for rework 1 (lead, 2026-10-23 night)

Sources: Codex audit 1 in seven parts (`./.dsh-ref/audit/{A,W,H,T,G,Q,J}.out.md`; each row's evidence, input and fix
are there, by its id) and the lead's full suite on `af84802` with bubblewrap (`./.dsh-ref/checks/full-pc2.txt`: 821
files, 21 failed, 69 tests failed). The lead's rulings below are binding. **fix** = do exactly what the row's "唯一改法"
in the audit file says, with the lead's note if any; **rejected** = leave as is; **same as X** = done once under X;
**deferred** = not in this rework (it needs a fixture the lead must freeze first; rework 2).

Every test row keeps the decision 80 bar: expected values are literals or hand-computed, never from production code,
the generated pack, `preparedTexts()`, a manifest or a captured request; through public steps; whole texts compared
whole; one mutation per row, applied once, RED, undone, GREEN.

## 1. Lead rulings on the full-suite failures (book corrections)

**F1. Preparation reads no Kernel history (ruling 14 corrected; replaces Q-05, J-07's boundary half, and DSH's
commit `af84802`).** Cause of 23 failures (`S2A-queue-derived-cards`, `S2B-30-track-bars`, `S2C-lines-*`) and of
`C3-brief-idempotency`'s two: preparation now reads the completed boundary through the Kernel, and many old helpers
prepare in a Session whose stored cursor they wrote by hand, without Kernel stores; C3 now fails at that read with
another reason. At preparation only `takesSessionHistory` is used, and it depends only on whether the Session holds a
completed cursor, not on its position. So:
- One pure rule for the mode, in `context-history-facts.ts`:
  `takesSessionHistoryOf(input: { callKind: 'work' | 'query'; sessionBasis: SessionBasisV1 | undefined; hasCompletedCursor: boolean }): boolean`
  — Work: `sessionBasis?.throughPosition != null || hasCompletedCursor`; Query: with `sessionBasis`,
  `throughPosition !== null`; without, `hasCompletedCursor`. `sessionHistoryDecision` keeps its signature and its
  start use, and computes its mode by calling `takesSessionHistoryOf` (the two cannot drift).
- The recipes' history input carries `hasCompletedCursor: boolean` (Work and a Query without basis:
  `session.historyCursor !== null`, from the Session record preparation already reads) in place of
  `completedBoundary`; a Query with basis carries its basis only. `AssembledContextV1.historyDecision` becomes
  `takesSessionHistory: boolean` (T's type); Q freezes it unchanged.
- Delete `readCompletedHistoryBoundary` from preparation and the `af84802` conversion (an undecodable cursor is
  `invalid` at start, as in `pc1-final`). Start reads the real boundary as before PC-2, runs
  `sessionHistoryDecision`, and a frozen `false` still forces `current_turn`.
- Old tests: none changes for F1. `PC2-history-decision-pure` and `PC2-joint-history` follow the new seam.
- The book's PC-18 bullet "a Query with `sessionBasis` passes no boundary and reads none; Work and a Query without
  basis pass the real one" now reads "… pass the stored cursor's presence; preparation reads no Kernel history".

**F2. Registration rejections stay at start (ruling 16 corrected; Q-02 rejected).** Cause of 12 failures
(`C2` GAP-46, `invariants-fuzz` seeds 4/14/16/23/43, `A2-requeue-service`, `R3e-reverify`, `S5-notices`,
`S5-goal-conflict-rework`): preparation now rejects selected names the Runtime does not know (`requeue_task`,
`reverify_round`). Book §2 rule 1 promises no change outside prompts, and in `pc1-final` these Runs prepare and the
start rejects them (`unsupported`, before any provider call). DSH already left missing owners to the start (preparation
passes the capability set); unknown names get the same treatment:
- Preparation calls `finalToolNamesOf` with `selected` limited to the names this Runtime knows (one exported set in
  `tool-group-assembly.ts`, the same one the function's unknown-name check uses) and the capability owners, as now.
- Start calls it with the real selection and the real owners; its rejection comes first, as in `pc1-final`.
- Old tests: none changes for F2.

**F3. Old tests the book missed (added to §5.3 and the whitelist, owner T; the change is only the one named):**
- `tests/runtime/K3-15-blocked-omission.test.ts`, `K3-35-T-by-hand.test.ts`, `K3-35-approved-methods-brief.test.ts`:
  the 57-byte brief sentence (ruling 15) and, where the cut runs to the end, the 70-byte reminders section that now
  sits last. Make exactly the changes in `audit/T.out.md` §3's table (paddings 3417→3474, 3477→3534, 2536→2593,
  `5809→5752`, comment base 1504→1447; cut at the brief's own range, then 12676→12619, 12764→12707, 12171→12114).
  **Re-derive each number by hand in the reply**; if one differs, use yours and show the sum.
- `tests/app/AG6-agent-assembly.test.ts`, `tests/runtime/C2-runtime-platform-tools.test.ts` ("three deployed
  skills" and its negative): the expected Skill texts become independent whole literals rendered by hand with the
  test's real tool list (ruling 18), per `audit/T.out.md` §3. GAP-46 in C2 stays as it is (F2).
- `tests/scenarios/A1-rework-same-session.test.ts` (already T's): also its brief literal at ~208 loses the sentence.
- `tests/contracts/PC-prompt-section-order.test.ts` (T-10) and `tests/contracts/PC-prompt-set-v1.test.ts` (A-10):
  DSH's changes are approved as they are.

## 2. Rows

| Row | Ruling | Lead note |
| --- | --- | --- |
| A-01 | fix | |
| A-02 | fix | only `description === ''` is rejected |
| A-03 | fix | |
| A-04 | fix | |
| A-05 | fix | |
| A-06 | fix | |
| A-07 | fix | |
| A-08 | fix | |
| A-09 | same as Q-10 | |
| A-10 | rejected | approved as built (F3) |
| A-11 | fix | |
| A-12 | fix | |
| A-13 | fix | |
| W-01 | fix | each default spec as one hand-written JSON literal, copied by hand from the `pc1-final` source |
| W-02 | fix | |
| H-01 | fix | |
| H-02 | fix | |
| H-03 | fix | |
| H-04 | fix | |
| H-05 | fix | a different existing file is `unavailable`; every existing file stays |
| H-06 | fix | |
| H-07 | fix | |
| H-08 | fix | |
| H-09 | same as J-01, J-02 | |
| H-10 | fix | |
| H-11 | fix | |
| H-12 | fix | |
| H-13 | fix | |
| T-01 | fix | |
| T-02 | fix | |
| T-03 | fix | lead ruling: `ContextRenderMaterialV1.pack` is `PromptTextsV1`; no cast |
| T-04 | fix | with the platform pack every brief stays byte-equal (the K3-15/K3-35 tests show it) |
| T-05 | fix | |
| T-06 | fix | |
| T-07 | fix | |
| T-08 | deferred | same as J-09 |
| T-09 | same as J-11 | |
| T-10 | rejected | approved as built (F3) |
| T-11 | fix | |
| G-01 | fix | |
| G-02 | fix | |
| G-03 | fix | |
| G-04 | fix | |
| G-05 | fix | |
| G-06 | fix | |
| G-07 | fix | |
| G-08 | fix | |
| G-09 | same as J-11 | |
| Q-01 | fix | Query preparation reads the real `allowsRead('.')` as Work does; start uses the real one, never the frozen list |
| Q-02 | rejected | F2: owner facts stay at start |
| Q-03 | fix | |
| Q-04 | fix | |
| Q-05 | same as F1 | |
| Q-06 | same as J-11 | |
| Q-07 | split | the same-Session start → J-05's file; LA-1 → J-05; Query history → J-04 (deferred); K3 → J-06 (deferred) |
| Q-08 | same as J-12 | |
| Q-09 | same as J-13 | |
| Q-10 | fix | |
| Q-11 | fix | |
| J-01 | fix | |
| J-02 | fix | |
| J-03 | fix | |
| J-04 | deferred | fixture patch (Codex, lead) |
| J-05 | fix | |
| J-06 | deferred | fixture mode (Codex, lead) |
| J-07 | fix, narrowed | no observation wrapper: for every PC-18 case assert the manifest's `takesSessionHistory` and the reminder count in the started input against hand-computed literals; the boundary half is gone (F1) |
| J-08 | deferred | fixture option (Codex, lead) |
| J-09 | deferred | fixture authorization config (Codex, lead) |
| J-10 | fix | |
| J-11 | fix | |
| J-12 | fix | |
| J-13 | fix | |
