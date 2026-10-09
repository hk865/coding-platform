# Stage Part1, slice 1: notes (2026-10-08)

Branch feat/reliability-and-structure, worktree claude-code-task-execution-f3cca6, HB = B0 commit
48c8d473181249568793a38b9b68872d27be5d22 (worktree clean at HB the whole stage; nothing committed or pushed here).
No product model call (DSH headless deepseek-flash only; no Codex in this stage). Ports 3080/3099/44797 untouched,
`_common` untouched, vendor/coding-agent/dist untouched, nothing under D:/cxt touched. Part 2 NOT sent.
All files below are in `scratchpad/impl/s1/` (S) unless a WSL path is given.

## 1. Copy

`~/dsh-work/slices/s1` (`S/../mk-slice-copy.sh s1 48c8d473…`, output `S/mk-copy.txt`): git archive of HB + base
node_modules + vendor zod/openai + git init. Setup commit **578844c2400ba8330a7c288a53f02452541de34b**, tags
`slice-setup` and `slice-base` (same commit; the slice-1 book does not refer to a DSH-BASELINE.md, so none was
written). Copy tree 8d6a622b = HB tree 8d6a622b. Only slice copy touched: s1 (s3, s5 belong to other stages).

## 2. Baseline (untouched copy, DSH sandbox, under the slices lock) — `S/baseline-s1.sh`

