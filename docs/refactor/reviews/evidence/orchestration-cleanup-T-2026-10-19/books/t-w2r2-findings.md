# T wave 2: frozen finding table, rework 2 (lead, frozen 2026-10-20 18:30)

Sources, each finding checked by the lead against the items, the book, the rework-1 table and the code:

- **[C]** the Codex audit of rework 1, three parts (`codex2/t-w2r1a-P1..P3.out.md`; 会出错 3, 不整洁 1);
- **[A]** the Claude audit of rework 1, four parts, each finding with an adversarial verifier
  (`checks/w2r1-claude-audit.md`; workflow `wf_7857ebca-b56`; 19 findings, 13 confirmed, 6 refuted);
- **[FS]** the bubblewrap full suite on `w2r1` (`checks/full-W2R1.txt`): 765 of 766 files, 9773 tests passed, 3 skipped;
  the only failure is W2b-20's store-page pair (memory and SQLite, 30 s timeout), fixed in `03b9cfd`. No row from it.

Rework-1 rows are `W2b-xx` (`t-w2b-findings.md`); this table's rows are `W2c-xx`. Where two sources disagree, §3 says
which way the lead ruled and why. This table binds rework 2 of at most 3 (decision 81).

Copy: `~/dsh-work/slices/s9tb2M` fast-forwarded to `03b9cfd` (`w2r1` = `722ddf3` plus W2b-20), tag `w2r1b`. Line
numbers are at `w2r1` (W2c-14: at `03b9cfd`). **Who applies it:** at 18:14 the user decided that Claude subagents apply
this table too, not DSH (asked after the 14:41 decision, which covered rework 1 only; a second deviation from
decisions 56/81, recorded in the T evidence). Four subagents, each in its own clone of `w2r1b`; the lead reviews every
diff, commits and merges; result tag `w2r2`.

## 0. Rulings

- **R-1 to R-22** (`t-w1-findings.md`, `t-w1r1-findings.md`, `t-w1r2-findings.md`, `t-w2b-findings.md` §0) still apply.
- **R-23 Digests.** A digest the platform computes over input the test fixes itself (an adopt body, a fixed file
  text) is a literal, with the canonical text and its byte count in a comment, computed by hand with `node:crypto`
  over that written text, never through the production codec (W2b-29, W2b-55, W2c-04). A digest over material the
  test does not fix (Kernel-recorded call arguments, a workspace capture) is passed on as returned (W2b-23).
- **R-24 W2b-09 and W2b-55 BLOCKED revoked in part.** Rework 1 sent W2b-09's archive time and W2b-55's whole
  database tail to R-20 as "missing entry point". Both have public reads for some facts (W2c-01, W2c-05); R-20 stays
  only where §1 says so.
- **Rule sheet v2, A7 entry 3** (`books/test-rule-sheet-v2.md:59-66`, also `t-book.md:82`) still names
  `executeChecks: false`. After W2b-27 the stand-in has no such option: read the entry as "the stand-in answers only
  availability; its probe and execute refuse". The wording is fixed in the next sheet version, not in v2 [A P2-03].

## 1. Rows

