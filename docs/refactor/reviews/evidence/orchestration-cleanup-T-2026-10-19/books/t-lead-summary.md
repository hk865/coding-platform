# T: the lead's summary (time line, rulings, deviations, lead fixes, checks; 2026-10-19/20)

Times are local (UTC+8), taken from file times and run records where they exist. DSH run seconds, tokens and context
peaks are in `checks/dsh-runs.txt` (UTC start times); Codex answers in `checks/codex-calls.txt`; Claude workflows in
`checks/claude-workflows.txt`.

## 1. What T is

HANDOFF decision 79-4: one round over the whole test suite and the production code that only old data or old
interfaces need. Tests that are outdated, duplicated or trivial are deleted or merged, each with its reason (the
business test that covers it, or the behaviour that no longer exists). Tests that wrote facts by hand are converted to
public steps under the test rule sheet. Production code kept only for old data or old interfaces is removed (decision
79: no old-data compatibility). Before and after T, a full coverage run (decision 79-4); what stays uncovered after T
is a candidate only.

Base: `t-base` = repository `3a9f6d94`. T result: `w2r3` = `9a69bdb` in the official copy `~/dsh-work/slices/s9tb2M`.
37 commits `t-base..9a69bdb` (DSH 11, Claude Code 26).

## 2. Time line

**10-19, inventory and books**

- 13:23–13:48 inventory, 11 areas (tests A1, A2, B, C, D, E1, E2, F; production P1, P2a, P2b), each area twice:
  - Codex read-only (`codex/t-inv-*`): 526 findings;
  - DSH (`t-A1-1019` … `t-P2b-1019`; 592–1,311 s each, 155.1M tokens together): 590 findings.
- 13:50–14:43 two Claude verification workflows: one skeptic per batch of Codex findings (60 agents, 10.41M subagent
  tokens); DSH findings matched against Codex per area, then the new and conflicting ones verified (53 agents, 8.47M).
  Match: same 262, conflict 133, new 195.
