# Stage Part1, slice 3 (context and graph tools): notes

Branch feat/reliability-and-structure, worktree claude-code-task-execution-f3cca6, HB = 48c8d473 (B0; clean, not
changed by this stage). Nothing pushed, nothing committed in the real worktree, product model not called (DSH
headless deepseek-flash only; no Codex in this stage). Ports 3080/3099/44797 untouched; `_common` untouched;
vendor/coding-agent/dist untouched; nothing under D:/cxt touched. Part 2 NOT sent. All files below are in
`scratchpad/impl/s3/` (S) unless a WSL path is given.

## 1. Copy

`~/dsh-work/slices/s3` made by `scratchpad/impl/mk-slice-copy.sh s3 48c8d473…` (git archive + base node_modules +
vendor zod/openai + git init). Tree 8d6a622b = HB's tree. Commits in the copy: 21e93ed `baseline 48c8d473… (s3 copy)`
(tag `slice-setup`), then the lead's `DSH-BASELINE.md` commit **96f3208** (tag `slice-base`). DSH's diff is against
`slice-base`. Log `S/mk-copy.txt`.

## 2. Baseline (DSH sandbox, locked)

`S/baseline-s3.sh` (typecheck, check:architecture, then the book's 50-file regression command with
`--reporter=verbose`, inside `run-dsh.mjs exec`, under `flock ~/dsh-work/slices-tests.lock`).
- typecheck 0; check:architecture 0.
- Regression: `Test Files 19 failed | 31 passed (50)`, `Tests 63 failed | 1028 passed | 29 skipped (1120)`.
  Per file / failing names: `S/baseline-vsum.md`, `S/baseline-block.txt`.
- Run a second time (`S/baseline2-s3.sh`): identical per file and per failing test name (`S/baseline2-vsum.md`).
- Attribution: the same 19 files run at HB in WSL slot s3 with /usr/bin/bwrap (`S/slot-baseline.sh`, wslrun log
  `impl-s3-hb-envcheck-1`, locked, with-usr-bin-node): **19 passed, 146/146 tests** (`S/slot-baseline.out`). So all
  63 failures + 29 skips are the sandbox's missing bwrap (check step rejected → Tasks stay `waiting`; invariants.test.ts
  setup fails → 29 skipped; 2 AG2b tests time out). Snapshot ref `refs/cc-snapshot/impl-s3-hb-envcheck-1` deleted
  after checking its tree = HB tree.
- `DSH-BASELINE.md` (copy root, copy in `S/DSH-BASELINE.md`) carries the numbers, all 63 failing names and the reason.
- Filled book: `S/part1.sent.md` (= `~/dsh-work/slices/_books/s3-p1.md`, sha256 6149770f…e7d7). Only the one
  placeholder line (book line 159) replaced, by `S/baseline-fill.txt`; no other change; LF, no CR.

## 3. DSH part 1

`S/run-part.sh p1` (raised-cap runner `_common-slices`). Session **session-63415678-640d-4955-9662-5521933a5396**
(continuation: `--session-id` from `~/dsh-work/ladder/_runs/slices-s3-p1/run.json`; private state
`~/dsh-work/ladder/_runs/_state/slices-s3`). Ran 15:36:45–15:59:51, exit 0, `stoppedBy: null` (no cap hit), report
complete (FILES CHANGED, CHECKS, UNSPECIFIED, NOTES). Reply: `S/part1.reply.md`; run record `S/run-p1/`.
DSH spawned 6 subagents (one per group of test files), 07:44 UTC.

## 4. Lead scripted checks (`S/check-copy.sh lead-p1`, sandbox, tests locked; outputs `S/lead-p1-*`)

| check | result |
| --- | --- |
| status shape | 13 ` M` in scope + ` M src/ui/api/routes.ts` (OUT of scope, see F1) + `?? .dsh-scratch/` + 21 `??` new; ignored only node_modules (2) |
| paths vs spec §6 (42) | 34 of the 42 + `src/ui/api/routes.ts`. All 21 N present (10 src, 11 tests). 13 of 21 C touched; untouched (part 2): runtime-configuration, execution-driver, agent-runtime/query-execution, session-discovery-tools, whiteboard-tools, work-graph/queries/query-execution, tasks/execution-entry-service, production-reach-allowlist.json |
| platform-duty.ts | sha256 6adfb57e…9e39 = README |
| typecheck / check:architecture | 0 / 0 |
| new tests | 11 files, **116 ids, 168 runs** = spec §0.6 and book table, every id once per backend (`S/lead-p1-ids.txt`); `10 failed / 1 passed (11)`, `137 failed / 31 passed (168)` = DSH's numbers |
| RED cause | 129 `not implemented: …` stub throws; 8 expected-value assertions (AD08 ×2, AT02, AT03, AT04, AT06, SC01, SC02); no compile / import / setup error, no timeout |
| passing in part 1 | AD01–07 (×2), RP01/03/04 (×2), AT01/09–12, RT01–06 = 31 runs. All but RP03 test existing behaviour, part-1 pure data (RP01) or the part-1 route wiring the book allows (RT); RP03 passes only because of the early validation (F3) |
| regression (50 files) | per file and per failing name identical to the baseline except production-reach: 1 failure listing 25 unreached new declarations (no stale allowlist entry) — allowed by the book. Totals `20 failed / 30 passed`, `64 / 1027 / 29 skipped` |
| commits / tags | none added (HEAD = slice-base 96f3208) |
| scan.json | 26 `dotdot` hits = relative import specifiers / subagent prompt text (known false positive); privateTmpUses 0, canaryHits 0; no out-of-copy access. `contamination: attempted-outside` is only those hits |
| patch | `S/part1.patch` (sha256 4172bb0e…c91, 35 files, vs slice-base, untracked included via a temporary index, `.dsh-scratch/` excluded; copy index untouched). `git apply --check --cached --binary` on HB index: applies cleanly |

