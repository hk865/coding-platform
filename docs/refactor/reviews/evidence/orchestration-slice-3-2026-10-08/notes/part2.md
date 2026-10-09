# Slice 3 — part 2 and its review (lead notes)

S = this folder. Copy `~/dsh-work/slices/s3` (HEAD = tag slice-base 96f3208, nothing committed there). Real worktree
untouched at dd21c239; nothing committed for slice 3; the product model was not called.

## 1. Part 2 (run 2, OLD Session — before decision 46)

- Sent `S/part2.sent.md` (sha256 eeb1d7b4…84ec) to the part-1 Session session-63415678-640d-4955-9662-5521933a5396
  (run slices-s3-p2, `S/run-p2/`), 20:43:15–21:32:09, 2934 s, exit 0, stoppedBy null. peakContext was not in run.json
  then (runner change came at 21:55); the stage brief puts it at ≈ 439K (inside the attention-loss zone of decision 46).
- Reply `S/part2.reply.md`: 42 files (allowlist unchanged), typecheck/arch/build 0, new tests 166/168 (GT10, GT12 fail
  and are reported as test-vs-spec conflicts), regression = baseline, CA11/CA14 seam reported.
- scan.json `contamination: attempted-outside` is a false positive: the 8 path hits are prompt text to subagents ("never
  write to /tmp") and one `..` import; canaryHits 0; privateTmpUses 6 = the sandbox's private /tmp.
- Usage (dsh-usage.mjs on `_runs/_state/slices-s3`, `S/p2-cumulative-usage.jsonl` minus `S/p1b-cumulative-usage.jsonl`):
  main 16,572,748 tokens / 53 calls / 40 steps (run.json); subagents 6 / 111,567,492 tokens / 686 calls; p2 total
  128,140,240 tokens, 739 calls.

## 2. Scripted checks on the part-2 result (run 2's agent ran them 21:33–21:35; verified and summarised here)

| check | result |
| --- | --- |
| diff name list (`S/lead-p2-name-status.txt`) | 42 paths = `S/expected-paths.txt` (spec §6 + routes.ts) minus the allowlist (unchanged, see B below) |
| frozen sha (`S/lead-p2-sha.txt`) | 11 = `S/frozen-tests.sha256`; platform-duty.ts 6adfb57e…9e39 |
| typecheck / check:architecture / build | 0 / 0 / 0 |
| 11 new files | 10 passed / 1 failed, 166 / 2 (GT10, GT12) |
| regression (50) | 19 failed / 31 passed, 63 failed / 1028 / 29 skipped; per file equal to `S/baseline-vsum.md` (`S/lead-p2-reg-vsum.md`, script `S/vsum-p2.sh`: REG-PER-FILE-EQUAL-BASELINE) |
| bwrap-only failures | the 19 failing files run in WSL with real bubblewrap (`S/bwrap-check.sh bw-p2`, 21:36–21:38): 19 passed, 146 passed; copy status unchanged |
| `not implemented:` grep | empty |
| allowlist diff | empty |
| commits in the copy | none (`S/lead-p2-log.txt`) |

## 3. Codex review of part 2 (xhigh, read-only)

- Clone D:/cxt/impl-s3-p2r (detached 48c8d473 + `S/lead-p2.patch`), `S/run-codex-p2.sh r1`, prompt `S/codex-p2.prompt.txt`.
  21:33:50–21:55 (≈ 21.5 min), exit 0. Output `S/codex-r1.md`: 21 must-fix + 5 should-fix, answers to A–D. One
  internal "collab spawn failed" line in `S/codex-r1-err.txt` (subagent spawn); the main review completed.
  Usage: in 6,757,801 (cache 6,432,512), out 24,295 (reasoning 9,105).

## 4. Lead verification of every Codex finding (code read in D:/cxt/impl-s3-p2r)

Confirmed (sent to the guided round; item ids of `S/p2g.sent.md`):
- #1 history proxy validates with the trusted Host ctx and the Run's own Goal (execution-driver.ts:117-166) → G6.1.
- #2 Work caller may name a non-active, non-claim Plan (context-input-service.ts:317) → G3.1.
- #3 G-INPUT ignores edge upstream and source kind (state/context-input.ts:225/263) → G1.2.
- #4 partly: `binding === null` treated as legacy, no required-section / omission-marker consistency check, binding.duty
  and callKind never compared → G1.3, G1.4, G2.2. The rest of #4 (UTF-8 header validation) not required by §3.2 text.
- #5 no guards for the consumed Round/Message/application/other record sources in the commit (§3.6) → G2.1. Query part
  not sent (Query has no inputs; CTX-03 asks only G-CTX).
- #6 legacy cross-Goal Run owner and QueryRun owner refused (state/context-input.ts:294; §8.3) → G1.1.
- #7 cursor provenance trusted + materials of unguarded declarations opened (context-input-service.ts:822/985/1007) → G3.2, G3.3.
- #8 gate head = max ordinal across all Runs, no basis check (context-input-service.ts:502) → G3.4. The sub-point "an
  unsupported index becomes an empty chain" is the existing `readGateRoundChain` semantics (both backends register the
  index); not sent.