| 编号 | 位置 | 条目 | 问题 | 改法 |
|---|---|---|---|---|
| W2c-01 [C P1-01, A P1-01] 会出错 · W2b-09 | `tests/work-graph/S4C2-goal-triggers.test.ts:546`, `:537-545`, `:565-678`, header `:24-30` | T1-054 | The archive trigger's expected `at` is taken from the reader's own output (F8): a wrong archive branch that returned any other time would still pass the pairwise-different and whole-result checks. The R-20 reason is false: `plans.queryTaskGraph` returns `TaskRow.rework.entries[]` (`src/core/work-graph/model/plan-contracts.ts:116`), one entry per TaskRequeue with `requestedAt` (`src/contracts/task-failure.ts:211-219`; `src/core/work-graph/state/task-failure.ts:1271-1285`, no archive filter). The kept `w2-base` fake-records case (hand-encoded `RunSnapshot@1`, fake lookup port) loses its basis. | In the graph read the test already makes after the archive (`:495-497`): take the row whose `taskId` is the archive Task, find the `rework.entries` item whose `ref` equals `archiveRef`, use its `requestedAt` as returned as the expected archive `at`. Delete the BLOCKED comments (`:537-545`, `:569-577`), the `w2-base` describe `:565-678` with its own imports and constants, and the BLOCKED/kept-case sentences of the header (`:24-30`). W2b-09 becomes done. |
| W2c-02 [C P3-01, A P3-07] 会出错 · W2b-49 | `tests/runtime/R4b-session-recovery.test.ts:246-248`; `tests/runtime/R4b-session-input-boundaries.test.ts:137` | T2-025, T2-030, T2-032 | The wrong-Session cursor row asserts only `rejected`. Without the cursor binding check (`src/core/agent-runtime/session-operations.ts:426`) the read still fails at `:494` with `unavailable` (the second Session's history is shorter than the frozen bound), so the row still passes. The other-principal row (`:137`) has the same shape. | Assert `{ status: 'rejected', code: 'invalid' }` in both rows; keep the public before/after history comparison. If `:137` does not refuse with `invalid`, report the code it returns and stop on that row. |
| W2c-03 [C P3-02] 会出错 · W2b-49 | `tests/runtime/R4c-execution-history.test.ts:321-324`, `:342-345` | T2-025, T2-030, T2-032 | The other-Session row and the three limit rows (0, 201, 1.5) are refused by the layer below as well (`session-operations.ts:426`, `:713`): removing the reader's own checks (`src/core/agent-runtime/observation-recovery.ts:269`, `:260`) leaves every assertion passing (F11). | Wrap the real history with the file's `spyOn` (`:94`) for these four rows (through `expectRefusedWithoutChange` or beside it); after the cursor is set up, clear the recorded requests and assert the refused call made **0** lower requests. Keep the refusal code and the public before/after reads. |
| W2c-04 [A P3-03] 违规 · W2b-56 | `tests/composition/A1-graph-session-platform.test.ts:106` (used at `:115`, `:118`, `:175`, `:221`), comment `:98-101` | T3-035 | `contentDigest` in the expected architecture is `adopted.value.baseline.contentDigest`, the program's output (F8): a consistently wrong digest passes. It is a digest over the test's own fixed adopt input, not an issued value (R-23). | Literal per R-23: write the canonical text (`src/core/work-graph/architecture/catalog-record-codecs.ts:193-202`, digest at `catalog-service.ts:517-518`) and its byte count in the comment, compute the SHA-256 by hand with `node:crypto` over that text, and put the hex literal in `:106`. The audit's own count was 183 bytes and `27272b141e404048373f9886a5c179a23d500d987d486619fae262023fb055d5`: check it, do not copy it. Update the comment `:98-101`. |
| W2c-05 [A P3-02] 违规 · W2b-55 | `tests/composition/R3d-R3g-platform.test.ts:223-236` | T3-038 | Rework 1 sent the whole database tail to R-20. Two of its four facts have public reads: the current observation's ref through `platform.architecture.observationState` (`current.captureRef`, `src/composition/create-platform.ts:1327`, `src/core/work-graph/architecture/architecture-service.ts:856`) and "no active baseline" through `readArchitectureRevision({ selection: { kind: 'current' } })` → `not_found` (`catalog-service.ts:373`, `:772-775`). | Before the reopened platform closes, assert the observed ref through `observationState` (replacing `:230-232`) and the missing active baseline through `readArchitectureRevision` current → `not_found` (replacing `:233-235`). The SQLite read stays only for the pointer `revision` (`:227`) and `readThrough` (`:229`), with a comment naming R-20 (missing entry point, `src/contracts/architecture-observation.ts:53-60`). W2b-55 stays partial for those two. |
| W2c-06 [A P1-03] 不整洁 · W2b-57 | `tests/helpers/S2B-r2-track-support.ts:13-16`, `:42-82` | T1-036 | `seedRawRunVariant` lost its only caller when `S2B-r2-r5-not-entered.test.ts` was deleted; it is the only user of the `canonicalJson`/`JsonValue`, `RunRef` imports and `RUN_SCHEMA_ID`. | Delete the function with its comment, the two imports (only the names it alone used) and the constant. |
| W2c-07 [A P2-02] 不整洁 · W2b-27 | `tests/scenarios/**` (27 files, 53 places; e.g. `K3-05-review-round.test.ts:48`, `:70`) | T2-040, T2-046 | The stand-in's state has only `available` (`tests/scenarios/support/process-sandbox-standin.ts:16-18`); the hoisted `executeChecks: false` fields and the `sandbox.executeChecks = false` resets in `afterEach` are dead. | Delete every `executeChecks` field and reset under `tests/` (`grep -rn executeChecks tests`); nothing else in those files. |
| W2c-08 [C P2-01] 不整洁 · W2b-26 | `tests/helpers/K3-review-card-fixture.ts:337` | T3-103 | The new comment cites `S5-decision-fixture.ts` lines 471/497/515, which now point elsewhere. | Name the symbols instead: `additionalSchemas`, `forwarded`, `observeRecords`. |
| W2c-09 [A P3-04] 不整洁 · W2b-40 | `tests/helpers/R4-history-turn-support.ts:56` | T2-022, T2-025, T3-036, T3-101 | The `replies` comment says "after the first text reply"; `:127-128` replaces the single `text` reply when `replies` is given. | Say that `replies`, when given, replaces the single `text` reply. |
| W2c-10 [A P3-05] 不整洁 · W2b-40 | `tests/composition/K-R-previous-turn-bounds.test.ts:27-36`, `:85`, `:93` | T2-022, T2-025, T3-036, T3-101 | The only test sets `seam.absent = true`, so the counting wrapper (`:33`) is unreachable and `expect(seam.calls).toBe(0)` (`:93`) cannot fail; the comment "(a counter records any call)" describes a guard that does not exist. | Comment: the seam is absent; a call would answer `unsupported` and the brief could not be built. Delete the counter wrapper and the `:93` assertion (and `calls` if nothing else reads it). |
| W2c-11 [A P1-04] 建议, adopted · W2b-10 | `tests/work-graph/A2-disposition-change.test.ts:356-361` | T3-106 | The comment says the restart follows `restartedHost`, which rebuilds `entry` under the new Host; the code passes the old `b2.entry` (unused on this missing-probe path, `src/core/agent-runtime/run-reconcile.ts:303-308`, `:397`). | Comment only: the entry is the B2 fixture's and is not used on the W-14 missing path. No code change. |
| W2c-12 [A P2-05] 建议, adopted · W2b-35 | `tests/runtime/S3-context-assembler.test.ts:687-688` | T2-034 | `counts.inputs` is never incremented in this world (no input requirements; the graph reader reads inputs through the raw owner), so its zero check cannot fail; the "no re-read" claim rests on `counts.graph`. | Comment beside `:687-688`: this world declares no inputs; input reads inside the graph read go through the raw owner and are counted in `counts.graph`; `counts.inputs` only guards a direct page read by the assembler. No assertion change. |
| W2c-13 [A P3-01] 建议, adopted · W2b-41 | `tests/app/session-rendering.test.ts:447` | T3-006 | `html` contains `future.unknown` through the raw block anyway, so `:447` adds nothing to `:448`; the unrecognized-record label (`timeline.ts:275-278`) is not asserted. | Assert the label as rendered (`未识别记录 · <code>future.unknown</code>`, read the exact escaping from `timeline.ts:275-278`); keep `:448`. |
| W2c-14 [A P4-01] 建议, adopted · W2b-20 | `tests/work-graph/unknown-call-review-list.test.ts:287-307` (at `03b9cfd`) | T1-070 | The third record `later` is `needs_decision`, so the pending-only query after the cursor returns `[]` even for an implementation that returns an empty page for any foreign cursor; nothing shows the cursor sits after `decided`. | Make `later` a `pending_review` record (`createPending`); the pending-only query with `wider.value.nextCursor` as returned then expects exactly `[later]` and `nextCursor: null`. Keep the rest of the row. Not the store-page test. |

Each row is all or nothing. Run the changed files on both backends where they run both; for a helper change, its
importers (R-15). No raised timeout (R-14, R-22 unchanged).

## 2. Lead text fixes (no rework row)

- `t-w2b-findings.md` §6 W2b-42: "SQLite only (the memory Host answers `unsupported` for settings)" is wrong: a memory
  Host has settings once it gets a `settingsDirectory` (`src/app/host.ts:324-329`). The row stays SQLite only, like its
  source rows; the reason text is corrected [A P3-06].
- `t-w2b-findings.md` §6: W2b-09 and W2b-55 per R-24; W2b-20 done (`03b9cfd`).

## 3. Not adopted, and conflicts

- **W2c-01's route** [C P1-01 `readContinuationBasis` vs A P1-01 `queryTaskGraph`]: both reads are public and give the
  same `requestedAt`; the graph read is already in the test and on the platform's face, so the lead chose it.
- **The gate/only-carrier row** [A P1-02, refuted]: not a wave-2 conversion (same text at `w2-base :510-518`); each
  adopt carries one error and fails without its guard. No action (`t-w2b-findings.md` §6).
- **The second F07 (5,000 cards)** [A P2-01, refuted]: untouched `w2-base` code outside T1-067; W2b-22 named only the
  first F07. Goes on the user's end-of-T list with the other F-instances outside items (it uses `decisionSourceKey`
  for expected keys and `anomalyDouble`).
