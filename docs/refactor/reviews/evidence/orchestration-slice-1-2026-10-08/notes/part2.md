# Slice 1 — part 2 (new Session, decision 46)

2026-10-08 23:32 onward, lead (Claude). Branch feat/reliability-and-structure at dd21c239; real worktree untouched;
the product model was not called. `S` = `scratchpad/impl/s1`.

## 1. Send

- Brief: `S/part2-brief.md` with one lead edit before sending (lines 15–16: there is no `.dsh-scratch/` in the copy
  now; tests3 §4 moved it out): sha256 14e0a31e…09b0 (the earlier text is kept as `S/part2-brief.v1.md`, sha 106db3c0…1111).
  Book in WSL `~/dsh-work/slices/_books/s1-p2.md` (same bytes).
- Launcher `S/run-new.sh p2`: NEW Session (no --session-id), `--max-context 360000 --max-minutes 120`, run name
  `slices-s1-p2`. Existing sessions in the private state before the run: `S/sessions-before-p2.txt`.
- First launch failed at once (Git Bash rewrote the /mnt/c path; no run dir made); relaunched with MSYS_NO_PATHCONV=1
  at 23:34:05.

## 2. Run p2 (new Session session-8eafa3d3…, 23:34:06 → 01:33:02)

- Stopped by `limit:time (120 min)`; peakContext 359,007 (just under the 360,000 cap); main 175 steps, 209 tool
  calls, 40,126,398 tokens (input 248,435 / cacheRead 39,756,928 / output 121,035). 11 subagents (G0+G1 at 23:35,
  G2–G5 at 23:54, G6+G7 at 00:16, G8 at 00:55, two self-check reviewers at 01:22): 361,435,866 tokens, 1,795 tool
  calls, 1,658 steps (`S/p2-usage.jsonl`, dsh-usage.mjs over the 12 sessions created after `S/sessions-before-p2.txt`).
- `contamination: attempted-outside` in scan.json = 5 uses of the sandbox's private `/tmp` and one `../..` inside a
  type-import string in a send_message text: no real outside access.
- What it reached (its events, `S/p2-tail.txt`): all stubs replaced, typecheck/arch/build 0, new tests 210/212
  (IT19 bwrap, IT31), regression 527/14 (13 bwrap + session-availability record row); two self-check reviewers
  (`S/p2-selfcheck-1.txt` 14 items, `-2.txt` 11 items); it had applied one fix (malformed wait.messageRef guard)
  when the time limit hit. No final reply (final.md empty).
- Lead checks of that state (`check-copy.sh p2`, `S/p2-*.txt`, patch `S/p2-full.patch` sha 1a04e1bd…5d40): 93
  paths = expected list (`S/expected-paths.txt`: 62 src + 31 frozen), frozen sha256 all OK, platform-duty sha OK, no
  stub, typecheck 0, arch 0; new 210/212; regression 527/14.

## 3. Lead work after p2

