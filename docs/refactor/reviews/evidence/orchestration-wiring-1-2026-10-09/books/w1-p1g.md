# Wiring package 1, part 1 guided round: tighten the test cases (new Session, key-information brief)

You start in a NEW Session. Everything you need is in this brief and in the copy. Read this whole brief first.

## 1. What this copy is and what is done

- The working tree is a git copy of the product repository (TypeScript, Node 24, vitest). Tag `slice-base` is the
  baseline; `DSH-BASELINE.md` holds its check numbers.
- "Wiring package 1, part 1" is done in the working tree (uncommitted): `not implemented` stubs and new types in 8
  source files, and 8 new test files with 55 cases / 63 runs (spec §6 W12–W19). Today: typecheck 0,
  check:architecture 0, new tests 47 failed / 16 passed, regression equal to the baseline except
  `production-reach` (new exports without a production caller yet; accepted).
- The frozen spec is inside the copy: `docs/refactor/design/orchestration-2026-10/slices/wiring-1-SPEC.md` (Chinese;
  §0 wins; §5.2 is the test table). The lead and an independent reviewer checked every case against its row. This
  round fixes exactly the items of section 4 in the TEST files. Nothing else: no source change, no new case, no
  renamed case, no style change.

## 2. Frozen files (never change them)

`sha256sum tests/helpers/WP1-*.ts` must stay exactly:

```
440f9165790d1734fb884caa202da9698969401c7113d065b96592e16ef80f2e  tests/helpers/WP1-entry-fixture.ts
6ecebf3b7cd9cf4be6d38222f37b87a5b3bdfc222318c41ab11268e83b7e9963  tests/helpers/WP1-handover-fixture.ts
4d45ce44ccb3b9e4b0b13deb26d96c66b0814427aca4a36ee2e82211c30c023b  tests/helpers/WP1-scenario-fixture.ts
413e6a043e980c143fe81b8822fb6e037c1e5907a34bebd47c592f4fe093a48c  tests/helpers/WP1-units-fixture.ts
```

No `src/` file changes in this round (`git diff slice-base -- src` must be byte-identical before and after).

## 3. Rules

1. Write scope: only `tests/runtime/WP1-context-assembly.test.ts`, `tests/work-graph/WP1-context-anomalies.test.ts`,
   `tests/work-graph/WP1-goal-content-entry.test.ts`, `tests/business/WP1-continuation-handover.test.ts`,
   `tests/scenarios/WP1-wiring.test.ts`. Keep every case id, title start and the number of `it` per file.
2. Exact expectations from the spec rows; no tautology, no `if (…) return`, no `.every` on a possibly empty array, no
   swallowed failure, no fake of the code under test. A spy that only OBSERVES a real port (calls through to it) is
   allowed where an item says so.
3. No real model, no network, no server, no install, no git write command. Scratch files only in `./.dsh-scratch/`
   (delete it at the end). This sandbox has no `/usr/bin/bwrap` (registered checks end `waiting` with ENOENT); do not
   work around it.

## 4. The items (file:line in the current copy; spec row; direction)

**This run is headless. When your turn ends, the whole run ends and every subagent that is still running is killed
(an earlier attempt of this round lost all its work that way: it started six subagents and ended its turn).** After
starting subagents, stay in your turn until every one of them has finished and reported: wait with a blocking shell
command (for example `sleep 540`) and check with `list_agents`, again and again. End your turn only after the final
checks of section 5 and the reply of section 6.

Split: one subagent for group A (W13 + W14 + W15), one for group B (W18), one for group C (W19); give each sections
1–3 verbatim and its own group's items verbatim. Keep your own context small. When they report, run section 5 once;
then one fresh review subagent per group checks each item (done / not done, file:line). Fix, re-run.

### Group A

- A1 `tests/work-graph/WP1-context-anomalies.test.ts:244–246` (AN06 (c), spec row AN06, §4.2 step 1): the spec gives a
  reason only for the unbound ctx (b), not for the foreign-project request (c). For (c) assert `status: 'rejected'`,
  `code: 'forbidden'` and zero owner calls only, not the reason.
- A2 same file `:165–185` (AN03, §4.2 step 4 "按 key 的字符码升序"): the 150 anchors are fed already in key order, so an
  implementation that never sorts passes. Feed them out of order across the two pages (e.g. reversed or interleaved),
  compute the expected key order independently from the INPUT anchors (`'anomaly:' + sessionAnomalyRefKey(ref)`, sorted
  by UTF-16 code unit), and compare the output keys with it. Keep the 100 + 50 paging, the second call's
  `{ limit: 100, cursor }` and the retired_archive text.
- A3 same file, AN01 and AN03 (§4.2 step 3: `listSessionAnomalies(hostCtx, { goalRef: request.goalRef, page: { limit:
  100 } })`): also assert the FIRST call's input exactly `{ goalRef: <request goalRef>, page: { limit: 100 } }`.