- typecheck exit 0; check:architecture exit 0 (`next source boundaries: OK`).
- Regression command of the book (22 files, list in `S/regress-files.txt`, equal to the book's line):
  `Test Files 5 failed | 17 passed (22)`, `Tests 13 failed | 519 passed (532)`; per file `S/baseline-perfile.txt`.
  The 13 failures are 5 scenario files (A8-host-restart-paused 5, C3-brief-idempotency 4, C3-not-entered-chain 1,
  C8-auto-rework-cap 1, C8-human-stop-respected 2): the run_check step cannot run without `/usr/bin/bwrap`.
- Confirmation in the real worktree, slot s1 at HB (snapshot tree = HB tree; ref deleted afterwards), same 22 files,
  locked, with-usr-bin-node: **22 files, 532 tests passed** (`S/slot-s1/impl-s1-regress-hb-1.log`). So the 13 are
  environment-only.
- Filled into the book's placeholder (per-file passed/failed/skipped, both summary lines, the 13 titles):
  `S/part1.sent.md` (sha256 07d05c3f…7a4a, CR stripped; only the placeholder line replaced) =
  `~/dsh-work/slices/_books/s1-p1.md`.
- Write scope extracted from the book (`S/scope.txt`, 87 files: 38 N, 49 C) equals spec §6 (F01–F88 minus F19).

## 3. DSH runs (`S/run-part.sh`, raised-cap runner `_common-slices`)

| run | wall | tokens (in / cacheRead / out / total) | tool calls | steps | end |
| --- | --- | --- | --- | --- | --- |
| slices-s1-p1 (book) | 657 s (15:32:14–15:43:11) | 220,942 / 29,707,776 / 91,759 / **30,020,477** | 215 (bash 44, read 53, edit 79, write 11, subagent 20, grep 2, job_output 2, list_agents 3, send_message 1) | 174 | **stopped: limit:tokens** (30,020,477 > 30M) |
| slices-s1-p1b (continue, same Session) | 1176 s (15:44:57–16:04:32) | 36,033 / 20,563,840 / 38,175 / **20,638,048** | 71 (bash 43, read 6, edit 8, subagent 10, list_agents 2, job_output 2) | 64 | normal end, reply complete |
| **part 1 total** | **1833 s (30.6 min)** | **50,658,525** | **286** | 238 | 1 continuation, no guided round yet |

Session **session-ce6ba84a-bb41-4547-b600-448180ea7e02**; p1b run.json `sessionIdIn` = `sessionId` = that id.
Run dirs `~/dsh-work/ladder/_runs/slices-s1-p1`, `slices-s1-p1b`; copies of run.json/final.md/scan.json/events in
`S/run-p1/`, `S/run-p1b/`. The token cap is almost all cache reads: the main context grew to ~290–360K tokens per
step (DSH delegated stubs and test files to subagents; their own work is not in these tool counts).

**Cap decision.** At the cap: 15 N source files and 43/45 C source files + 4 C test files were done, 0 of 23 test
files existed (the test subagents had just been launched and died with the process). I continued once in the same
Session (`S/part1-continue.sent.md` = `~/dsh-work/slices/_books/s1-p1b.md`, sha256 63dc0e62…791a): state of the
copy, "continue part 1, do not redo", keep own context small, and one lead decision (next item).

**Lead decision (scope gap, not user-visible):** `src/core/work-graph/queries/contracts.ts` added to slice 1's write
scope for the one optional field `QueryExecutionDependencies.sessionFacts?` and its import. Reason: book §B (c)
names that field, but the type is declared only in `queries/contracts.ts:209` (base), which spec §6 omits (same kind
of gap as L5). Slices 3/5 do not touch the file (grep of the three specs), so no merge overlap. To record in the
slice-1 evidence and in §6 at docs sync.

## 4. Scripted checks (lead, `S/check-copy.sh lead-p1`, DSH sandbox, tests under the lock)

| check | result |
| --- | --- |
| git status shape | 51 ` M`, 38 `??` files + `?? .dsh-scratch/`; status unchanged by the check runs; `--ignored` only node_modules and vendor node_modules (no dist, no leftovers) |
| paths vs scope | 38 A = exactly the 38 N; 51 M = the 49 C + **2 outside the 87**: `src/core/work-graph/queries/contracts.ts` (lead-approved above) and **`src/ui/api/routes.ts`** (DSH, see open items); every scope file touched |
| no commit / tags | HEAD 578844c2, tags slice-base, slice-setup only |
| platform-duty.ts | sha256 6adfb57e…9e39, 318 bytes = README |
| typecheck / check:architecture | exit 0 / exit 0 (`next source boundaries: OK`) |
| new tests (book command 1) | **23 files, 212 runs: 196 failed, 16 passed**; runs per file = book table exactly |
| case ids | 151 distinct ids = UT01–56, SV01–61, IT01–34 (spec §0.6); each SV twice (memory, sqlite), each UT/IT once; file→case map = book table / spec §6 F56–F77, F85 exactly (`S/book-map.txt` vs `S/found-map.txt`) |
| failure reasons | 144 runs `Error: not implemented: …` stub; 52 runs AssertionError (`S/lead-p1-fail-reasons.txt`); no compile, timeout, import or TypeError failure |
| regression (book command 2) | `Test Files 8 failed | 14 passed (22)`, `Tests 29 failed | 512 passed (541)`; differs from baseline only in the allowed files: production-reach 4/0→3/1, message-machine 93/0→90/9 (+6 rows), session-availability 125/0→122/6 (+3 rows); state-writes 19/0 unchanged; the other 18 files equal baseline; all 13 baseline failures still fail, no other new failure |
| scan.json | p1: 30 hits, p1b: 11 hits, all `dotdot` inside module specifiers / a grep pattern (known false positive §6.6 item 7); privateTmpUses 0; errors 0; event scan: no forbidden git command, no /tmp, /mnt or ~/.dsh path |
| DSH numbers vs mine | all agree (196/16; 8|14 files, 29|512 of 541; per-file runs; passing ids) |

Patch: `S/part1.patch` (sha256 2a16cd28…8639) and `S/part1-full.patch` (full index, aad23e67…2383): 89 files,
+6,717 / −64 lines (src +1,677/−47, tests +5,040/−17); tracked diff + untracked files vs slice-base via a temporary
index (copy index untouched), `.dsh-scratch/` excluded. `git apply --check --binary part1-full.patch` on the clean
worktree at HB: OK (check only, nothing applied). DSH reply: `S/part1.reply.md` (= run-p1b/final.md, four sections).

## 5. Findings for the test review / guided round (not done in this stage)

Stub scan (`S/check-stubs.mjs`, AST; output `S/lead-p1-stubs.txt`): factories return objects whose methods throw;
composition/route wiring and new switch branches as the book allows. Existing bodies changed beyond that:
1. `state/session-availability.ts` `sessionMachineStateOf` now fills `provenance`/`archiveRequest` (spec §3.5 says
   "始终填入"). It makes two EXISTING tests fail (`createSessionRecord > writes today's SES-01 literal`,
   `deriveAvailability … agrees on records and machine states`), and they will still fail after part 2, because
   their machine-state oracles have no such keys. Spec §3.5 conflicts with book §D ("the only existing expectation
   that changes" is the reactivate case). Lead decision needed before freezing (e.g. allow the oracle/fixture of that
   file to carry `provenance: null, archiveRequest: null`, or narrow "始终填入").
2. `persistence/execution-entry-codecs.ts` `inputBindingProblem` now accepts the key `anomalyAnchorRefs` (behaviour
   change in part 1; part 2 needs it anyway with `anomalyAnchorRefsProblem`).
3. `app/startup-reconcile.ts` `runStartupReconcile` got a real step 6c (calls `maintainSessions` when published,
   errors into `problems`) — behaviour code in part 1.
4. `tasks/run-state-service.ts` `readContinuationBasis` returns `pendingAnomalies: []` (needed for the type);
   `state/task-failure.ts` `deriveReworkClass` got an optional 4th parameter (`void archive`).

Tests:
5. Fixture failures, not RED from stubs (book §C calls this a part-1 defect): SV16, SV17, SV18, SV19, SV20, SV47
   (`tests/work-graph/S1-responsibility.test.ts:163`, `:188`, …) and SV22 (`tests/work-graph/S1-archive-owner.test.ts:262`)
   fail at setup: `f.openLink(...)` through the existing `linkSessionWork` returns `rejected`, so the row never reaches
   the code under test. 14 runs.
6. SV50 asserts old behaviour (ordinary auto failure, prior = cap = 3 → refusal) but gets `requeued`: fixture or
   expectation problem (book: old-behaviour rows should pass in part 1).
7. Rows passing in part 1 that state NEW behaviour (book expects only old-behaviour rows to pass): SV37 (retired
   paused_interrupted Task archived with one anchor), SV41 (consumedWait claim vs archive request race), SV04, and
   UT33/UT35 — likely vacuous or too weak; check against spec §5 rows. UT41 (named by the book as an old-behaviour
   row) fails via the `orderTasksByDependency` stub, which is fine.
8. DSH UNSPECIFIED says some fixtures are "skeletal" and "part 2 must seed them" (SV10 2501 candidates, SV19 three
   terminal Task states, IT01/02/32 Kernel history, SV60/61 deliverControl): tests are frozen after part 1, so these
   rows must be complete before the freeze.
9. Message-machine existing tests (`is pure`, I-8 property, §10.4 forbidden transitions) fail only because the matrix
   now includes the stubbed event; should pass after part 2.
10. production-reach: 101 new declarations unreachable; the allowlist file is out of slice 1's scope (it is in 3/5's);
    must be reachable after part 2 or need a lead decision.