### 3.1 Two frozen-test defects and one fixture gap (lead fixes, re-frozen)
| file | defect | fix |
| --- | --- | --- |
| tests/state/session-availability.test.ts:1084 | the record row archived and reactivated an `unavailable/damaged` record and expected success; S1-SES-05 (decision 38, S:470) and the same file's oracle refuse reactivation of any unavailable Session | the record row uses `health:'recoverable', healthConclusion:null` (a non-default health reactivation keeps) |
| tests/business/S1-session-maintenance.test.ts IT31 | the given cancels both A and B → plan validation `missing_required_executable_task` before any assertion (verified by DSH and Codex; plan service out of scope) | before closing B, one plan revision gives B `executionIntent:'plan_only'` (plan-validation's explicit-intent branch); B is not handed back to S |
| tests/helpers/S1-workflow-archive-fixture.ts:~1235 | the fixture Workflow lacked the close-event reader the real composition injects, so maintenance could only use the forbidden Run.endedAt fallback (§4.2 S:829 "而非最后Run.endedAt") | the fixture passes `records: { eventAt }` translated like create-platform.ts:932 |
New sha256 in `S/frozen-tests.sha256` (old list `S/frozen-tests.v1.sha256`). With these: new tests 211/212 (IT19 only),
regression 528/13 = expected (`check-copy.sh p2fix`, `S/p2fix-*.txt`, patch `S/p2fix-full.patch`).

### 3.2 IT19 in a WSL slot
`S/slot-patch-run.sh` (snapshot commit = 48c8d473 + patch via a temporary index in the shared repo; the real
worktree's files/index untouched; ref deleted after) in slot s1 with `with-usr-bin-node.sh`: S1-archive-restart 6/6
pass incl. IT19 (log `~/cc-work/logs/impl-s1-p2fix-it19-1.log`). IT19 fails in the DSH sandbox only for bwrap.

### 3.3 Codex review of the p2 state (xhigh, read-only, clone D:/cxt/impl-s1-p2n = 48c8d473 + p2-full.patch)
01:36:38 → 01:50:32 (13.9 min), exit 0, `S/codex-p2.md`; it also judged each self-check item. Result: reviewer 1:
13 confirmed, 1 refuted (already fixed); reviewer 2: 8 confirmed, 3 refuted (IT19 bwrap, K7 possible, routed
replies consumer) + IT31 setup; 16 additional findings. Lead verification: read the cited code lines for A2, A3, B1,
B2(…), C1, E1, E3, E4, E5, E7, E11, release (A4), requeue origin (C4), disposeArchiveWait (D1) and the cited spec
lines (S:172, 188, 190, 238–250, 285, 343–347, 385, 464–496, 600, 612–630, 760–830, 865): all as described.
Lead decisions recorded in the continuation brief §2: L-a (stopQueued from durable facts, failedDisposal stays true
for the explicit release entry: the spec defines no durable failure fact), L-b (per-advance maintenance inside the
Workflow; host.ts is outside the write scope), L-c (executor due: close event → formal Task/Plan history →
otherwise incomplete; no Run.endedAt), L-d (requeue recovery reuses the existing TaskRequeue of (Task, afterRun)
first, S:622), and the approved optional Workflow dependency `records?: WorkflowCloseEventReader`.

## 4. Continuation

- Brief `S/part2-continue.md` (key-information brief, ≈21 KB): state of the copy, the frozen-test changes, rules and
  lead decisions L-a…L-d, the verified gaps in 5 groups (G-A sessions A1–A9, G-B facts/provenance/claim B1–B9, G-C
  anchors/requeue C1–C4, G-D mailbox D1, G-E Workflow E1–E17), the work split (step 0, wave 1 G-A..G-D parallel,
  wave 2 G-E, self-check), checks with expected numbers, reply format. The first part-2 brief, with the new
  hashes, was put in the copy as `.dsh-scratch/part2-reference.md` (`S/part2-reference.md`, sha cee7aa11…db60);
  the old DSH scratch notes moved out to `S/fx/dsh-scratch-p2/`.
- p2c (session-41fddfd8…, 01:56:14 → 01:58:02, 108 s, book sha 3eb022c4…989e): step 0, launched 4 wave-1
  subagents, then ENDED ITS TURN "waiting on the subagents"; headless, so the run ended and the subagents were
  stopped (no file changed: copy patch sha equal to p2fix-full.patch, 07437255…51fe). Main 27 steps, 37 calls,
  1,266,389 tokens, peakContext 74,305. Lead: treated as a failed start (not a limit stop), relaunched once.
- p2c2: same brief plus one paragraph at the top of §4 (never end the turn while subagents run; wait with
  `sleep 300` and `list_agents`); book sha b573ac3c…281e7e; launched ≈02:03.
- p2c measured: main 1,266,389 tokens / 37 calls; its 4 wave-1 subagents had started (708,175 tokens, 36 calls) and
  were stopped with the run.
- p2c2 (session-fb023503…, 01:58:57 → 03:07:27, 4,109 s = 68.5 min, no limit hit, exit 0): main 78 steps, 98 tool
  calls, 8,502,691 tokens, peakContext 179,041; 13 subagents (4 wave-1, 1 G-B follow-up, 3 G-E, 5 self-check; the
  reply says 14 incl. a fix pass): 191,436,432 tokens, 1,293 calls. Reply `S/run-p2c2/final.md` (`S/p2c2.reply.md`).
  scan: contamination "attempted-outside" = private /tmp (4), one `../..` and one `~:508` inside message text.
  Its claims: typecheck/arch/build 0, S1 211/212 (IT19), regression 528/13, 93 paths, frozen OK; UNSPECIFIED:
  B6, B8, E2, E5, E13, E15 partly; E14 not closed; IT11 vs S1-AUTO-03.

## 5. Checks after p2c2 (step 2)

### 5.1 Scripted checks in the DSH sandbox (`check-copy.sh p2c2`, `S/p2c2-*.txt`)
93 paths = `S/expected-paths.txt`; frozen sha256 31/31 OK; platform-duty sha OK; no stub; typecheck 0; arch 0;
S1 211/212 (IT19); regression 528/13 (13 bwrap). Patch `S/p2c2-full.patch` sha 5a5b38d7…7304.

### 5.2 WSL slot (bwrap present; `S/slot-patch-run.sh`)
- S1 23 files: 212/212 (incl. IT19). 22-file regression: 538/3 — A8-host-restart-paused 3 failures (A8-3l, A8-3n,
  LA-1), hidden in the sandbox by bwrap. Same 3 already at the p2fix state (before the continuation).
- Whole suite (`npm test`, 1,222 s): 239 files, 5,458 tests: 43 failed / 5,415 passed in 21 files
  (`S/slot-p2c2-full2.detail.txt`, `S/full-fail-files.txt`). At 48c8d473 the same 18 scenario/composition files pass
  154/154 (slot run `impl-s1-hb-failfiles-2`).
- Lead root-cause work in the slot (debug edits only in `~/cc-work/slot-s1`, reset by the next snapshot):
  R1 maintenance `now = new Date()` vs injected fixture clocks → executor Sessions archived during advance
  (R5c trace: finishedAt 2026-09-26, now 2026-10-08, due=true; work-2's hint Session `lifecycle: archived`).
  Disabling executor-due fixed 10 failures. R3 retired-line archive at start-up/advance requeues Runs it did not stop:
  disabling it fixed the A8/A7/A11/harness cluster except 4 A4 + A8-3n + A8-R1 + C1-M1 (R2 decoded-shape).
  R2 decoded old records gain explicit null keys → receipts/roundtrips differ (A2-step1-codecs, C1-session-mailbox).

### 5.3 Codex second review (xhigh, read-only, clone D:/cxt/impl-s1-p2c = 48c8d473 + p2c2 patch)
03:08:56 → 03:22:49 (13.9 min), exit 0, `S/codex-p2c.md`. Of the 39 gap items: closed A2, A3, A5–A8, B1, B4, B5,
B7, B9, C2–C4, D1, E1, E4, E6, E7, E9–E11; partly/open A1, A4, A9, B2, B3, B6, B8, C1, E2, E3, E5, E8, E12–E17;
7 new findings (N1 stale stop pin swallowed, N2 terminal-close identity, N3 Query claim legacy provenance, N4
predecessor chain, N5 null creation provenance, N6 executionPins validation, N7 brief 16 KiB budget). Lead verified
by reading the cited code of A1, A4, E2, E3, E5, E12, E13, E17, N1, N2 and the decisions' spec lines.

### 5.4 Lead test changes (spec-mandated expectation changes, §5.5 last paragraph; re-frozen)
- `tests/helpers/S1-workflow-archive-fixture.ts`: also passes `messages` (the same mailbox, as create-platform
  `messages: mailbox`), so the copy-archive rule can read its three facts (IT11 given already has all three).
- `tests/contracts/A2-rework-contract-helpers.test.ts`: closed automation list + `workflow:session-archive` (S:596).
- `tests/work-graph/C1-session-mailbox.test.ts`: lookup list + `session-reply-by-handler` (IDX-S6, S:383).
Frozen list now 33 files (`S/frozen-tests.sha256`; previous `S/frozen-tests.v2.sha256`), expected paths 95
(`S/expected-paths.v2.txt`). Sandbox check of the three: S1-session-maintenance, S1-archive-flow, A2-rework pass;
C1-session-mailbox only the 5 receipt failures (R2) remain.

## 6. Guided round (one, new Session)
- Brief `S/part2-guided.md` (≈24 KB; sha 24e285a4…0106): state, the 33 frozen hashes, rules, section 3
  regressions R1–R4 with the lead's traces and decisions L-g (injected Workflow clock), L-f (absent new optional
  keys stay absent on decode), L-e (archive requeue only for Runs/waits this archive stopped; a retired line's
  already-ended Run gets anchor + drop, the existing automation requeues it), R4 (no new public platform keys);
  section 4 the remaining gaps with decisions (approved optional Workflow deps `now`, `responsibilityBasis`,
  `legacyProvenance`; E5-owner receipt read; E8 lease wrap in composition; E15 minimal new step kinds allowed);
  groups G-S, G-T, G-C (wave 1), G-W1..W3 (wave 2), self-check; checks incl. the 21 regressed files.
- Copy before the round: `S/pre-p2g-full.patch` (sha 1957136…971c). Launched p2g 04:10:02.
- p2g (session-faecfcd7…, 04:10:02 → 05:12:08, 3,726 s = 62.1 min, no limit hit): main 180 steps, 193 calls,
  32,509,541 tokens, peakContext 336,814 (under the 360K cap); 8 subagents (G-S, G-T, G-C, G-W1..W3, 2 self-check):
  176,697,922 tokens, 1,072 calls. Reply `S/p2g.reply.md`. scan: private /tmp (23) and `../` inside import strings
  (7); no outside access. Patch after the round `S/p2g-full.patch` (sha 22a1d802…5479), 94 paths
  (`src/app/collaboration-driver.ts` back to HEAD: its only addition was removed per L-b/E17).
- DSH's own report: sandbox checks as expected (S1 211/212 IT19; regression 528/13); in the 21-file set 7 non-bwrap
  failures, all the R2 family: it kept the §2.9 null default because frozen SV01/SV58 assert `toBeNull()` on decoded
  old records (my L-f was wrong for record decoders — it correctly reported the conflict). E15 only half (provenance;
  no transfer / predecessor archive); E8 allows no-instance compositions; R4 via non-enumerable properties; plus small
  items (A1 prefix, rule-9 readFacts edge, old-route wait guard, A9 runDisposeAttempt order, N6 extra pin).

## 7. After the guided round

### 7.1 WSL slot, whole suite on `S/p2g-full.patch`
239 files, 5,458 tests: 10 failed / 5,448 passed, 4 files: C1-M1-platform 1, A4-duplicate-receipts 3,
A2-step1-codecs 1, C1-session-mailbox 5 — all "replay/decoded value has extra null keys" (`S/slot-p2g-full.detail.txt`).
The R1/R3/R4 clusters (33 failures before) are gone.

### 7.2 Lead fixes (small leftovers, lead work)
1. `src/core/work-graph/sessions/message-record-codecs.ts` `sessionMessageFromEvent` and
   `src/core/work-graph/sessions/session-record-codecs.ts` SessionCreated event payload: event payloads (the replay
   source) keep exactly the keys they were written with; only the RECORD decoders keep the §2.9 null default (SV01,
   SV58 read records). Rule 1: a replay returns the original event value. Fixes C1-session-mailbox ×5, C1-M1,
   A4 create_session.
2. `tests/work-graph/A2-step1-codecs.test.ts:684` (existing test, spec-mandated change §2.9; §5.5 last paragraph):
   the decoded old Session now includes `provenance: null, archiveRequest: null`. Added to the frozen list.
3. `src/business/workflow/workflow.ts` `advanceWork`: `select_work` runs the maintenance page before choosing work
   (unchanged); a `perform` runs it AFTER the step and only when the step's owner did not replay its receipt. Cause
   (slot trace): the re-sent `complete_task` of A4 ran maintenance first, which closed the now-terminal
   responsibility (+1 `SessionResponsibilityChanged`), breaking "the copy started nothing and wrote nothing".
After 1+2 the slot run of the 4 files + S1 23 + regression 22: only the A4 complete_task case failed (fixed by 3).
4. Re-froze: `S/frozen-tests.sha256` = 34 files (+ `tests/work-graph/A2-step1-codecs.test.ts`; previous lists
   v1/v2/v3 kept). Expected paths `S/expected-paths.v3.txt` = 95 (61 src + 34 tests; collaboration-driver.ts is
   net-zero vs 48c8d473).

### 7.3 Final checks (patch `S/lead-g2-full.patch` = `S/final-full.patch` = `S/accepted.patch`, sha f33ae922…f552)
- WSL slot, whole suite (`npm test` with bwrap, log `~/cc-work/logs/impl-s1-leadg2-full.detail`,
  `S/slot-leadg2-full.detail.txt`): **239 files, 5,458 tests, all passed**.
- DSH sandbox (`check-copy2.sh final`, `S/final-*.txt`): typecheck 0, check:architecture 0, build 0; S1 23 files
  211/212 (IT19 = bwrap only; passes in the slot); regression 22 files 528/13 (13 bwrap, all pass in the slot);
  21 extra files 62 bwrap failures in the sandbox (all pass in the slot); `git diff --name-only` = 95 expected paths
  exactly; 34 frozen sha256 OK; no stub; platform-duty sha256 6adfb57e…9e39; no commit in the copy (only
  `578844c baseline`); `.dsh-scratch/` absent; scan.json of every run: only private /tmp and `../` in import text.
- `S/accepted.patch` (vs the copy's slice-base, binary-safe, new files included; 95 paths) + `S/accepted.patch.sha256`.

### 7.4 Open items (not closed; recorded, need a follow-up or a lead/user decision)
- E15 second half (spec §4.1 S:799): the ordinary continuation (C3 interruption, role mismatch) writes
  `continuation` provenance but does not transfer the responsibility nor archive the predecessor; needs new
  Workflow step kinds. No frozen test covers it. User-visible: an old line continued this way keeps an open
  responsible link and is not archived by that path.
- Rule-9 edge: `session-archive.ts` `drive` returns a raw rejection when the Session facts read fails right after
  the request committed (should be `ready/partial` keeping R). Untested technical branch.
- Old `sessions/archive` route: no normal-wait refusal path (S:865 says it still refuses 普通等待); A1/A8 tests pass.
- A9 remainder: `runDisposeAttempt` reads the Task basis before destination eligibility (order S:614).
- N6 remainder: an extra unrelated pin next to the required one is not refused.
- R4 mechanism: the three internal ports are non-enumerable properties of the platform object (routes read them).
- E8: the lease wrap allows compositions without a host instance (in-process test compositions).
- New optional `WorkflowAdvanceResult.value.maintenanceFailures?` and Host-only `readTaskRequeue` (E5), and
  `QueryExecutionDependencies.legacyProvenance?` in `queries/contracts.ts` (N3) — lead-approved additions beyond K1.
- Lead decisions this stage: L-a…L-g (see §3.3, §6), the approved optional Workflow deps (`records`, `now`,
  `responsibilityBasis`, `legacyProvenance`, `messages` use), test updates in §3.1/§5.4/§7.2.

## 8. Measurements (decisions 43, 46)

| run | wall | main tokens | main calls | peakContext | subagents (n / tokens / calls) |
| --- | --- | --- | --- | --- | --- |
| p2 (new Session, time limit) | 7,136 s | 40,126,398 | 209 | 359,007 | 11 / 361,435,866 / 1,795 |
| p2c (ended its turn early) | 108 s | 1,266,389 | 37 | 74,305 | 4 / 708,175 / 36 |
| p2c2 (continuation) | 4,109 s | 8,502,691 | 98 | 179,041 | 13 / 191,436,432 / 1,293 |
| p2g (guided round) | 3,726 s | 32,509,541 | 193 | 336,814 | 8 / 176,697,922 / 1,072 |
| **part 2 total** | **15,079 s (251 min)** | **82,405,019** | **537** | max 359,007 | **36 / 730,278,395 / 4,196** |

Slice 1 all DSH (part 1 from review1.md §7 + part 2): main 150,079,114 tokens, 888 main calls; subagents 86 /
1,160,688,903 tokens / ≈ 7,903 calls; ≈ 1,310.8M tokens in all; wall ≈ 20,214 s (337 min).
Codex this stage: review of p2 13.9 min (01:36–01:50), review of p2c2 13.9 min (03:08–03:22), both read-only xhigh.
Earlier for slice 1: part-1 review 15 min, re-review 14.7 min, 4 fixture runs 66.2 min wall (tests stage).
Lead this stage: 23:32 → 06:06 (≈ 6.6 h), ≈ 190 tool calls. Waiting listed separately: DSH 251 min; slot whole-suite
runs 3 × ≈ 20.5 min + shorter slot runs ≈ 15 min; sandbox checks ≈ 20 min (Codex overlapped with my own work) —
≈ 5.1 h waiting, ≈ 1.5 h reading, debugging (slot root causes R1–R3, A4), deciding and writing. Earlier lead effort
for slice 1: tests stage ≈ 96 min / ≈ 95 calls (tests3.md §7), part-1 resume ≈ 69 min / ≈ 57 calls (review1.md §7).

## 9. Kept / where
- Copy `~/dsh-work/slices/s1` = 48c8d473 + accepted.patch (uncommitted; HEAD 578844c slice-base); DSH state
  `~/dsh-work/ladder/_runs/_state/slices-s1`; run dirs slices-s1-p2, -p2c, -p2c2, -p2g; books
  `~/dsh-work/slices/_books/s1-p2.md`, -p2c, -p2c2, -p2g.
- Replies `S/p2c2.reply.md`, `S/p2g.reply.md` (p2 had none); run records `S/run-p2*/`; Codex `S/codex-p2.md`,
  `S/codex-p2c.md` (+ events); self-check texts `S/p2-selfcheck-1.txt`, `-2.txt`; slot logs in `~/cc-work/logs/`.
- Codex clones D:/cxt/impl-s1-p2n, D:/cxt/impl-s1-p2c (the user deletes D:/cxt).
