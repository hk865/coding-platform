# Fixture repair for slice 1 tests: common rules (all groups)

## What this checkout is

- Base commit 48c8d473 plus an uncommitted change of 89 paths (see `git status`). The change is "part 1" of a
  two-part task done by another agent: new types, `not implemented: ...` stubs in `src/`, 23 new test files
  `tests/**/S1-*.test.ts`, and changes to 4 existing test files. `git grep -n "not implemented: " -- src` lists the
  stubs. Part 2 (later, by another agent) will replace the stubs with real code and MAY NOT EDIT ANY TEST FILE.
- After your work the lead freezes the test files. So every test must, once part 2 implements the spec exactly,
  pass for the right reason, and must not need part 2 to change its fixture.
- Authorities: `docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md` (§0 wins over the body; §2–§4 the
  behaviour; §5 the test rows: §5.1 fixtures and observation rules, §5.2 UT, §5.3 SV, §5.4 IT); book part 1
  `docs/refactor/design/orchestration-2026-10/slices/slice-1-book-part1.md` sections C and D.
- References in this folder (D:/cxt/impl-s1-fx-msg/): `review-codex2.md` = the previous review of these tests
  (31 findings; your group's findings are repeated in your group file), `guided-round.md` = the earlier correction
  (rules G1–G6 still apply), `fail-reasons.txt` = the measured first failure line of every run in part 1
  (id, backend, error), `file-to-case-map.txt` = which case id lives in which file (must not change).

## What you may change

- ONLY the test files listed in your group file, plus at most ONE new helper file under `tests/` whose name your
  group file gives. Never edit `src/`, never edit any other test or helper (e.g. `tests/helpers/*.ts`,
  `tests/scenarios/harness.ts`, `tests/state/invariants.ts` unless your group file lists it). If you need a helper
  that an existing helper does not offer, put it in your group's new helper file (copy code if needed).
- Keep every case id and the file-to-case map. Keep the number of `it` per file and the `describe.each(['memory',
  'sqlite'] as const)` for SV rows (every SV row runs on both backends). Keep the case id at the start of the `it`
  title as now.
- You cannot run node, npm or tests here (no Node). Be careful with TypeScript: read the types you use
  (`src/contracts/**`, `src/core/**`), keep imports correct, no `any` shortcuts that hide wrong shapes. The lead will
  run typecheck and the tests afterwards.

## How each case must look

1. **Exact row.** Each case builds the given of its spec row and asserts the expected values of the row exactly
   (spec §5.3 / §5.4 / §5.2 row text, plus §5.1). Expected values are exact (`toEqual` on the named fields,
   reason prefixes with `startsWith`), not "truthy", not "non-decreasing".
2. **Real histories.** A given that an existing production entry can produce is produced through that entry and
   the state machines it uses (claim → authorize → enter → result / yield, message send / respond / accept, control
   submit + deliver + terminal observation, reconciliation, Query claim + answer, `resolveUnknownRun` attestation,
   Session retirement through its owner). A given that is new slice-1 behaviour is produced through the new owner
   entry (`requestSessionArchive`, `disposeArchiveWait`, `recordSessionAnomaly`, `archiveLine`, …); in part 1 such a
   step throws `not implemented: …`, which is allowed. Hand-made records (`commitRaw`, `overwriteSession`, rewriting
   a Run / Attempt / message) only when the row says old / legacy / raw records (codec compatibility, spec §5.1
   "codec兼容夹具可以旧编码直接seed"), or for Kernel / health facts that have no public entry. Never a given as a
   comment.
3. **Part 1 RED only from stubs.** Today (part 1) a case may fail only because a `not implemented` stub throws or
   because a part-2 behaviour is missing. It must never fail at a setup step that uses EXISTING code: before you use
   an existing entry, read it and check that its guards accept your inputs today (registered schemas — pass the
   record / event / lookup bundles the real path writes via the fixture's `additionalSchemas`; correct ids; legal
   state order). Think through the setup of each case step by step against the code.
4. **Consistent givens.** The fixture of one case must be a legal history: e.g. a Session cannot be archived while a
   Run still occupies it; a final archive cannot commit with an open responsibility link; an `outcome_unknown` Run
   must have the matching Attempt / Outbox state that real reconciliation produces; a Query answer is saved by the
   real answer path before you expect "answered".
5. **Observations (spec §5.1, G4).** Refusal: `status`, `code`, reason prefix, and unchanged record / event / receipt
   counts on the backend that the owner under test actually writes to (count before and after). Replay:
   `replayed: true`, original cursor and complete original value, and no added Kernel / provider / check / model
   calls. After each mutation in service and integration rows run the invariant checker of `tests/state/invariants.ts`
   with the previous world where the helper supports it. Counts that setup already changed are measured as deltas
   (count after setup, then after the action).
6. **No tautologies, no escapes (G5).** No assertion comparing a value with itself, no comparing the same object
   before/after, no `if (...) return;` before the row's assertions, no `.every` over a possibly empty array, no
   `Promise.allSettled` that drops a rejection, no fake replacing the code under test (G6: call the entry the row
   names, not a pure helper).
7. **Clocks and ids (G3).** `t0='2026-10-08T00:00:00.000Z'`, `t1='2026-10-09T00:00:00.000Z'`, injected through the
   owners' `now`; roles S, D, A, B, r0, r1, m, a are the records the row means.
8. **Do not invent.** If the spec does not determine something a case needs, or a row cannot be built with a legal
   history, do not invent behaviour: write the case as close to the row as the spec allows and list the point in
   your final answer under UNDETERMINED (case id, what is missing, spec line).

## Your final answer (in English, the -o file)

- FILES: each file you changed or created.
- PER CASE: one line per case id of your group: REWRITTEN / KEPT, and in a few words how the given is now built
  (which entries), and which part-1 stub the case is expected to hit first (or "passes in part 1" with the reason —
  a case describing new behaviour should not pass in part 1).
- FINDINGS: for each finding in your group file: DONE / NOT DONE (why).
- UNDETERMINED: see rule 8.
- RISKS: any setup step you are not sure passes today with the existing code (file:line), so the lead checks it.
