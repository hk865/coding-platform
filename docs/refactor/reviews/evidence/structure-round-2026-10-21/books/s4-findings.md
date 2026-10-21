# Structure round, S4 (D3b): frozen findings table (decision 80; lead, 2026-10-22)

Audit: Codex read-only, four parts Q1–Q4 on `D:/cxt/s85s4` (S4's commit `39fee06` against `s85-n2-base`), 00:07–00:18.
Codex found no production behaviour difference. 11 rows: 违规 10, 不整洁 1. The lead checked every row against the
copy (s9s85-S4) and re-ran S4's probes on fresh copies (`probe-recover/rerun-S4.sh`, log `rerun-S4.log`: the same
counts and results as S4's report). Full suite on `39fee06`: 755 files passed, 9,668 passed, 3 skipped.

| Row | Class | Where | What | Lead's check | Ruling |
|---|---|---|---|---|---|
| Q1-01 | 违规 (proof) | `e-assembler/probe-hook.ts:62,249` | The deps proxy records `kernelStores.withStore`'s callback only by name, so the Kernel history reads inside it (window requests, `reader.read` arguments, count, order) are not logged; a test that calls the re-exported `readKernelCommandFacts` directly (`K3-B3-runtime-fail-closed.test.ts:75`) bypasses the factory wrapper. | True. The callback's results are logged (`withStore` outcomes, the entries) and equal apart from Q1-03's fields, which covers most argument changes, but not the arguments themselves. | **Fix (proof)**, rework 2 item 5. |
| Q1-02 | 违规 (proof) | `e-assembler/read-points.txt:7`; `declared.json:18` | `bodies.read` = 4 marks three call sites reached; all four reads are the change capture; the baseline bundle and baseline artifact reads (`context-workspace-facts.ts:106,145`) are not reached and not in the reply's unreached table. | True (same as Q2-02's third point). | **Fix (proof)**, merged into Q2-02. |
| Q1-03 | 违规 (proof) | `e-assembler/REPORT.md:48`; `fields-*.txt` | Six leaf paths in dependency return values (`entries[].body.text`, `sourceDigest` and the requeue basis digests) are not byte-proven; fix their source in the copies. Q2 adds: 18 of the 20 `body.text` rows sit in logs over 1 MiB that the audit kit left out, so "nothing else hidden" was not checked. | The lead parsed the JSON inside every differing string over all 613 records (`probe-recover/inner-diff.mjs`, S4's runs and the lead's re-run): in both base/base and base/result, the 20 `body.text` differ only in `.checksum` and `.payload.workspace.revision`; the other five paths are digests over them; nothing else differs. The assembler results (141) and the stored bytes (109) are equal, so nothing the assembler returns or stores depends on these fields. The frozen Kernel computes them from the live temporary workspace. | **Rejected**: book §5.0 rule 3 lists such a path as "not byte-proven" with the reason; S4 did; the lead's check closes "nothing else hidden". |
| Q1-04 | 违规 | `context-history-facts.ts:14` | The base comment on `KERNEL_TERMINAL_EVENTS` (`context-assembler.ts:958`: the Kernel `agent.event` types that end a Turn: a completed history boundary (LA-1)) was dropped. | True. | **Fix**, rework 2 item 1. |
| Q2-01 | 违规 (proof) | `e-assembler/run-capture.sh:35–62` | The whole-result capture misses `tests/business/WP1-start-refusal.test.ts`, which reaches the real `assembleTask` through `tests/helpers/WP1-units-fixture.ts:512`. | True, and wider: 11 test files reach the real assembler through the helpers `WP1-units-fixture`, `WP1-entry-fixture`, `K3-35-prepare` and `task-claim-fixture` (`prepareTaskForReal`, `prepareQueryForReal`) and are not in the capture (list in rework 2 item 4). | **Fix (proof)**, widened to the 11 files, rework 2 item 4. |
| Q2-02 | 违规 (proof) | `e-assembler/declared.json`, `read-points.mjs:25`; reply §5.3 | The read-point list is kept per method name, so unreached call sites hide behind a reached one: `unknownCallReviews.listReviews` (base `:1503`), `kernel.readTurnBounds` (base `:1598`, `:1607` via `continuation-brief-assembly.ts:564`), the baseline bundle and baseline artifact `bodies.read` (base `:1053`, `:1092`). Q2 also notes the report says "0 differences" where `compare.mjs` prints `RESULT: different` (the 26 leaves of Q1-03). | True. | **Fix (proof)**, rework 2 item 6. |
| Q3-01 | 违规 (proof) | `e-render/payload/edge-cases.ts:211,251`; `context-rendering.ts:169,175` | The 140 edge inputs miss: goal and task both null with optional rows and budget 0 (omission block on the role section, its range); budget −1 with `optional: {}` (fallback with no block); the two Query templates with `prelude: ''` and `goal: null`. | True; the code reads right (the role slot takes the block; an empty fallback adds nothing), but no case shows it. | **Fix (proof)**, rework 2 item 7. |
| Q3-02 | 违规 | `context-rendering.ts:171,223` | Two rule comments dropped: why the omission block extends the last required section's interval (base `:350–353`: so those lines are not outside every interval), and that the review instruction is the LAST section and only for a review-purpose Work Run (base `:384–385`). | True (the first is half kept: the "why" clause is gone). | **Fix**, rework 2 item 2. |
| Q3-03 | 不整洁 | `context-rendering.ts:2–9` | The file header names the run (`S4 D3b`) and narrates how the base built the text and what this module replaced. | True; no other S4 file has such a comment (lead's grep). | **Fix**, rework 2 item 3. |
| Q4-01 | 违规 (proof) | `e-render/replay.mjs:54,59` | The `JSON.parse` reviver that turns the `undefined` marker into `undefined` deletes the key (and leaves a hole in an array), so a replayed argument is not the recorded one where the marker occurs (14 markers in `base-run1.jsonl`). | True. Replay still feeds the same arguments to both copies, but they are not the recorded ones. | **Fix (proof)**, rework 2 item 8. |
| Q4-02 | 违规 (proof) | `e-render/REPORT.md:11,14` | Two base recordings differ in 313 of 2,156 records (59 in outputs); replay on the recorded arguments replaced "determinism first" (rule 3), and those paths are not listed as not byte-proven. | The 313 come from the arguments (temporary skills paths, random ids). Replaying run 1's arguments on the base reproduces run 1's outputs 0/2,156 (the formatters and renderers are pure functions of their arguments), and on the result gives 0/2,156; the lead's re-run on fresh copies gave the same, and the replayed files of base and result are byte-identical. The determinised whole-result proof (e-assembler) covers the same outputs end to end inside the 141 assembler results. Nothing was erased. | **Rejected**: replaying the same recorded arguments through both copies meets rule 3's purpose for pure functions; the report says so (rework 2 item 8 restates it). |

Fix rows: Q1-01, Q1-02 (with Q2-02), Q1-04, Q2-01 (widened), Q2-02, Q3-01, Q3-02, Q3-03, Q4-01. Rejected: Q1-03,
Q4-02. Production changes are comments only (Q1-04, Q3-02, Q3-03); everything else is proof material.

## Rework 2 (S4's first rework; `s85-R2-1022`)

DSH, 00:25–00:48 (1,371 s), book `s85-r2-book.md`; commit `239395d` "S85 S4 fix: Q1-04 Q3-02 Q3-03" (two files,
comment lines only; the three texts exactly as the book's §2). Reply `replies/s85-reply-R2.md`; probes in the copy
`s9s85r2/.dsh-scratch/R2/probes/`.

- **Q2-01:** 36 test files in 6 batches (S4's 25 and the 11), 2,140 records on each of base 1, base 2 and the result;
  every one of the 11 captures; 10 of S4's 25 capture nothing (pure-function tests), listed. 208 records come from
  `beforeAll` fixtures with no test-file frame (bucket `unknown`), equal in count and content on both sides.
  base1/base2 equal; base1/result: 12 differences, all the copy root in the recorded `configuration.skills.resourceRoot`
  arguments; `--result-only` equal. To compare the 11 files' results at all, DSH pinned the Kernel workspace
  revision's inputs in both copies with the same edit (`workspace-sandbox.js`: size, mtime and ctime fixed; the
  copies' `candidate-workspace-reader.ts`: SQLite `-shm`/`-wal`/`-journal` sidecars skipped), because the widened
  files carry the workspace revision into the rendered input (book §5.0 rule 3; nothing enters the repository). With
  it, the six paths of Q1-03 are equal as well.
- **Q1-01:** the Kernel store and reader calls inside `withStore` callbacks (322: 162 head, 160 page reads) and the
  directly called re-exports (191) are logged with arguments, order and outcome; equal on both sides.
- **Q2-02 / Q1-02:** per-call-site list by the first stack frame under `src/` (a separate site log, not in the
  compared payload); zero-call sites read side by side (`listReviews`, `readTurnBounds`, baseline bundle and artifact
  `bodies.read`, `readBaselineBlob`, `readCurrentFile`, `forWorkspace`, and the five deps members never read).
  `commandRerunRequests.listRequests` is now reached (8 calls, via `K3-B3-newest-request-order`).
- **Q3-01:** 158 edge cases (18 added); base twice byte-identical; base vs result 0 differences, 0 errors.
- **Q4-01:** markers revived in place after parsing (keys and array indexes kept; the three-line sample shows missing,
  `undefined` and `null` apart); S4's 2,156 recorded calls replayed on base and result: 0 differences each, replay
  outputs byte-identical.
- Checks: typecheck, check:architecture, build; 8 test files (the four of the book and `tests/architecture`), 100
  passed.

**Lead's check** (from the run's outputs): the diff is the book's three texts, comments only; `inner-diff.mjs` on
`r2-base1`/`r2-base2` gives no difference and on `r2-base1`/`r2-result` only the 12 `resourceRoot` arguments;
probe counts equal per probe (task 314, query 10, attention 1, deps 720, direct 191, kernel 322, stored 285 + 285
and 6 + 6); the sidecar edit is identical in both copies; edge files `cmp`-equal; replay outputs `cmp`-equal.
The per-site table's cell `48+1 / 47+1` (readKernelCommandFacts) is a write error in the report: recounted from the
site logs, every caller path has the same count on both sides (`byAdapterId` 24, 20, 20, 29, 72; `withStore` 24,
20, 20, 28, 72).

**Codex quick check** (`codex2/s85/r2/R2.out.md`, 00:51–00:59): the diff changes comments only and the three texts
equal the book's; Q1-02, Q1-04, Q3-01 (it names the 18 added cases; none missing), Q3-02, Q3-03 and Q4-01 fixed.
Four rows, all on the proof material; the lead rules without a third rework:

| Row | Class | What | Lead's ruling |
|---|---|---|---|
| R2-01 | 违规 | The copies' new edits (SQLite sidecars skipped in `candidate-workspace-reader.ts`; size, mtime and ctime pinned in the Kernel's `workspace-sandbox.js`) change the measured algorithm, so zero differences do not show the original algorithm equivalent. | **Rejected.** Book §5.0 rule 3 asks for exactly this: the same determinising edit in both copies. The edited code is not part of the round (unchanged between base and result; the Kernel is frozen), so it is an input to the code under test, not the code under test; the assembler's calls into it (names, arguments, order) are logged and equal. Without these edits, S4's own proof over 25 files differed only in the six revision/checksum paths (Q1-03, closed by the lead's check). |
| R2-02 | 违规 | 208 records from `beforeAll` fixtures have no test file; their keys repeat across files, so pairing by occurrence does not restore identity; the lead's `inner-diff.mjs` keyed 2,036 of 2,140 records. | **Closed by the lead's check, no rework.** Compared as multisets of raw lines (each record's whole serialisation, parent sequence numbers included): base 1 and base 2 are equal over all 2,140 lines; base 1 and the result differ in exactly 12 lines, all of them the recorded `configuration.skills.resourceRoot` argument; the 208 `unknown` lines are the same multiset in all three runs. Every record therefore has a byte-identical counterpart, whatever the pairing. |
| R2-03 | 违规 | The per-site table puts other counts in the base/result column: 162/160 is head/page reads (each copy has both), 49/48 mixes `byAdapterId` and `withStore`; base `:1358` is not an owner construction (the continuation owner is at `:1582`). | **Closed by the lead's correction** (the lead had recounted the same from the site logs): each copy has 162 head and 160 page reads; on `readKernelCommandFacts`' path each copy has 49 `byAdapterId` and 48 `withStore` calls; base `:1279` builds that owner, `:1358` is the call that passes `kernelStores` to `readKernelCommandFacts`, `:1582` builds the continuation owner. The counts per caller path are equal on both sides. |
| R2-04 | 违规 | `COMMANDS-R2.md`: after `cd ../../base-e` the next `cd ../../result-e` points outside `R2/`; the replay's input path `./.dsh-ref/…` is relative to the probe directory, not the copy root. | **Closed by the lead's note** (the outputs exist and the lead `cmp`-checked them): read `cd ../result-e`, and the replay input `/home/han001/dsh-work/slices/s9s85r2/.dsh-ref/s85-probes-S4/e-render/base-run1.jsonl`. |

S4 is accepted with `239395d`. Reworks used in the round: two (night 1's rework 1, S4's rework 2).