- Result `books/t-final-summary.txt`: 721 rows. 529 act (the skeptic's action is final whatever its verdict), 192 no
  change. Tests 368 (delete 142, merge 124, convert 88, other 14), production 161.
- Lead rulings on the inventory: the 131 conflicts as the skeptics judged (Codex side 86, DSH side 43, neither 2);
  RL-15b lower bound 9,900 ms; the Role writer chain kept, its notes rewritten to decision 6 and MVP-BEHAVIOR B01;
  the 9 refuted P1 keeps become deletes; C1's transfers and N0 as Codex P1-183..188 proposed.
- 13:29–15:25 coverage before T (Claude subagent, copy `s9tcov`): see §6. The dependency `@vitest/coverage-v8`
  4.1.10 (the user approved it) was committed as `47cc63e8` (not pushed).
- 14:50 **user decisions**: (1) the 60 `core-http-types` aliases and the 2 `main.ts` CLI types stay (62 entries); their allowlist
  reason changes from pre-batch to wire-format. (2) Decision 79-1, a database prompt at open time: none ("我们没有启动过
  旧格式的产品，目前还是未完成"); status quo, no marker, no message change.
- 15:00–16:45 books. Items grouped so that each production removal travels with the tests that pin it. Codex book
  check, 6 runs (15:45–15:57, `codex/t-bk-*`): all six said "fix before building", 213 fixes. 99 added files fell on
  another group's whitelist, so the parallel five-group plan was dropped for **two waves**:
  - wave 1: production with the tests that pin it (TP, 173 items; TQ, 115 items);
  - wave 2: the remaining tests (T1, T2, T3), on the merged wave 1.
- 16:11 Codex quick recheck of the changed clauses (`codex/t-bk2-W1`): 2 fixes, both applied (T2-064 moved into TP
  as TP-173; book rule 2 allows exact assertion changes an item spells out). Wave-1 books final (`books/t-book.md`,
  `t-run-TP.md`, `t-run-TQ.md`, `t-items-TP.md`, `t-items-TQ.md`, `t-files-*.txt`).

**10-19 evening to 10-20 morning, wave 1**

- 18:00 TP and TQ started (DSH).
  - TQ stopped at 18:16 on the context limit (handoff); TQ2 (19:42–19:45) only committed. 107 done (the reply's own item table; its HANDOFF
    says 100, an arithmetic slip: 100 + 3 + 5 = 108, not 115); partial TQ-001,
    TQ-091, TQ-111; BLOCKED TQ-103, 104, 112, 114, 115.
  - TP 18:00–21:41 (13,258 s, 40.0M tokens, peak 334K): 157 done, 7 partial, 9 BLOCKED by the reply's
    item table (its final note says 147 / 11 / 15 "including absorbed items"; the table does not give those numbers:
    all 9 absorbed items are done).
- 21:41–21:46 wave-1 merge in `s9tbW1`: TQ applied onto TP (`11d46d5`; the allowlist merged by entry, 164 entries, no
  conflict; `S5-decision-fixture` takes TP's side) and one lead fix (`5daea2e`, §4).
- 21:46–22:29 full suite W1: 5 files failed, 24 tests. 8 expected from BLOCKED items (B-02, B-03, W1-26); 16 were two
  merge regressions, made rows W1-43 and W1-44.
- 22:03–22:12 Codex full audit, 7 groups (`codex/t-aud-G1..G7`): 会出错 5, 违规 35, 不整洁 20.
- 22:40 table `books/t-w1-findings.md` frozen: W1-01..W1-44, B-01..B-15 (BLOCKED rulings), rulings R-1..R-6, lead
  items L-1 (AD08) and L-2 (untested guards).
- 22:55 test rule sheet v2 frozen (`books/test-rule-sheet-v2.md`), after Codex's first instance list
  (`codex/t-v2-list`).
- 23:01–01:41 rework 1 (DSH): segment 1 stopped at the context limit after 1,023 s (63.8M tokens, nothing committed);
  segment 2 (8,448 s, 28.2M) finished → `ed26c44`.
- 01:42–02:22 full suite W1R1 green: 773 files, 9,929 passed, 5 skipped, 2,457 s.
- Codex audit of rework 1 (`codex/t-r1-R1`, `t-r1-R2`) and its evaluation of the B-14 list (`codex/t-r1-B14`) →
  `books/t-w1r1-findings.md`: W2-01..W2-25, rulings R-7..R-9.
- 02:23–03:35 rework 2 (DSH; it reached the context limit after everything was committed) → `1c31c27`.
- 03:35–04:25 full suite W1R2 green: 773 files, 9,929 passed, 5 skipped, 3,072 s.
- Codex audit of rework 2 (`codex/t-r2-Q1`, `t-r2-Q2`) → `books/t-w1r2-findings.md`: W3-01..W3-12, rulings R-10..R-12.
- 04:26–04:41 rework 3 (DSH; the last DSH rework, decision 81) → `254617d`.
- 04:42–05:31 full suite W1R3: 772/773 files; `S3-context-inputs` ×2 (IN05: lookup index `session-anomaly-by-task`
  not registered). DSH's sandbox had no bubblewrap, so it never ran IN05.
- Codex audit of rework 3 with patches (`codex/t-r3-P1`): 会出错 1 (IN05), 违规 1. The lead applied them under decision
  81 (`67d547d`, `d4c4cea`, §4). **Wave 1 closed on `d4c4cea`.**
- 05:50–07:05 the complete v2 instance list (Codex): pass 1, 7 groups (`codex/t-v2g-*`), stalled on listing every
  ordinary public input; pass 2 narrowed to what v2 changed (`codex/t-v2n-*`, L7 split into L7a/L7b). All groups
  complete: F1 312, record-store F3 0, A7 out of bounds 4. Index `books/t-v2-instances.md`.

**10-20, wave 2**

- 11:55 wave-2 books (`books/t-book-w2.md`, `t-run-T1..T3.w2.md`, `t-items-T?.w2b.md`, `t-files-T?.w2b.txt`). Codex
  refresh against `d4c4cea` (`codex/t-w2r-T1..T3`): OK 214, CHANGED 14 (8 + 5 + 1), DONE 7 and GONE 1 dropped
  (`books/t-w2-dropped.md`), BLOCK 2 (lead override: convert the rest, the event sub-part stays).
- 12:00–13:35 T1, T2, T3 (DSH, segment a).
  - T1 5,529 s, 37.3M: done 65; partial T1-025, T1-068 (event sub-parts, as ruled), T3-106; BLOCKED T1-036.
  - T2 5,704 s, stopped by its time limit, 14.9M: done 58; partial T1-070, T3-080, T3-103; T2-034 not started.
  - T3 3,204 s, 32.1M: done 97; partial T2-025, T3-064.
- 13:36 merge in `s9tb2M` → `4807e64` (one conflict, §4). 13:36–14:21 full suite W2a: 6 files failed, 8 tests (id
  shifts from one shared helper, and 30 s timeouts on scale rows).
- 13:47–14:28 three audits of wave 2, run side by side:
  - Claude pre-audit, 6 parts, each with a skeptic (12 agents): 40 confirmed, 4 rejected (`checks/w2-preaudit.json`);
  - Claude ledger-cover check, 11 chunks plus skeptics (20 agents): 15 confirmed, 4 rejected
    (`checks/w2-ledger-cover.json`);
  - Codex, 6 parts (`codex/t-w2a-*`): 会出错 15, 违规 47, 不整洁 8.
- 14:38 table `books/t-w2b-findings.md` frozen: W2b-01..W2b-57, rulings R-13..R-21 (R-22 added 17:10). Its header, rewritten
  after the user's 14:41 decision, is dated 15:00.
- 14:31 and 14:40 the user asked the lead to use the weekly quota left before the 15:00 reset; 14:41 the user: "你可以现
  在自己就干了，不必等到 DSh。" → **rework 1 by Claude subagents** (§3). Workflows: lead rows (5 agents), more rows
  (8 agents), the heavy rows each in its own clone (5 agents), then three single agents (W2b-36, W2b-09, W2b-20). The
  lead reviewed every diff, committed per clone and merged → `722ddf3`; W2b-20 → `03b9cfd`.
- 17:26–18:13 full suite W2R1 (`722ddf3`): 765/766 files, 9,773 passed, 3 skipped, 3,017 s. Only the W2b-20
  store-page pair (30 s timeout), which `03b9cfd` fixes (R-22).
- 17:43–17:49 Codex audit of rework 1, 3 parts (`codex/t-w2r1a-*`): 会出错 3, 不整洁 1. 18:08 Claude audit, 4 parts
  with skeptics (8 agents): 19 findings, 13 confirmed (`checks/w2r1-claude-audit.md`).
- 18:14 **user decision**: rework 2 also by Claude subagents (§3). Table `books/t-w2r2-findings.md`: W2c-01..W2c-14,
  rulings R-23, R-24. 18:16–18:24 four agents in their own clones → merged `c05c7d7`.
- 18:26–19:21 full suite W2R2 green (`c05c7d7`): 766 files, 9,774 passed, 3 skipped, 3,476 s.
- 18:35 Codex audit of rework 2 (`codex/t-w2r2a-P1`, `-P2`): 0 findings. 18:41 Claude audit (4 agents): 5 findings, 5
  confirmed (`checks/w2r2-claude-audit.md`).
- Table `books/t-w2r3-findings.md`: W2d-01..W2d-05, all one- or two-line edits; **the lead applied them** (decision
  80-4) → `9a69bdb`. 18:49 Codex quick check (`codex/t-w2r3q`): 0 findings. **Wave 2 closed (3 of 3 reworks).**
- 19:22 the merge copy `s9tmerge` = the worktree's `47cc63e8` + `t-base..9a69bdb` → `e99b385`; build, typecheck,
  architecture check 0; 19:22–20:23 the merge full suite (`checks/full-TMERGE.txt`): 766/766, 9,774 passed, 3 skipped,
  3,592 s. 18:57–20:14 the coverage after T on `s9tcova` (§6). Committed into the worktree as `0e381ce4` (tree =
  `e99b385`; not pushed).
- 19:41–19:50 the docs drafts (DSH, `books/t-docs.md`); then the Codex facts check (`codex/t-docs-facts`) and a Claude
  check (`claude/docs-claude-check.md`, 79 agents); the lead rewrote the drafts.

## 3. Deviations from the agreed process

1. **Wave-2 rework 1 by Claude subagents, not DSH** (user, 10-20 14:41). Decisions 56 and 81 give reworks to DSH. The
   user's words covered that rework only.
2. **Wave-2 rework 2 by Claude subagents** (user, 10-20 18:14, asked "第二轮返工交给谁做？", answered "Claude 子 agent").
3. **Wave-2 rework 3 by the lead.** All five rows were one- or two-line edits; decision 80-4 ("小的 lead 直接改").
4. **Lead workflows on rework-1 rows before the user's 14:41 decision** (14:31, 14:40), because the user asked to use
   the quota left before the reset. Their rows went through the same review, ledger and audits.
5. **Context-limit handoffs** (not deviations, but the run shape changed): TQ, wave-1 rework 1 and rework 2 reached
   360K; TQ2 and rework-1 segment 2 continued; rework 2 had already committed everything.
6. **Book errors found while building** (recorded, no rework of their own):
   - wave 1's machine-wide `flock` lock lay outside the bubblewrap sandbox (Permission denied). TP switched to
     `./.typecheck.lock` inside its copy by itself; TQ ran without a lock, and TQ2 ran plain `npm run typecheck` as
     ruled. From wave-1 rework 1 on, every book names the lock inside the copy. Such a lock queues only within one run:
     the wave-1 reworks ran one at a time, but wave 2's three groups ran side by side, each with its own lock;
   - `tests/scenarios/K3-19-review-unavailable.test.ts` was left off T2's whitelist by mistake (it is on T1's);
     T2-040 and T2-042 edited it, accepted as a DSH adaptation (`t-w2b` §0);
   - a wave-1 subagent ran `--maxWorkers=6` against the book;
   - the book check missed TQ-091's downstream fixtures (W1 merge fix `5daea2e`);
   - DSH's sandbox has no bubblewrap: sandbox tests were listed and the lead ran them (R-10).
7. **The coverage-after run** was first started without a build (two tests need `dist`); the lead stopped it by PID
   after 33 s and started it again with the build.

## 4. Lead fixes and merges

- `11d46d5` wave-1 merge: TQ applied onto TP with `git apply --3way` (the copies' histories differ only in their own
  lead commits; base trees equal). The allowlist merged by (file, name), 164 entries, no conflict; the diff against TP
  equals TQ's own diff. `tests/helpers/S5-decision-fixture.ts` takes TP's side (the public `adoptInitialArchitecture`
  already writes the catalog row).
- `5daea2e` `R4b-session-directory` seeds a current-format `ArchitectureCatalog` row (empty modules, `since: null`),
  TQ-091's downstream fixture that the book check missed.
- `67d547d` Codex's two patches on rework 3: `S3-context-inputs` registers the Session anomaly schemas
  (`SESSION_ANOMALY_RECORD_SCHEMAS`, as `create-platform.ts:656` does) and uses the real mailbox instead of a fixed
  `unsupported` stub. `d4c4cea` a type narrowing inside the hoisted `makeRunA2`.
- `4807e64` wave-2 merge: one conflict, the re-export line of `tests/helpers/K3-35-continuation-fixture.ts` (T2 removed
  `baseBrief`, `G`, `sha`, `task`; T3 `G`, `task`): took the T1+T2 side.
- In wave-2 rework 1: W2b-01 (`tests/helpers/task-claim-fixture.ts` passes `meta: { requestId: \`admit-${requestId}\` }`,
  so the Session and message ids other tests pin stay as they were; R-15); W2b-12 (the name prints the third label
  value); agent D's rows applied from its patch after the edit hook refused it; one unused import removed.
- `9a69bdb` rework 3 (W2d-01..W2d-05), §2.

## 5. Rulings R-1..R-24

Full texts in §0 of each table.

| 编号 | 表 | 一句话 |
|---|---|---|
| R-1 | t-w1 | Rule sheet v2 binds the rework; a value a public route or tool receives from outside is a public input, even when its type is called a draft. |
| R-2 | t-w1 | A seed that must stay may be brought to the current format (exactly the required fields, nothing else); listed as `FORMAT`. |
| R-3 | t-w1 | Tamper-only rows go, with the `file:line` that shows no public step makes the state; the production check stays. |
| R-4 | t-w1 | Unreachable rows go; a refusal a current check makes stays as an A6 row. |
| R-5 | t-w1 | If "convert" still cannot reach the state: BLOCKED with evidence, the wave-1 form stays. |
| R-6 | t-w1 | A finding whose facts are wrong against the code is reported, not applied. |
| R-7 | t-w1r1 | The shared real Runtime helper (`S2B-runtime-steps-fixture.ts`) reaches entered, running and ended Runs; "no Runtime wired" is no longer a BLOCKED reason. |
| R-8 | t-w1r1 | Values the Runtime issues come from a public read, as returned. |
| R-9 | t-w1r1 | A part that stays BLOCKED keeps its `ed26c44` form. |
| R-10 | t-w1r2 | Sandbox tests run with `CODING_AGENT_BWRAP_PATH`; if the sandbox fails, an environment failure for the lead. |
| R-11 | t-w1r2 | Expected values are literals with their working, never computed by a production function. |
| R-12 | t-w1r2 | The last rework reports `partial`/BLOCKED with `file:line`; no workaround. |
| R-13 | t-w2b | The note-tools adapter's A7 exemption covers its whole own contract (name, `effectClass`, metadata, strict schema refusal). |
| R-14 | t-w2b | No raised timeout unless a row allows it: at most `120_000`, with the measured time. |
| R-15 | t-w2b | A shared helper keeps the ids, positions and times it issued; run every importer after changing it. |
| R-16 | t-w2b | Kernel history positions are platform-issued; compared as returned, never written as literals. |
| R-17 | t-w2b | Merge targets carry every source's spec-row id in the test name. |
| R-18 | t-w2b | Converted refusal rows: `describe('rejects: …')`, one error per row, a public read before and after. |
| R-19 | t-w2b | Service-layer rows run on memory and SQLite. |
| R-20 | t-w2b | A sub-part sent to BLOCKED goes back to its `w2-base` form, named with its category and `file:line`; the item is partial. |
| R-21 | t-w2b | A wrapper that hands the test the platform's own real backend is A4. |
| R-22 | t-w2b | W2b-20's store-page row (205 real blocked Runs) is a scale row: timeout at most `600_000`, measured times in a comment; on the user's L-4 list. |
| R-23 | t-w2r2 | A digest over input the test fixes is a literal computed by hand with `node:crypto`; a digest over material the test does not fix is passed on as returned. |
| R-24 | t-w2r2 | W2b-09's and W2b-55's BLOCKED revoked in part: public reads exist for some facts (W2c-01, W2c-05). |

A note in `t-w2r2` §0: rule sheet v2's A7 entry 3 still says `executeChecks: false`; after W2b-27 the stand-in has no
such option. Fix the wording in the next sheet version. That version must also be reconciled with the K3/L8 sheet v3
(`docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/checks/test-rule-sheet-v3.md`): T's v2 branched from
v1 and does not contain v3's A7 entry for the pass-through process sandbox or its crash-fixture wording.

## 6. Checks

Full suites, all with bubblewrap, 5 workers (`checks/full-*.txt`; the earlier ones' summaries are in the
`*-vitest.log` files):

| 标签 | 提交 | 测试文件 | 测试 | 用时 |
|---|---|---|---:|---:|
| (before T, 85-5 merge) | `c54d00e0` | 773/773 | 10,089 passed, 5 skipped | — |
| W1 | `5daea2e` | 767/772 | 24 failed, 9,913 passed, 5 skipped | 2,542 s |
| W1R1 | `ed26c44` | 773/773 | 9,929 passed, 5 skipped | 2,457 s |
| W1R2 | `1c31c27` | 773/773 | 9,929 passed, 5 skipped | 3,072 s |
| W1R3 | `254617d` | 772/773 | 2 failed (IN05), 9,927 passed, 5 skipped | 3,052 s |
| W2a | `4807e64` | 760/766 | 8 failed, 9,724 passed, 3 skipped | 2,797 s |
| W2R1 | `722ddf3` | 765/766 | 2 failed (store page, 30 s), 9,773 passed, 3 skipped | 3,017 s |
| W2R2 | `c05c7d7` | 766/766 | 9,774 passed, 3 skipped | 3,476 s |
| TMERGE | `e99b385` | 766/766 | 9,774 passed, 3 skipped | 3,592 s |

Assertion ledgers (every REMOVED or LOOSENED line mapped to an item or a row): wave 1 and the wave-2 build in `dsh/ledger-*.txt`; wave-2
rework 1 `checks/ledger-W2R1.txt` (88 lines and 2 deleted files); rework 2 `checks/ledger-W2R2.txt` (9 assertions, 2
tests); rework 3 `checks/ledger-W2R3.txt` (0 lines).

Coverage before T (`coverage/before-summary.txt`): statements 75.38%, branches 69.58%, functions 89.02%, lines 83.78%;
1,129 uncovered functions, 23,577 uncovered branch arms, 30 files never executed. After T (`coverage/after-summary.txt`,
`e99b385`, 4 workers, 4,727 s, 766/766): statements 75.33%, branches 69.46%, functions 89.09%, lines 83.78%; 1,113
functions, 23,214 arms, the same 30 files. Line-mapped comparison (`coverage/mapped-summary.txt`): 212 arms and 6
functions lost their last test in T; 100 arms on lines T added or rewrote are not executed; 22,902 arms and 1,107
functions were uncovered before and after. Triage of 795 rows: `coverage/triage/`.

## 7. Size

`t-base..9a69bdb`: `src` 169 files +783/−3,300; tests 431 files +16,450/−24,083; 2 other files +2/−2.

| 段 | src | tests |
|---|---|---|
| wave 1 (`t-base..d4c4cea`) | 168 files +775/−3,297 | 226 files +6,399/−11,087 |
| wave 2 build (`d4c4cea..4807e64`) | — | 251 files +8,558/−12,572 |
| wave 2 reworks (`4807e64..9a69bdb`) | 1 file +8/−3 | 102 files +2,279/−1,210 |

Test files 773 → 766 (9 deleted, 2 added); helpers 5 deleted, 8 helper and support files added. Tests passed 10,089 →
9,774, skipped 5 → 3. Production-reach allowlist 182 → 164 entries (pre-batch 62 → 0, wire-format 49 → 109, kept-for
71 → 55). Production files deleted: `src/contracts/role-material-channels.ts`,
`src/core/work-graph/tasks/session-provenance-facts.ts`, `src/core/workspace/project-source-index.ts`,
`src/core/workspace/role-source-reader.ts`. The one production change of wave 2: `activity-read-helpers.ts`
`claimingSessionOf` throws `unavailable` with the ref key when a Run's dispatch record is missing (W2b-57; no
production flow writes such a Run; the test that hand-built one is deleted).

## 8. Usage

- DSH: 22 runs with the docs run, 53,259 s (14.79 h), 527.6M tokens, peak context 367,721 (`checks/dsh-runs.txt`).
- Codex: 64 read-only answers (`checks/codex-calls.txt`).
- Claude workflows from 10-19 on: 10 workflows, 179 agents, 30.12M subagent tokens (`checks/claude-workflows.txt`;
  single agents outside workflows and the lead's own turns are not counted there).

## 9. Left for the user and the lead

`books/t-end-list.md`: for the user L-1 AD08, L-3 TP-124/GAP-46, missing public reads, L-2 untested guards with the
coverage triage, L-4 test time, handwritten state outside the items, the execution-history reader's principal check;
for the lead the capabilities line naming the deleted stub, the next rule sheet, the 293 unused names (note only), the
deviations of §3.