- #9 decision: capability checked after existence/reply (C4) and no link to upstream → G3.5 (IN14's Message is sent
  by runA, so the link is testable).
- #10 Query assembly ignores the graph port, layout and the second prelude line → G5.1.
- #11 input-page failures rendered as selected rows, no candidateKey/selection comparison, non-artifact selections
  dropped → G5.2.
- #12 reader swallows lookup errors / corrupt records → G4.1. #13 truncation (Sessions 200, Rounds 50, executions 100)
  → G4.2. #14 historical Run cards `run: null`, direct look not_found → G4.3. #15 basis key/sources lack Run/Round
  versions, no current pins → G4.4. #16 principal alias across awaits → G4.5. #17 attention facts: no edges, no
  revision, version = H(key) — a regression against the legacy scanner (attention-observer.ts:669-712) → G4.6.
- #19 task card: upstream only legacy, raw phase, reminder never finds upstream facts → G5.4.
- #20 not-connected reminders only without the graph port (§4.3 line 508) → G5.3 (+ CA11 lead fix).
- #22 one-argument factories fall back to the old builder (§4.2) → G5.7 (no caller uses one argument).
- #23 card indexes ignore the extensions seam → G4.7. #24 tiny-budget omissions outside the section range → G5.5.
  #25 attention renderer reserves an omitted line for the last row → G5.6.

Rejected (with reason):
- #18 attention retry identity: re-observing per tick and `lastHeartbeatMs` advancing before the send are pre-existing
  Host/observer behaviour (not in the slice diff); for an unchanged snapshot the new text and requestId are
  deterministic. Not a slice-3 regression.
- #21 `at = now()` in the brief checkpoint: the original `briefWorkspaceFacts` (execution-preparation.ts:253 at HEAD)
  does the same; §4.2 keeps the original brief contract. Not a slice-3 change.
- #26 DTOs in WorkGraph model: the part-1 skeleton put them there and the lead accepted part 1; frozen tests import
  `NodeCardV1`/`GraphContextReadPort` from model. Moving them now is churn with no behaviour; recorded for the docs
  sync (spec §4.1 says Contracts).
- A (GT10/GT12): the frozen tests were wrong (GT10 reads requests[1] for two separate replies; GT12/GT05 ran the Query
  on a separate Goal while §5.1/§5.8 GT05 say "canonical Query p/g/w"). Lead fix, see §5.
- B (allowlist): confirmed by Codex and production-reach passing: no slice-3 `kept-for` entry is reached.
- C (`attentionSignalToJson` in the requestId hash): legitimate; equal canonical JSON for the old signal shapes.
- D (CA11 vs CA14): implementation wrong (G5.3) AND CA11 had an assertion against §4.3 → lead fix.

## 5. Lead test fixes after the freeze (decided by §0 → spec body; recorded as lead work)

- `tests/runtime/S3-graph-tools.test.ts` (run 2's agent prepared it in `S/leadfix/`, diff `S/leadfix/gt-fix.diff`,
  tried 21:38: typecheck 0, 14/14 pass): GT10 find+look in one scripted reply; the Query is a `semantic_query` on the
  Work Goal (GT_QUERY_GOAL_REF = AG2B_GOAL_REF, no separate Goal creation). Reason: spec §5.8 GT10 "下一provider请求存在两个
  真实tool结果", GT05 "canonical Query p/g/w", §4.4/§4.6 (tools bound to the canonical QueryJob Goal). The file was
  already copied into the copy by run 2 (`S/leadfix/try-gt.sh`); kept. Original saved as `S/leadfix/S3-graph-tools.test.ts.orig`.
