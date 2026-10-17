# Task: slice-8 §10 segment, rework 2 — Codex's quick check (4 items + the reply's size statement); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`; **read its sections "How tests reach their state: no hand-written facts" and
"Before you build: what the reworks were about" first; both bind every brief**, and the close-out runs one vitest
command at a time). Files disjoint between subagents, every vitest command `--maxWorkers=2`. **Do not end your turn
while a subagent has not reported back.** **Finish within 80 minutes** (the run stops at 90). Finish whole items; an
unfinished item is reported, not half-done. Delete `./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is

Tag `s8a-scale-r1` (HEAD) = §10 rework 1 (book `./.dsh-ref/s8a-scale-rework-1.md`, your reply
`./.dsh-ref/s8a-scale-rework1-final.md`). Codex's quick check of it: `./.dsh-ref/s8ascale-review2.out.md` (Chinese,
file:line and the fix approach; **W/** = `src/core/workspace/`, **A/** = `src/core/work-graph/architecture/`, **T/** =
`tests/data/`). The lead checked items 1, 6 and 7 in the code; they hold. Spec: `./.dsh-ref/slice-8-SPEC-current.md`
and `./.dsh-ref/decision-79.md`. Items 2, 4 (except the comment below) and 5 of the quick check are done; leave them.
This is a small round: reuse what is named below; no new helper, no new production parameter.

## 2. Items (binding)

1. **The mapper's mode is required** (your UNSPECIFIED 1, not accepted). `mapArchitectureSource`
   (`W/architecture-source.ts` ~36–38) takes `mode: 'strict' | 'observation'` with no default. The production call
   already passes it (`W/capture.ts` ~298); add the argument at the pure test calls that lack it
   (`tests/data/S8D-compact-snapshot.test.ts` ~46, `tests/work-graph/S8A-root-path.test.ts` ~75, ~94, ~119, ~164),
   each with the mode its assertions mean. Typecheck is the RED.
2. **A-27 through the public entry, both backends.** Move the cases of `T/S8E-A27-ts-light-scan-contract.test.ts`
   (~28, ~73, ~102) onto the shared platform fixture the A-17/A-19 rows already use
   (`tests/helpers/S8D-platform-fixture.ts`: `fixture(backend, id, entries, { signal, lightScan: { fault } })`,
   `BACKENDS`, `f.graph()`; pattern in `T/S8D-A17-ts-light-scan.test.ts` ~9, ~54) and assert on the public results
   (pages, coverage). For the cancellation case, make it prove the failure branch: several files in a row fail through
   the fault hook; on the first failing file the hook keeps the scan busy past the yield interval
   (`YIELD_INTERVAL_MS`, `W/typescript-light-scan.ts` ~296, real clock; do not add a clock parameter) and schedules
   the abort as a macrotask, so it can only run at the yield in the `finally` (~399); assert the capture comes back
   cancelled the way A-24(4) expects and the hook never saw the file after the yield. Keep the scan-level cases only
   if they test something the public entry cannot reach, and say which.
3. **`inventory` is never `null`** (decision 79). The producer always writes an object
   (`W/project-source-snapshot.ts` ~244–252); the whole-`null` value exists only for old records. Remove it: the codec
   rejects `inventory: null` (`A/architecture-record-codecs.ts` ~471), and the types drop `| null`
   (`W/architecture-language-provider.ts` ~78, `src/contracts/architecture-inspection.ts` ~94, and whatever the
   compiler then names). `inventory.reason: null` for `git` stays. Test: `T/S8E-old-format-rejection.test.ts` ~44,
   ~56 uses an object for the current record and asserts a record with `inventory: null` is rejected.
4. **A-18's 300 edges on the file layer too** (your UNSPECIFIED 4 weakened the row). Keep the module-layer assertion
   (`T/S8D-A18-ts-light-scan.test.ts` ~76–83) and add: through the public `neighbors`
   (`A/architecture-service.ts` ~1076, `direction: 'out'`), each of the 300 files has exactly one outgoing neighbour,
   the next file of the cycle; memory and SQLite. Report the test's time.
5. **The size statement in your reply** (not code). §11.7's 820–1,290 counts added lines. Say the segment's size
   against `s8d-rw3` in that same count (rework 1: +1,754, i.e. 464 over the top), what the remaining lines over the
   estimate are, and why. No mechanical deletion to meet the number.
6. **A-12 comment** (`T/S8E-A12-file-chunks.test.ts` ~93, ~107): the node is 164/165 bytes with the path's two
   bytes; fix the arithmetic in the comment, the 65-chunk result stays.

## 3. Checks (close-out subagent, one vitest command at a time)

`--maxWorkers=2`: `tests/data/`, `tests/architecture/` (production reach included), `tests/work-graph/`,
`tests/composition/`, every `tests/**/S8*.test.ts` and `tests/**/R3d-*.test.ts`, the changed files; `npm run
typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected (no
bwrap). The close-out greps the new and changed tests for hand-written facts and lists each hit with why it is allowed.
No real model calls, no git writes, never ports 3080/3099/44797.

## 4. Reply

Under 600 words: production net per item, the segment against `s8d-rw3` (added and removed), each item RED → GREEN or
how it was checked, A-18's time, item 5's statement, the fact-grep list, checks with numbers, UNSPECIFIED.
