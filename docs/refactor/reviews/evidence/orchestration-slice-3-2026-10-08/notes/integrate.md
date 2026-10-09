# Integrate stage (orchestration slices 1, 3; slice 5 not accepted) — 2026-10-09

S = scratchpad/impl. Real worktree D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6,
branch feat/reliability-and-structure, start HEAD dd21c239 (clean). WSL slot main. Start 06:05.

Slice 5 is NOT integrated (stage result ok=false at part 2: must-fix defects left after the one correction round).

## 1. Slice 1

- `S/s1/accepted.patch` sha256 f33ae9224da2b59ac68176d234dcd41f83b2daafbeb0df275eb8070451b1f552 = notes. 
- 48c8d473..dd21c239 changed docs only (5 files). `git apply --binary` cleanly (7 whitespace warnings: new blank
  line at EOF in new files, as in the copy). 95 changed paths = `S/s1/expected-paths.v3.txt` exactly
  (`S/int-s1-paths.txt`). platform-duty.ts LF sha256 6adfb57e…9e39 (worktree file is CRLF by core.autocrlf).
- Checks (`S/int-s1-check.sh`, log `S/int-s1.log.txt`, snapshot ba669af6): typecheck 0, check:architecture 0;
  vitest (locked) 23 S1 files + 22 regression files + S0-attention-edge-label + orchestration-mechanism = 47 files,
  771 tests, all pass (S1 alone: 23 files / 212 tests = spec §0.6 run count).
- Commit 327ec020 "feat: orchestration slice 1 — Session facts, corrections and archive (decisions 36, 43, 46)",
  pathspec = the 95 paths. No conflicts (first slice).

## 2. Slice 3

- `S/s3/accepted.patch` sha256 7ee52398086dc1fa9c8741c97712dee824d7f9d5c157b0beb6322ea801f7a0c8 = notes.
- Overlap with slice 1 (both patches): core-http-types.ts, core-routes.ts, create-platform.ts, platform-duty.ts,
  execution-preparation.ts, ports.ts, runtime.ts, work-graph/queries/query-execution.ts,
  tasks/execution-entry-service.ts, ui/api/routes.ts (= README "1 和 3" list + routes.ts).
- Trial first (temp index, worktree untouched while the slice-1 check ran): plain apply fails on the 9 shared files;
  3-way with `git merge-file` (base 48c8d473, ours = slice 1, theirs = slice 3; `S/int-merge/`): clean for
  create-platform, runtime, query-execution, execution-entry-service; conflicts in 5 files.
- Real apply: `git apply -3 --binary --exclude=src/contracts/platform-duty.ts` (platform-duty.ts byte-identical in
  both, checked). The 4 clean files equal the merge-file results exactly.