- `tests/runtime/S3-context-assembler.test.ts` CA11: removed `expect(input).not.toContain('未接入')` (+ a 3-line
  comment). Reason: §4.3 line 508 and CA14; the CA11 row asks only for the declaration and tA facts. Script
  `S/leadfix/ca11-fix.py` via `S/leadfix/apply-ca11.sh`; diff `S/leadfix/ca11-fix.diff`; original `.orig` beside it.
- New frozen list `S/frozen-tests-v2.sha256` (only these two lines differ from `S/frozen-tests.sha256`):
  S3-context-assembler 4c76b681…73e2, S3-graph-tools eb330446…c38.
- Snapshot of the copy before the guided round: `S/pre-p2g.patch` (sha256 27dfdc08…50d2, 42 paths).

## 6. Guided round (§6.4; the one round for part 2) — NEW Session, decision 46

- Brief `S/p2g.sent.md` (33.7 KB, ≈ 10K tokens; copy `~/dsh-work/slices/_books/s3-p2g.md`, sha256 257c4612…c39f):
  what the copy is, spec sections per item, frozen shas v2, rules (scope per group, no contract/model signature change,
  error codes, C3/C4/C6/C10/C11), six groups G1–G6 by file with file:line + spec rule + direction (no code), one
  subagent per group, review subagent per group at the end, checks with expected numbers, reply format.
- Launched `S/run-p2g.sh` (run slices-s3-p2g, no --session-id, --max-context 360000 --max-minutes 120) at 22:06:21.
- Try 1 (run slices-s3-p2g, Session session-62e5d1c2-ee75-47b5-ab5d-9a02ce19da09, 22:06:21–22:07:40, 79 s, exit 0,
  peakContext 55,117, 14 calls, 317,728 tokens): DSH started six subagents and ended its turn ("I'll hold here");
  in headless mode that ends the run and kills the subagents. The copy was byte-identical afterwards
  (`S/after-p2g-try1.patch` = `S/pre-p2g.patch`). Not counted as the guided round (no work reached the copy).
  Records `S/run-p2g/`, brief `S/p2g-try1.sent.md`.
- Try 2: same brief plus one paragraph at the top of section 4 (stay in the turn until every subagent has reported;
  wait with a blocking `sleep` and `list_agents`), `S/p2g.sent.md`; another NEW Session, run slices-s3-p2g2,
  `S/run-p2g.sh p2g2`, same flags.

## 7. Guided round result (try 2, run slices-s3-p2g2)

- Session session-43540800-f4ea-4e5d-8c9b-3de53be91ee9 (NEW), 22:08:54–23:04:52, 3358 s, exit 0, stoppedBy null,
  peakContext 183,473 (< 360K cap), contamination none. Reply `S/run-p2g2/final.md` (four sections).
- DSH ran six group subagents in parallel, then six fresh-context reviewers, then targeted fixers (13 subagents).
  It found and fixed one real regression of its own G2.1 guard (the focus Run self-guard broke A4; excluded).
- All items G1.1–G6.1 reported done; deviations (lead verdicts):
  - G2.2 Query: `initial_coordination` accepts `planning` or `copy` (copy only without the graph port; frozen AD07
    builds `copy`). Accepted: production always wires the port.
  - G3.4: gate-kind upstream reads the gate's own chain (gate rounds are anchored on the gate Task, no Run of it);
    work-kind upstream uses its selected Run's chain; basis (plan/taskBasis/workspace/policy/architecture) checked.
    Accepted.
  - G3.5: new reason `decision_message_unrelated`. Accepted.
  - G4.3 partial: `findGraph` still lists only the selected Runs; older Runs are reachable through look/executions.
    Accepted as a remaining gap (spec §4.1 find domain "Run/Round取该Goal的任务" is not explicit about history); noted
    for the docs sync.
  - "Integration risk" DSH named (legacy `platform-<duty>@s3.1` Session: duty dropped) — confirmed by the lead and
    fixed as lead work (L1–L3 below).
  - G1 `attention` section table: pre-existing, no manifest uses callKind attention. Not changed.