- **K3-48-2 `proposalFixture` Session** [A P2-04, refuted]: the S5 default path stays for the user (§0 of rework 1).
- **K3 review round Sessions** [A P4-02, refuted]: outside W2b-20's locations; the S5 default path stays for the user.
- **`k3_35AuthorizeConfigurationFor` export** [A P4-03]: the neighbouring `k3_35AuthorizeConfiguration` is exported the
  same way; follows the file. No action.
- **W2b-55 tail as a rework violation** [A P3-02, refuted as such]: the verifier is right that rework 1 followed the
  table; the table was wrong. Adopted as a table correction (W2c-05, R-24).
- **W2b-41 stronger assertion** [A P3-01, refuted as a violation]: adopted as a suggestion (W2c-13): the assertion the
  rework added is implied by the next one.

## 4. Rework 2 result (`w2r2` = `c05c7d7`)

**Who did it.** Four Claude subagents (workflow `wf_b1327c23-b72`, 7.5 min, 0.54M subagent tokens), each in its own
clone of `w2r1b` (`~/dsh-work/scratch/w2r2-A..D`), by the user's decision at 18:14 (header). The lead reviewed every
diff, recomputed the W2c-04 digest independently (183 bytes, `27272b14…55d5`, equal), committed per clone by pathspec
(`222cd58` A, `fc63710` B, `36fa14b` C, `9aef728` D), merged B..D into A (`ce4e685`, `4e1ba4b`, `c05c7d7`, no
conflict) and fast-forwarded `s9tb2M`; tag `w2r2`. Typecheck 0 errors, `check:architecture` OK. A `--noUnusedLocals`
pass over the 41 changed files finds no unused name from this rework (12 hits in touched files predate it: the edits
there are the `executeChecks` lines and one comment). Agent reports: `replies/t-reply-W2R2-agents.md`.

