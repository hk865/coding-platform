# Slice 1 — test review of part 1, resumed stage (lead notes, 2026-10-08 evening)

Branch feat/reliability-and-structure at 1d95b8ca (docs only after HB 48c8d473); real worktree untouched, nothing
committed in this stage; the product model was not called. Copy `~/dsh-work/slices/s1` (setup 578844c2, tags
slice-setup = slice-base), Session session-ce6ba84a-bb41-4547-b600-448180ea7e02, runner `_common-slices`.
Earlier: part 1 = runs p1 + p1b (part1.md); Codex (high) review codex.md (48 findings, 16:13–16:28); the first review
agent wrote the guided round part1-guided.sent.md (sha256 af7450ef…6709) and launched it as run slices-s1-p1g at
16:32:59; the run was killed at ~16:52 by the planned stop (exam; WSL shut down, restarted ~20:30).

## 1. What the killed run p1g left (resume/diff-g.sh, 20:3x)

- Part-1 tree (slice-base + part1-full.patch, temporary index) 90514170 vs current copy tree 25475660:
  16 files changed, +3,141 / −729 (`resume/g-stat.txt`, full diff `resume/g.diff`): `src/composition/create-platform.ts`
  (+6/−?, the book B(e) wiring the guided message asks for) and 15 test files (state: invariants, session-availability,
  message-machine, S1-archive-rework, S1-responsibility, S1-session-archive; business: S1-task-order,
  S1-session-maintenance; work-graph: anomaly-owner, codecs-indexes, dispatch-guards, provenance, responsibility,
  session-facts, wait-disposal). Not yet touched: work-graph S1-archive-owner, S1-requeue; business S1-archive-flow;
  runtime S1-archive-files-brief, S1-routed-replies; app S1-session-routes; scenarios S1-archive-restart,
  S1-wait-copy-retirement (two subagents for archive-flow and archive-files-brief had just started at 16:52).