- Conflicts and how merged:
  1. `src/app/core-http-types.ts` CoreRouteSuffix: both unions kept (11 slice-1 + 2 slice-3 suffixes; only the
     last carries `;`).
  2. `src/app/core-routes.ts` (4 hunks: binding types, route table, bindings, dispatch arms): both sides kept.
  3. `src/core/agent-runtime/ports.ts`: both optional members kept (`readArchiveChangedFiles?`, `readAttentionGraph?`),
     each with its own doc comment.
  4. `src/ui/api/routes.ts` ROUTE_LABELS: both entry groups kept.
  5. `src/core/agent-runtime/execution-preparation.ts` — semantic crossing (not in the README list): slice 3 moved the
     continuation brief (prepareContinuationBrief, sessionBasisOf, briefWorkspaceFacts, buildInput) into the new
     `context-assembler.ts`; slice 1 had changed exactly that code. Merge = slice-3 version + slice-1 behaviour ported
     into the assembler (`S/int-merge/merge-brief.py`, exact replacements, each asserted once):
     - `archiveOriginSkipsHistorySeed` (§4.1 T10) now in context-assembler.ts and used before the session basis;
       re-exported from execution-preparation.ts where slice 1 declared it.
     - anomaly section (§2.7): `assembleAnomalySection(basis.pendingAnomalies)` passed to the brief; the anchors
       come back as optional `AssembledContextV1.anomalyAnchorRefs` (absent when none) and go into
       `inputBinding.anomalyAnchorRefs` (non-empty only), as slice 1 did.
     - capacity refusal N7: `ContinuationBriefCapacityError` from rendering the brief → `rejected('capacity')`.
     - `briefWorkspaceFacts` + `BriefWorkspaceFactsDependencies` stay exported from execution-preparation.ts (used by
       slice 1's session-anomaly-facts.ts) as a wrapper of the assembler's one implementation
       (`briefWorkspaceFactsFor`, now exported, deps narrowed to workspaceHost/workspaceSource).
  The full set of merge edits vs the slice-3 versions: `S/int-s3-merge-edits.diff`.
- Checks (`S/int-s3-check.sh`, log `S/int-s3.log.txt`): typecheck 0, check:architecture 0; vitest (locked) union of
  slice-3 new 11 + regression 50, slice-1 new 23 + regression 22, slice 0's 2 = 98 files: 97 passed, 1 failed
  (S3-graph-context 38/38 failed in its fixture: the real claim of a legacy Session now derives provenance (slice 1)
  and the fixture's record backend did not register the session message schemas nor the claim lookups slice 1 added
  → `incomplete legacy_provenance_ambiguous: a Session message window was not read completely`, then
  `unsupported: no lookup index registered as work-execution-by-session`).
  Integration fixture fix (lead, recorded): register `SESSION_MESSAGE_RECORD_SCHEMAS` records/events/lookups and
  `TASK_CLAIM_RECORD_SCHEMAS.lookups` in `backendSchemas()` (`S/int-s3-gc-fixture.diff`; 5 added lines, no test
  logic changed; original `S/int-merge/S3-graph-context.test.ts.orig`). Then the file alone: 38/38 pass
  (logs int-s3-gc, int-s3-gc2). Production code left as is: slice 1 deliberately treats an unregistered lookup as
  an incomplete window, and the real composition registers all schemas.
  Counts: slice-3 11 files / 168 tests; slice-1 23 / 212; total 98 files / 1,973 tests (with the fix).
- Commit ccecc016 "feat: orchestration slice 3 — context and graph tools (decisions 36, 43, 46)", pathspec = the 41
  slice-3 paths (platform-duty.ts unchanged).
  New sha256 of the changed frozen slice-3 test (LF, as committed): tests/work-graph/S3-graph-context.test.ts
  9d141568267663a6ab4218c641bfbd1cff3648f79b512d6d7e7235f079654c0f (replaces its line in `S/s3/frozen-tests-v2.sha256`).

## 3. Whole suite, run 1 (HEAD ccecc016; log `S/int-full.log.txt`, wslrun main-slices-full-1, 06:17–06:39)

typecheck 0, check:architecture 0, build 0; vitest 250 files / 5,626 tests: 4 failed in 2 files.
Per file vs slice 1's full run (`S/int-base-s1full.txt`, 239 / 5,458): only the 11 slice-3 files added (168 tests),
no file missing, every other count equal. Vs the 9b94fc55 wrap-up run (`S/int-base-9b94.txt`, 215 / 5,234): no file
missing or smaller; added S0 (3), message-machine +6, session-availability +3 (slice-1 test changes), S1 23 files
(212), S3 11 files (168): 5,234 + 3 + 9 + 212 + 168 = 5,626.

Failures (not flakes; both reproduce on 48c8d473 + slice-3 patch alone in slot s3, `int-s3only-c6`: 4 failed / 7 —
so slice-3 regressions that slice 3's named regression set did not contain; found only now):
1. `tests/composition/platform.test.ts` ×2: `graphContext`, `taskInputs` became enumerable public platform keys.
   Slice-3 spec §4.6: create-platform adds them as INTERNAL owners → same rule as slice 1's R4 (non-enumerable,
   same instances, routes read them by property). Fix: add both keys to slice 1's non-enumerable loop.
2. `tests/scenarios/C6-unrelated-adoption.test.ts` ×2: start refused `revision_conflict: conflicting guards for
   {Goal}` (debug run int-c6-dbg). The §3.6 consumption guards pinned the Goal at the revision the context read,
   beside the entry's own Goal guard at the current revision; an unrelated Plan adoption after prepare bumps the
   Goal → contradictory guards → the claimed Run stalls (`waiting`). This breaks C6 / U-11 (user decision: an
   unrelated adoption does not stop a claimed Run; W3 accepts the old-plan claim when the Task's basis and
   definition are unchanged). Decision (lead, by HANDOFF/STATE-MACHINES-SPEC U-11 over spec §3.6's general list):
   the consumption guards skip the Goal; the entry keeps guarding the Goal at its current revision and the W3 rule
   decides. Workspace (AD08), Plan and the other record/check/decision sources stay guarded.
   Open item: a Goal edit that changes the Goal section text (objective) after prepare is no longer refused at
   entry by the consumption guard; the context then carries the Goal text read at prepare time.
Both are small, covered by existing decisions, recorded as lead integration work; separate commit
e48218a5 "fix: orchestration slice 3 integration — keep C6 entry and the public platform keys (decisions 36, 43,
46)" (2 files, +11/−2). Check after the fix (int-fix1): typecheck 0, architecture 0, the 98 named files + C6 +
platform = 100 files / 1,980 tests pass.

## 4. Whole suite, run 2 (HEAD e48218a5; log `S/int-full2.log.txt`, wslrun main-slices-full-2, 06:45–07:07)

Under the lock, quiet machine: typecheck 0, check:architecture 0, build 0 (workbench published);
**250 files / 5,626 tests, all passed** (1,344 s). Per-file list identical to run 1 (`S/int-full2-perfile.txt`).
Vs 9b94fc55 (215 / 5,234) + slice 0 (1 / 3): added only slice 1 (23 files / 212 + 9 in existing state tests changed
by slice 1) and slice 3 (11 files / 168); none missing, no new failure.

## 5. verify:isolated (HEAD e48218a5; wslrun main-slices-isolated-1, locked, 07:07–07:29)

`npm run verify:isolated`: isolated copy typecheck, build and tests passed (250 files / 5,626 tests), workbench
smoke ok, exit 0 (1,286 s).

## 6. Result

Branch feat/reliability-and-structure (not pushed): 327ec020 slice 1, ccecc016 slice 3, e48218a5 integration fix.
Worktree clean; my refs/cc-snapshot/int-* and main-slices-* removed (local refs only). Slice 5 not integrated.
No product model call; DSH/Codex not used in this stage.

Docs still to sync (README "验收以后 lead 同步的文档", not done in this stage): STATE-MACHINES-SPEC rows + §15,
module-dag.md §6, capability index, HANDOFF, STATUS, DESIGN §8.2, evidence directories; plus the follow-up wiring
I-1 and I-3 (slices 1 and 3 now both merged).

Open items from this stage:
- C6 fix: a Goal objective edit after prepare is no longer refused at entry by the consumption guard (the Goal
  section is the prepare-time text); the W3/U-11 rule now alone decides on the Goal.
- Slice 3's acceptance ran only its named regression set; two slice-3 regressions surfaced only in the whole suite
  (fixed above). Slice 5's acceptance should include a whole-suite run before integration.
- The slice-1 open items (`S/s1/part2.md` §7.4) stay open.

## 7. Measurements (decisions 43, 46)

| who | wall | notes |
| --- | --- | --- |
| lead, this stage | 06:05 → 07:30 ≈ 85 min | ≈ 90 tool calls |
| waiting (listed separately) | ≈ 62 min | slice-1 named checks 1.5 min; slice-3 named 2.3 min; 3 single-file/debug runs ≈ 1 min; s3-only repro 0.3 min; fix check 2.2 min; whole suite ×2 ≈ 22 + 22 min; verify:isolated 21.5 min (partly overlapped with notes) |
| working | ≈ 23 min | patch checks, 3-way merge analysis and the brief port, fixture fix, C6/platform root cause, commits, notes |
| DSH / Codex | 0 | not used in this stage |