- A4 `tests/runtime/WP1-context-assembly.test.ts:95–100` (AN08 row: "提醒段含这行…；含‘注记索引尚未接入’；不含…"):
  check placement, not the whole input: cut the `reminders` section out of the input with its interval in
  `binding.sections` (byte offsets over the UTF-8 input, as GC03 does for `goal`) and assert the row's canonical JSON
  and the notes line are inside it; keep the whole-input `not.toContain('异常锚点投影尚未接入')`.
- A5 `tests/work-graph/WP1-goal-content-entry.test.ts:59` (GE01 row: "digest===goalContextDigestV1(当前 Goal)"): compare
  with the production `goalContextDigestV1(await f.readGoal())` from `src/contracts/graph-context.ts` (a stub today, so
  GE01 fails on it — fine). GE02/GE04/GE06 may keep the local formula.

### Group B — `tests/business/WP1-continuation-handover.test.ts`

The fixture's `observations.link(ref, target?)` returns `null` when the link record does not exist, so
`(await link(...))?.until).not.toBeNull()` also accepts a MISSING link (`undefined`), and `openResponsible(...) ===
null` accepts absence too. A closed link must be shown to exist with a cursor in `until`.

- B1 `:100` (HO01 row: "C 对 T 关系版本 1"): in addition to the comparison with `transferPins`, assert explicitly that
  the fourth pin (C's `responsible` link on T) has `revision: 1` and that link exists and is open.
- B2 `:181` (HO03), `:215` (HO04), `:236` (HO05): assert that P's link on T exists (not null), has a string `until`, and
  (HO03) that C's link on T exists with `until === null`.
- B3 `:228–236` (HO05 row: "P 除对 T 的关系关闭、版本 +1 外不变"): besides the record, compare P's other links (the card's
  `links` other than the T link) before and after: unchanged.
- B4 `:344–373` (HO12 row: "这次推进不跑维护页"): equal write totals do not show that no maintenance page ran (a page can
  run and write nothing). Observe the page: wrap `f.composition.deps.sessions.findSessions` with `vi.spyOn` (calls
  through) and count the calls whose input has neither `role` nor `target` (that is the maintenance page's workspace
  listing). Expect at least one such call during the first transfer advance (control) and zero during the replayed
  one. Restore the spy.
- B5 `:376–402` (HO13 row: "它的 session 快照仍带归档请求…维护页续做这个请求（转交按原回执重放，不再写一次）"): assert the
  partial receipt's `session.archiveRequest` is an object with `mode: 'handoff_complete'` (not only "not null"); and
  that across the whole advance exactly ONE responsibility transfer was written: P's T link `until` equals one cursor,
  and the store's responsibility-change events for this transfer (`f.observations.events()`, event type
  `SESSION_RESPONSIBILITY_CHANGED_EVENT` from `src/core/work-graph/sessions/session-responsibility-service.ts` or the
  codec module it imports) that close P's T link number exactly one.

### Group C — `tests/scenarios/WP1-wiring.test.ts`

- C1 `:89` (SC02 row: "提醒段含 key anomaly:+refKey(A) 那一行"): check the row inside the `reminders` section of the
  prepared input (cut with `prepared.binding.sections`, byte offsets), not the whole input.
- C2 `:99` (SC02 row: "这个 Run 进入、T 完成后，再对这个目标 readContextFacts"): `enterAndComplete()` returns the drive
  (`ScenarioDrive`); assert it reached `state: 'completed'` and that T's task row is `satisfied` (fixture read helper)
  before the final `readGoalContextFacts()`.

## 5. Checks (main Session, once, after the self-check)

- `npm run typecheck`: 0. `npm run check:architecture`: 0.
- `npx vitest run tests/runtime/WP1-context-assembly.test.ts tests/work-graph/WP1-context-anomalies.test.ts
  tests/work-graph/WP1-goal-content-entry.test.ts tests/business/WP1-continuation-handover.test.ts
  tests/scenarios/WP1-wiring.test.ts tests/state/WP1-goal-content.test.ts tests/business/WP1-start-refusal.test.ts
  tests/composition/WP1-session-duty.test.ts --reporter=verbose`: 63 runs. Passing must be exactly GC04, AN08, WF02,
  GE03/GE05/GE06/GE07 (both backends), HO09, HO10, HO11, HM02, HM03 — 16 runs, EXCEPT that GE01 keeps failing (now on
  the `goalContextDigestV1` stub) and AN08 may now fail only if the reminders section really lacks the row (then say
  so). Every other failure: a `not implemented:` stub or an AssertionError on missing new behaviour; no setup error,
  TypeError or timeout.
- `sha256sum tests/helpers/WP1-*.ts` unchanged; `git diff slice-base -- src` unchanged.

## 6. Reply (plain text, four sections)

FILES CHANGED / CHECKS (numbers, passing ids, distinct first-failure messages) / UNSPECIFIED (any item you could not do
as written: item, why, file:line) / NOTES (subagents run).