## 5. Findings for the review / freeze stage (not acted on here; no guided round sent)

- **F1 spec gap (file list):** `src/ui/api/routes.ts` `ROUTE_LABELS: Record<CoreRouteSuffix, string>` is total, so the
  2 new suffixes force 2 labels or `tsconfig.ui.json` fails. Spec §6 / README omit this file; slices 1 (11 suffixes)
  and 5 (12) will hit the same. DSH added `'graph/look': '查看图节点'`, `'graph/find': '查找节点'` + comment. Only
  shown by `src/ui/views/shell/bars.ts:40` for a pending route. Lead must accept it as the 43rd path (and fix wording
  if wanted) before part 2's "diff = exactly the list" check.
- **F2 test defects (DSH flagged some itself):**
  - SC01 `tests/scenarios/S3-context-and-inputs.test.ts`: uses the AG2b harness Task, not the §5.1 tB/oB/vB/old-A
    fixture; expects `H('old-A')` though no old-A is seeded; asserts AG2b texts instead of oB/vB and "input missing";
    lacks "history/query reads create no Session" and "tB not satisfied from upstream completed" (spec §5.11).
  - SC02 `tests/scenarios/S3-query-graph.test.ts`: history runRef `runA` does not exist in the AG2b harness; the
    spec's large-graph notification (≤16384 bytes, consumed once, second scan sends 0) and "expansion/paging adds 0
    model requests" are not asserted.
  - IN11 / IN12 (`tests/work-graph/S3-context-inputs.test.ts:551`, `:560`): same fixture and declaration, opposite
    expectations (selected vs missing) — cannot both pass; IN12 needs its successor finalized FAIL.
  - DSH also names IN14 (reply-only decision), IN19 / GR17 / GR18 (canonical QueryJob/QueryRun seeds), AT02–AT06
    (observer details/changes) as fixture gaps — to verify in the row-by-row review.
- **F3 part-1 behaviour beyond stubs** (book B: "Do not change any existing function body"):
  `src/contracts/validation/role.ts` validates `platformDuty` (makes RP03 green early); `src/app/host.ts`
  `localWorkbenchGrant` tool list switched to look/find (the book's step 5 names "Host grant", so arguably allowed) and a
  new `configurationRevision` formula; `platformRoleProfile` implemented as a data lookup. No regression from them.
- **F4 process:** DSH created and later deleted `tests/architecture/zz-reach-probe.test.ts` and ran it (book: run only
  the named commands; create no other file). Not present now.
- DSH UNSPECIFIED items checked: `HostSettingsStoredModel` has no `revision` (src/app/host-settings.ts:105, true); the
  old grant has exactly three old read names (host.ts:513–514 at HB, true); allowlist has slice-3 `kept-for` entries
  (tests/architecture/production-reach-allowlist.json:380–434), none reached yet (true per the reach output).
  Open for review: `behaviorSkillId` values guessed; no `GraphLookBody/Response` types; extra exports.

## Measurements (decision 43)

| who | wall | tokens | tool calls / steps |
| --- | --- | --- | --- |
| DSH part 1, main Session (runner run.json) | 1386 s (23.1 min) | 21,594,773 (in 227,703 / cache 21,273,984 / out 93,086) | 177 calls (read 54, bash 49, edit 48, write 12, subagent 6, job_output 5, list_agents 3), 109 steps |
| DSH part 1, 6 subagents (from DSH's own session files, `S/p1-usage.jsonl`, script `scratchpad/impl/dsh-usage.mjs`) | inside the same 23.1 min | 74,254,736 (in 812,076 / cache 73,049,216 / out 393,444) | 582 calls, 501 steps |
| DSH part 1 total | 23.1 min | **95,849,509** | **759 calls, 610 steps**; no cap hit |
| lead (me) | ≈ 44 min (15:25:54–≈16:10) | not recorded | ≈ 83 tool calls (incl. this note and the result) |

Note: the runner's run.json (and its 30M token cap) count only the main Session; DSH's subagents spent 3.4× the main
Session's tokens and are not counted or capped. Use `dsh-usage.mjs` for real totals.

Lead waiting, listed separately (inside the 44 min): DSH 23.1 min; baseline 2.5 min; second baseline 1.3 min; slot
bwrap check 1.9 min; lead check 1.6 min → ≈ 30 min (part of the spec/test reading overlapped the DSH wait).

## Kept on disk

- WSL copy `~/dsh-work/slices/s3` (part-1 result uncommitted in it, `.dsh-scratch/` left for part 2 to delete).
- Run dir `~/dsh-work/ladder/_runs/slices-s3-p1`, private state `~/dsh-work/ladder/_runs/_state/slices-s3`.
- Book `~/dsh-work/slices/_books/s3-p1.md`. Scripts: `S/run-part.sh`, `S/check-copy.sh <tag>`, `S/baseline-s3.sh`,
  `S/ids-check.mjs`, `S/mk-baseline-block.mjs`, `scratchpad/impl/vsum.mjs`, `scratchpad/impl/dsh-usage.mjs`.