## 6. Open items (lead)

- **`src/ui/api/routes.ts` (DSH edited, outside scope):** `ROUTE_LABELS: Record<CoreRouteSuffix, string>` is
  typechecked by `tsconfig.ui.json`, so 11 new suffixes force 11 label entries (display-only, Chinese words chosen by
  DSH). Precedent: the `'verification/reverify'` entry (A.2 step 5.9, 928f68e6) was added the same way. Recommend
  accepting it as a scope amendment like L5 (no new UI behaviour; the old UI does not call these routes), with the
  lead checking the 11 words. **Slices 3 and 5 add 2 and 12 suffixes and none of the three specs lists this file**:
  they will hit the same typecheck break; at merge time three label additions to one table (trivial conflict).
- Items 1, 5–8 above decide whether the guided round of part 1 is needed (it is, for 1, 5, 6, 7 and 8).

## Measurements (decision 43)

- DSH: see table in §3 (part 1 = 2 runs, 30.6 min, 50.7M tokens, 286 tool calls; one cap hit at 30M).
- Lead (me): wall ≈ 48 min (15:25:55–≈16:14), ≈ 57 tool calls (incl. this note and the result).
  Waiting, listed separately (inside the 48 min): DSH 30.6 min (p1 11.0, p1b 19.6); checks ≈ 5 min (sandbox baseline
  1.7, slot-s1 confirmation 1.5, lead-p1 check 1.8). So ≈ 36 min waiting, ≈ 12 min reading, preparing and checking.

## Kept

`~/dsh-work/slices/s1` (part-1 state uncommitted, `.dsh-scratch/` in place), run dirs `slices-s1-p1`, `slices-s1-p1b`,
private state `~/dsh-work/ladder/_runs/_state/slices-s1`, books `~/dsh-work/slices/_books/s1-p1.md`, `s1-p1b.md`.
Part 2 / guided round: `bash S/run-part.sh <p2|p1g>` reads the p1 session id (same copy, same runner).