Ledger `checks/ledger-W2R2.txt` (`03b9cfd..w2r2`): 9 removed assertions and 2 removed tests, each mapped:
`session-rendering:447` → W2c-13 (stricter label); `K-R-previous-turn-bounds:93` → W2c-10 (could never fail);
`R3d-R3g-platform:231`, `:233` → W2c-05 (public reads before the close); `R4b-session-recovery:248` → W2c-02 (code
pinned); `S4C2-goal-triggers:578`, `:657`, `:669`, `:671`, `:676` → W2c-01 (the `w2-base` BLOCKED case deleted by the
row); `unknown-call-review-list:307` → W2c-14 (exactly `[later]`). No unplanned deletion.

| 编号 | 结果 | 备注 |
|---|---|---|
| W2c-01 | done | archive `at` = the graph read's `rework.entries[ref = archiveRef].requestedAt`; `w2-base` case, its imports and the BLOCKED text deleted; 3/3. W2b-09 → done |
| W2c-02 | done | both rows `code: 'invalid'`; the other-principal row does refuse with `invalid` (`session-operations.ts:426`) |
| W2c-03 | done | opt-in `noLowerRequest` on `expectRefusedWithoutChange`, the file's `spyOn`; teeth checked: with `observation-recovery.ts:260-262`, `:269` removed in the clone exactly these four rows fail (1 lower request), `src` restored |
| W2c-04 | done | literal with the canonical text and 183 bytes in the comment; the test runs on SQLite only (as before) |
| W2c-05 | done | `observationState` and `readArchitectureRevision` current → `not_found` before the reopened platform closes; SQLite tail: revision and `readThrough` with the R-20 comment. W2b-55 stays partial for those two |
| W2c-06 / 08 / 09 / 11 / 12 | done | 06: four direct importers green |
| W2c-07 | done | 53 places in 27 files; `grep -rn executeChecks tests` = 0; the 27 files green |
| W2c-10 | done | counter wrapper, `calls` and the `:93` assertion deleted; comment rewritten |
| W2c-13 | done | `未识别记录 · <code>future.unknown</code>` (`src/ui/views/history/timeline.ts:277`) |
| W2c-14 | done | `later` is `pending_review`; the bounded query returns exactly `[later]`, `nextCursor: null`; both backends |

Noticed by the agents, not fixed (outside the rows): `S4C2-goal-triggers.test.ts` header `:31` names only the timeline
read as the public read of times; `R3d-R3g-platform.test.ts:53` `inspectSchemas` still lists
`PLAN_GOVERNANCE_RECORD_SCHEMAS`; `K-R-previous-turn-bounds.test.ts:88` comment still says "the counted case";
`R4b-session-input-boundaries.test.ts:117` `code?:` could now be required; R4c's other-principal row is refused only
by the layer below (a spec question whether the reader should check the principal itself).

Full suite on `w2r2`: `checks/full-W2R2.txt`: 766 of 766 files, 9774 passed, 3 skipped, 3,476 s (slower: two audits, rework 3
and the coverage start ran beside it). One test fewer than `w2r1` (W2c-01 deleted the `w2-base` case).