- Lead checks on the DSH result (`S/check-copy-p2.sh lead-p2g`, 23:05–23:19, waited ≈ 11 min on the shared test
  lock behind the s1/s5 stages): typecheck 0, arch 0, build 0, 11 files 168/168, regression 19 failed / 31 passed,
  63 failed / 1028 / 29 skipped, not-implemented grep empty, allowlist diff empty, frozen = `S/frozen-tests-v2.sha256`,
  platform-duty 6adfb57e…, name-status = part 2 (42 paths). Patch `S/lead-p2g.patch`
  (sha256 e3c9db27ccf7a461dc8a5625cfbbb41bd3eed57b47f1f1bb66281a38898ae0b8).
- Usage (dsh-usage, `S/p2g2-cumulative-usage.jsonl` vs `S/p2-cumulative-usage.jsonl`, split by session creation time):
  try 1: 7 sessions (main + 6 killed subagents), 1,224,884 tokens, 78 calls (main 317,728 / 14 calls, run.json);
  try 2: main 8,119,078 tokens / 91 calls / 66 steps (run.json), 13 subagents 110,631,494 tokens / 1,035 calls;
  try 2 total 118,750,572 tokens, 1,126 calls.

## 8. Lead review of the round and lead fixes (small gaps, fixed by the lead)

Read the whole round diff (`S/p2g-round.diff`, 2,336 lines; G4 `S/p2g-g4.diff`): every item matches its direction
except the points below.

- L1 `execution-preparation.ts:snapshotRuntimeConfiguration` dropped the Host grant's `platformDuty` and
  `contextResidentBytes` (the resolver spreads the grant into ResolvedRuntimeConfiguration, `runtime-configuration.ts:410`),
  so for Work a Host-configured resident budget and duty never reached the assembler (§2.4 item 3). Query used the
  unsnapshotted configuration and was fine. Fix: copy the two optional fields.
- L2 the assembler's duty ignored the Session's versioned legacy template (`platform-<duty>@s3.1`, §2.4 item 3 /
  §2.5: the template ref fixes the duty), so a legacy secretary Session without an explicit Host duty assembled as
  `executor` while G2.2 admission expected `secretary` → `forbidden`. Fix: one `effectiveDuty(role, configuration,
  sessionRole)` for Work and Query: Role duty, else Host duty, else template duty, else executor; Host vs template
  mismatch → `forbidden` (the Host validation already refuses that pairing).