- No file outside the part-1 set was created; `.dsh-scratch/` gained CORRECTION.md (DSH's digest of G1–G6),
  invariants.mine.ts and prov-run1..4.txt. No commit, tags unchanged (slice-base, slice-setup).
- Session state intact: `_runs/_state/slices-s1/sessions/…/session-ce6ba84a…/session.v4.jsonl.zstd` (1.39 MB,
  16:52), lock file empty (no stale holder). The p1g events stop at step 19 (`sleep 480` waiting for wave 2), no
  run.json (the runner was killed, so no runner totals for p1g).
- p1g usage (from DSH's own session files, `resume/usage-before-p1g2.jsonl`): main Session total now 57,791,805
  tokens / 257 steps / 319 calls, minus p1 + p1b run.json totals (50,658,525; 174 + 64 steps; 215 + 71 calls)
  = **p1g main ≈ 7,133,280 tokens, 19 steps, 33 calls**; p1g subagents = the 16 sessions created ≥ 08:33Z (see §5).

## 2. Re-send (same guided round, not a new one)

- Message `resume/part1-guided2.sent.md` = two-line preface (previous run of this message interrupted by a machine
  shutdown; files may be partly edited; check git status / diff and .dsh-scratch/CORRECTION.md first; still the one
  allowed correction round) + part1-guided.sent.md unchanged. WSL `~/dsh-work/slices/_books/s1-p1g2.md`,
  sha256 69455d13…d69d.
- Run slices-s1-p1g2 via `run-part-g.sh p1g2` (same copy, same runner, `--session-id` from p1 run.json, caps
  90 min / 60M), started 20:37:45. DSH's first steps: re-read git status/diff, typecheck (exit 0), ran the new tests:
  221 runs (session-maintenance had 18 instead of 9 runs after the killed subagent) — DSH re-delegated that file.

## 3. Result of p1g2 (run-p1g2/, final.md = DSH reply)

- 20:37:45–21:13:07 (2,122 s), exit 0, not stopped, sessionIdIn = sessionId = session-ce6ba84a…, contamination none.
  Main Session (run.json): 9,882,290 tokens (in 24,267 / cacheRead 9,839,616 / out 18,407), 32 tool calls, 24 steps.
  Subagents (DSH session files, `resume/usage-after-p1g2.jsonl`, `resume/sum.mjs`): 12 sessions, 179,717,605 tokens,
  1,245 tool calls, 1,063 steps. DSH says the interrupted run had left 12 files half-done; each was redone by a fresh
  subagent; session-maintenance brought back from 18 to 9 `it`s.

## 4. Lead checks after p1g2 (`check-copy.sh lead-p1g`, 21:14:01–21:15:44, DSH sandbox, tests under the lock)

| check | result |
| --- | --- |
| status | same 89 paths as after part 1 (51 M incl. queries/contracts.ts and ui/api/routes.ts, 38 ??) + `.dsh-scratch/`; unchanged by the check runs; ignored only node_modules |
| refs | HEAD 578844c2, tags slice-base, slice-setup; no commit |
| platform-duty.ts | 6adfb57e…9e39, 318 bytes |
| typecheck / check:architecture | exit 0 / exit 0 |
| new tests | 23 files, **212 runs: 203 failed, 9 passed** (UT06, UT08, UT33, UT34, UT35, SV03 x2, IT17, IT04); per-file runs = book table |
| failure lines (`resume/fail-reasons.txt`, 203 rows) | 177 `Error: not implemented: …`; 26 AssertionError (SV01 x2, SV04 x2, SV05/SV42/SV44 x6, SV39/SV58 x4, SV40/SV51 x4, SV50 x2, UT04, UT05, UT07, UT32, IT18); no setup error, unregistered schema, compile error or timeout |
| regression | `8 failed / 14 passed (22)`, `30 failed / 511 passed (541)`; only production-reach (3/1), message-machine (90/9), session-availability (121/7) differ from baseline; the other 19 equal baseline (13 bwrap failures unchanged) |
| patch | `lead-p1g.patch` (634e6f2e…ea1), `lead-p1g-full.patch` (9fdc13de…1578), 89 paths |

DSH's numbers agree with mine (212 / 203 / 9; regression 30 / 511 of 541).

## 5. Codex re-review (second model, read-only)

- Clone `D:/cxt/impl-s1-p1g` (shared clone of the worktree, detached 48c8d473, core.longpaths, `git apply --binary
  lead-p1g-full.patch` → 89 paths); inputs in `D:/cxt/impl-s1-p1g-msg/` (guided.md = part1-guided.sent.md,
  dsh-reply.md, fail-reasons.txt). Both are new names; nothing under D:/cxt deleted.
- Codex binary: the path given in the task (`bin/ca9abb0b4d8ac692/codex.exe`) no longer exists — Codex updated itself
  (now `bin/9691020b546a15b2/codex.exe`, codex-cli 0.162.0-alpha.2). First launch exited 127; relaunched with the new
  path. Effort high, `--ephemeral --json`, `-s read-only`. 21:19:32–21:34:12 (14.7 min), exit 0 (one internal
  "collab spawn failed" in codex2-err.txt; the review completed). Prompt `resume/codex2.prompt.txt`, output
  `resume/codex2.md` (31 findings: 22 must-fix, 9 should-fix; per-item FIXED / PARTLY / NOT FIXED tables).
- Per-item verdict: FIXED: the four existing test files (session-availability incl. the lead's fixture decision,
  message-machine, state-writes, invariants schema part), UT05/09/14/39/40, SV01/02/05/14/16/17/18/20/21/24/25/26/27/
  28/29/43/53/56, IT02/09/12/17/32, routed-replies persistence, restart fault arming, create-platform wiring.
  NOT FIXED: UT34 cause, SV08, SV10, SV12, SV13, SV22, SV33, SV37, IT01, IT04, IT13, IT14, IT15, IT25, IT30, IT20
  (two of three lines). PARTLY: most other SV/IT rows.

### 5.1 Findings the lead verified himself (each against the copy)

1. **SV50 / SV59 assert a field that does not exist** (`tests/work-graph/S1-requeue.test.ts:633`, `:678`):
   `refusal.automation`; `TaskReworkRefusalSnapshotV1` (`src/contracts/task-requeue.ts:226–252`) has no `automation`
   and the spec adds none (grep of slice-1-SPEC.md: only the SV50 row text). The measured SV50 failure is exactly this
   diff (`code` matches, `automation` missing). Can never pass.
2. **SV49 / SV50 / SV59 expect `f.captures` = [] after setup captured** (`S1-requeue.test.ts:215`: the source-capture
   callback pushes on every ordinary requeue; `growChain` makes three of them). Can never pass.
3. **IT05 records nine anchors for the same Run r0** (`tests/runtime/S1-archive-files-brief.test.ts:399–405`,
   subjectKey `index:canonicalJson(r0)`); spec §2.6 / §5.1 "at most one anchor per Run" → the owner must refuse the
   2nd…9th. Can never pass as written.
4. **IT01's "unknown result" is a deterministic failed edit** (`S1-archive-files-brief.test.ts:149–150`:
   `expectedRevision: '0'.repeat(64)` → known error, sideEffect none, changedPaths []). Under §2.6 ("复用
   readPreviousTurn 和相同 selfChanged 提取", `continuation-brief-assembly.ts:238–272`) b can never be `possible`.
   Also the real Kernel never reports a `possible` effect with paths (`vendor/coding-agent/dist/sandbox/process/
   process-sandbox.js:236–247`, `tools/builtin/shell/shell-tool.js:106`), so row IT01 needs a lead decision (spec
   seam §2.6 vs IT01) on where `possible=['b']` comes from — see K7.
5. **SV37 finishes the archive with an open responsibility** (`S1-requeue.test.ts:549–556`: `openResponsibility()`
   then `finishArchive(request)`, no close / transfer) → S1-SES-04 must refuse; "link closed, S archived" cannot hold.
6. **IT18 arms the final fault after the restart** (`tests/app/S1-session-routes.test.ts:180–181`) → start-up
   maintenance (§4.2 order) may finish the archive first (the guided round named this defect for
   S1-archive-restart; DSH fixed it there, not here).
7. UT34 still gets `forbidden` from an unrelated human cancel fence (`tests/state/S1-archive-rework.test.ts:141–155`).
   Lead accepts the class assertion (`run_failed`, not S1-FC-ARCHIVE) as the pure-layer half of the row; the
   forged-origin refusal is owner-level (SV36 / SV48 / SV49). Not a blocker.

The other Codex must-fix items (SV12/13 uninjected provenance reader and non-legacy child; SV04 copy identity;
IT06–08/IT31 S still occupied by the B2 claim; IT10 no stopped writer; IT13/16/27 stop never completed; IT14 no
answer; IT26/IT34 unknown Run with a started Attempt; SV33/34 no retirement; SV35/38 no same-R stop; SV22 race on D;
SV23 global cursor; SV61 pending vs partial; IT21–24 receipts from continuation; IT20; S1-5 too broad; SV10 dangling
Outboxes) were not each re-verified; the six checked ones were all genuine, so they are treated as likely.

## 6. Decision: do NOT freeze; stop this stage with ok=false

Rule of the stage: one guided round per part; afterwards the lead finishes a small remaining gap himself, or stops if
it is large. The remaining gap is large: 6 verified and ~16 likely must-fix defects over 12 of the 23 new files
(S1-requeue, S1-archive-files-brief, S1-provenance, S1-codecs-indexes, S1-session-facts, S1-archive-owner,
S1-wait-disposal, S1-session-maintenance, S1-archive-flow, S1-session-routes, S1-archive-restart,
S1-wait-copy-retirement) plus `tests/state/invariants.ts` S1-5. Most need new real histories (real stop observation
and archive continuation, real retirement, real legacy records, an uncertain Kernel result) — fixture redesign, not
one-line fixes. Freezing now would leave a dozen frozen tests that a src-only part 2 cannot make pass (rule 11). So
no sha256 freeze and no part2.sent.md; part 2 not sent.

Options for the lead / user (not decided here):
- (a) allow a second guided round for part 1 (exception to DSH-WORKFLOW §6.4 "at most one"), sending the verified
  findings + Codex codex2.md items as file:line + row + direction; then checks and one more Codex pass;
- (b) the lead (Claude) rewrites the failing fixtures of the 12 files itself (large lead work, recorded as such);
- (c) freeze only the files Codex marks clean and let part 2 also correct the others under review (breaks the
  two-stage rule; not recommended).

### 6.1 Lead decisions already settled (for the part-2 corrections, whichever option is chosen)

- K1 scope: 89 files = the 87 of book/spec §6 + `src/ui/api/routes.ts` (ROUTE_LABELS entries for the 11 new suffixes
  only; type-forced by Record<CoreRouteSuffix,string>) + `src/core/work-graph/queries/contracts.ts`
  (`QueryExecutionDependencies.sessionFacts?` and its import only). Where part 2 says "87 files", read 89.
- K2 (the open point from part 1): spec §3.5 wins — `sessionMachineStateOf` always fills `provenance` and
  `archiveRequest` (null when absent; "旧窄夹具缺省读作null"). The narrow machine-state fixture of
  session-availability.test.ts carries `provenance: null, archiveRequest: null` (fixture alignment, done in the copy;
  Codex: FIXED). The SES-01 raw record literal and key order stay (createSessionRecord without a provenance input
  writes today's 12-key literal; §2.9 default table). Part 2: `transitionSession('absent', session_created)` returns
  a next state with `provenance` (the created value, or null) and `archiveRequest: null`, equal to
  `sessionMachineStateOf(record)` (S1-SES-01), so "writes today's SES-01 literal" passes. Refs: §3.5
  (`// sessionMachineStateOf始终填入；旧窄夹具缺省读作null`), §2.9 default table, S1-SES-01, §5.5 last paragraph.
- K3 (first review, Codex #44): the accepted-key lists widened in part 1 (`execution-entry-codecs.ts:
  inputBindingProblem` anomalyAnchorRefs, `session-record-codecs.ts` provenance / archiveRequest,
  `claim-record-codecs.ts` archiveOrigin) validate a present value strictly in part 2 (§2.1 "存在但类型错误的字段拒解码",
  §2.7 "shape checker 明确 optional key，存在则严校验"); `inputBindingProblem` calls `anomalyAnchorRefsProblem`.
- K4 (first review, Codex #46): `readContinuationBasis.pendingAnomalies` is filled from complete durable anchor reads
  (§2.7 "真实生产 reader 始终返回"); `[]` only as the decode default of an old in-memory basis (§2.9).
- K5: start-up step 6c in `startup-reconcile.ts` stays (§4.2 order); the fourth `deriveReworkClass` parameter stays.
- K6: production-reach: every new declaration reachable from production by the end of part 2; no allowlist entry.
- K7 (only with an IT01 rewrite): changed-files `possible` for an unobserved / outcome_unknown edit-type call = its
  requested path; never confirmed; the continuation brief's own selfChanged extraction unchanged (§5.5 C3 tests).

## 7. Measurements (decision 43)

DSH, slice 1 part 1 so far (main Session from run.json; subagents from DSH's session files via dsh-usage.mjs):

| run | wall | main tokens | main calls | subagents (n / tokens / calls) |
| --- | --- | --- | --- | --- |
| p1 (book) | 657 s | 30,020,477 (cap hit) | 215 | p1 + p1b together: 22 / 98,026,091 / ≈ 1,117 |
| p1b (continue) | 1,176 s | 20,638,048 | 71 | (see p1) |
| p1g (guided, killed at the stop) | ≈ 1,180 s (16:32:59–≈16:52) | ≈ 7,133,280 (session totals minus p1+p1b; no run.json) | 33 | 16 / 152,666,812 / 1,345 |
| p1g2 (guided, re-sent) | 2,122 s | 9,882,290 | 32 | 12 / 179,717,605 / 1,245 |
| **part 1 total** | **≈ 5,135 s (85.6 min)** | **67,674,095** | **351** | **50 / 430,410,508 / ≈ 3,707** |

All-in DSH for slice 1 part 1: ≈ 498.1M tokens (main 67.7M + subagents 430.4M), ≈ 4,058 tool calls; > 99 % cache
reads. Codex: first review 15 min (16:13–16:28), re-review 14.7 min (21:19:32–21:34:12).

Lead (this resumed stage): ≈ 57 tool calls; wall ≈ 20:33–21:42 (≈ 69 min). Waiting, listed separately: DSH p1g2
35.4 min; lead checks 1.7 min; Codex 14.7 min (partly overlapped with own spot checks). So ≈ 50 min waiting,
≈ 19 min inspecting, deciding and writing.

## 8. Kept / where things are

- Copy `~/dsh-work/slices/s1` (part 1 + guided round, uncommitted, `.dsh-scratch/` in place), Session
  session-ce6ba84a-bb41-4547-b600-448180ea7e02, state `~/dsh-work/ladder/_runs/_state/slices-s1`, run dirs
  slices-s1-p1, -p1b, -p1g (partial), -p1g2; books `~/dsh-work/slices/_books/s1-p1.md`, -p1b, -p1g, -p1g2.
- Patches `S/lead-p1g.patch`, `S/lead-p1g-full.patch`; Codex `S/resume/codex2.md`; failure map
  `S/resume/fail-reasons.txt`; killed-run diff `S/resume/g.diff`.
- Codex clone `D:/cxt/impl-s1-p1g` and `D:/cxt/impl-s1-p1g-msg` (the user deletes D:/cxt).
- No frozen sha list, no part2.sent.md (not frozen, see §6).