- L3 G2.2 admission (Work and Query) compared the duty also when neither Role nor template fixes it (then the Host
  chose it, and the manifest's Host configuration revision pins the choice) → false `forbidden` for a RoleSpec without
  duty under a Host grant with a duty. Fix: compare only when Role or template fixes the duty.
- L4 G2.1 consumed-source guards and the (part-2) Workspace-revision comparison also ran on CTX-02, the
  re-authorization of an already bound manifest (`Starting.Revoked`, same `authorizeRuntimeEntry`): a bound Run whose
  Goal or Workspace revision moved on (e.g. a pause/resume, another Run's workspace change) could never re-enter.
  Spec §3.2 CTX-02: validate the bound manifest, do not re-select or re-assemble. Fix: when
  `run.executionAuthorization.phase === 'revoked'` keep G-CTX/G-INPUT/duty/callKind but skip the source guards and the
  Workspace-revision comparison.
- Script `S/leadfix/lead-src-fix.py` (exact replacements, each asserted once) via `S/leadfix/apply-src.sh`;
  typecheck 0 right after (`S/leadfix/src-typecheck.txt`). Files: execution-preparation.ts, context-assembler.ts,
  execution-entry-service.ts, work-graph/queries/query-execution.ts (all inside the 42 paths).
- L5 found by the real-bubblewrap run (`S/bwrap-check.sh bw-p2l`: 18/19 files, 145/146): the DSH round broke
  `tests/app/orchestration-mechanism.test.ts > runs two explicitly selected same-Goal Tasks in independent Sessions
  with overlapping real provider calls` (`expected 1 to be 2` entered Runs, :304). In the sandbox the test was in the
  baseline failure list, so the per-file numbers stayed equal and DSH's "same failing names" hid it; only the failure
  message changed (`S/reg-fail-names.diff` at that point: the bwrap message → `expected 1 to be 2`). It was already in
  `S/lead-p2g-vitest-reg.txt`, i.e. DSH's result, not the lead fixes. Cause: the G4.4 change made
  `readContextFacts.sources` list every Run, Round and Session of the Goal, so a Work binding "consumed" the sibling
  Task's Run and the new §3.6 guard refused the parallel entry. Fix `S/leadfix/lead-src-fix2.py` (graph-context-reader.ts):
  the facts' sources are Goal, Plan, architecture baseline and the focus Tasks' Runs. That test then passed in WSL
  with bubblewrap (15/15, `S/leadfix/src2-orch.txt`).

## 9. Final checks (copy with the DSH round + lead fixes L1–L5), 23:26–23:31

`S/check-copy-p2.sh lead-p2m`, `S/bwrap-check.sh bw-p2m`, `S/vsum-p2m.sh`:

| check | result |
| --- | --- |
| typecheck / check:architecture / build | 0 / 0 / 0 |
| 11 new files | 11 passed, 168 / 168 |
| regression (50, DSH sandbox) | 19 failed / 31 passed, 63 failed / 1028 / 29 skipped; per file = baseline (REG-PER-FILE-EQUAL-BASELINE) and every failing test name AND message = baseline (`S/reg-fail-names.diff` empty) |
| the 19 bwrap-only files in WSL with real bubblewrap | 19 passed, 146 / 146 (`S/bw-p2m.out`); copy status unchanged |
| `not implemented:` grep | empty |
| allowlist diff | empty (production-reach passes; no slice-3 `kept-for` entry reached) |
| frozen tests | = `S/frozen-tests-v2.sha256` (11); platform-duty.ts 6adfb57e…9e39 |
| changed paths | 42, name-status identical to part 2 (`S/lead-p2m-name-status.txt`); no commit, no tag, no `.dsh-scratch/` in the copy |

Accepted patch: `S/accepted.patch` = `S/lead-p2m.patch` (binary, vs the copy's slice-base, incl. new files; 42 paths),
sha256 7ee52398086dc1fa9c8741c97712dee824d7f9d5c157b0beb6322ea801f7a0c8 (`S/accepted.patch.sha256`).
`git apply --cached --check --binary` against the real worktree index at dd21c239: applies cleanly (nothing changed).
It contains the two lead test fixes (GT10/GT12 fixture, CA11 line) and the lead source fixes L1–L5.

## 10. Measurements (decisions 43, 46)

| who | wall | tokens | calls | peakContext |
| --- | --- | --- | --- | --- |
| DSH part 2 (old Session, run 2) main | 2934 s | 16,572,748 | 53 | ≈ 439K (stage brief; not in run.json then) |
| DSH part 2 subagents | inside | 111,567,492 (6 sessions) | 686 | — |
| DSH guided try 1 (new Session) main | 79 s | 317,728 | 14 | 55,117 |
| DSH guided try 1 subagents (killed) | inside | 907,156 (6) | 64 | — |
| DSH guided try 2 (new Session) main | 3358 s | 8,119,078 | 91 | 183,473 |
| DSH guided try 2 subagents | inside | 110,631,494 (13) | 1,035 | — |
| Codex part-2 review (xhigh, run 2's launch) | ≈ 21.5 min (21:33:50–21:55) | in 6,757,801 / out 24,295 | — | — |
| lead, this stage (21:55–23:32) | ≈ 97 min | not recorded | ≈ 75 tool calls | — |

Lead waiting, listed separately: Codex finish ≈ 0.5 min; DSH try 1 1.3 min; DSH try 2 56 min; lead checks 14 min
(≈ 11 of them queued on the shared test lock behind s1/s5) + 4 min + 1 min + 5 min. So ≈ 81 min waiting, ≈ 16 min
reading, deciding and writing (Codex verification, the brief, the round review, five lead fixes).
