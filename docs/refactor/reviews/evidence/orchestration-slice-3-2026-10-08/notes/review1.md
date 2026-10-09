# Slice 3 — TestReview of part 1 (lead notes)

Stage start 2026-10-08 16:08 (+08:00). Real worktree untouched at HB 48c8d473; nothing committed; the product model was not called.

## 1. Codex review

- Clone: D:/cxt/impl-s3-p1 (git clone --shared --no-checkout of the real worktree, detached at 48c8d473, core.longpaths true), `git apply --binary scratchpad/impl/s3/part1.patch` (sha256 4172bb0e…0bc91) -> 14 M + 21 ?? files.
- Command: scratchpad/impl/s3/run-codex.sh (codex exec -s read-only, effort high, --ephemeral --json). Prompt: codex.prompt.txt.
- Run: 16:09:25 -> 16:18:44 (9.3 min), exit 0. One internal "collab spawn failed" error in codex-err.txt (subagent spawn); the main review completed. Output: codex.md (27 KB, 64 findings + 2 spec seams), events codex-events.jsonl.
- Codex checked all 116 rows; ids and 168 runs confirmed.

## 2. Lead's own scripted pass

- Spec case ids per section (awk over slice-3-SPEC.md §5.2–5.11 tables) vs `it(` titles per file (grep): all 11 files match exactly (ST01–15, IN01–19, GR01–19, CA01–15, AD01–08, RP01–06, GT01–14, AT01–12, RT01–06, SC01, SC02). Same as lead-p1-ids.txt (116 ids, 168 runs).
- Read row by row (more than 15, spread over all files): ST04, ST05, ST08, ST14; IN01–IN19 (all); GR01–GR19 (all) + fixture; CA01–CA15 (all); AD02, AD07, AD08; RP01–RP06 (all); GT01–GT14 (all) + fixture; AT01–AT12 (all); RT03, RT04 (+ index); SC01, SC02 (all). Plus the diffs of role.ts, host.ts, routes.ts, attention-observer.ts.
- Own findings before reading Codex (all later confirmed by Codex): SC01/SC02 on the AG2b harness without §5.1 facts and with missing row items; IN11/IN12 same fixture, opposite expectations, no Round chain; IN14 no Message/no decisionApplications (spec §3.5 then says unavailable/unsupported); IN19, GR17/GR18 no canonical QueryJob/QueryRun; IN05 runA2 is a valid owner, not a mismatched one; GR17 tautological scopeKey; GR19 asserts its own input ctx; GR14 fake port instead of damaged codec; CA03/04/10/11/13/14/15 run on `{}` inputs/deps; CA12 fake brief string; GT05–GT13 test recording fakes instead of the driver proxy / input owner / real Query Kernel; GT11/GT12 vacuous; AT02/AT06 check DTO not text; AT09/AT10/AT12 observer-only (pass already, Host send path untested); RP06 configures no skills.

## 3. Verification of Codex findings

Verified against code (D:/cxt/impl-s3-p1):
- #1 ST04/ST05/ST08 multi-cause negatives: confirmed (context-input.test.ts:119-180; ST08 callKind 'work' + continuation section).
- #3 IN01 vs IN09 contradiction (page projection one vs two entries, IN09 unfiltered read returns 6): confirmed — new to the lead.
- #13 GR executions need claim-linked records: confirmed by run-state-service.ts:505-520 (`incomplete` for missing outbox/TaskAttempt/Plan/Session).
- #14 GR07 lowercase b in `src/b`, `sb`, `builder`: confirmed against §4.1 find fields (name/paths/summary; Session summary = role JSON).
- #44 AD02 tautology (`prepared.inputBinding` vs itself, :450): confirmed.
- #49 RP03 `bad_enum`: it is the existing enum code in validation/common.ts and role.ts — lead accepts (decision 5), no fix.
- #12 IN08: spec has no carrier field — lead keeps the current assertion (decision 6).
- #61 early behaviour (role.ts enum check, host.ts grant + configurationRevision, role-profiles lookup): lead accepts as early part-2 work (decision 2); it matches §2.4/§2.5/§4.6; regression unchanged except production-reach. Not reverted (reverting then redoing is pure waste).
- #62 platformRoleProfile lookup: accepted with #61.
- #63 create-platform publishes raw owners / readAttentionGraph without trackedCall: true vs §4.6 "所有读调用沿现有trackedCall关闭保护"; this is part-2 wiring -> part-2 correction rule.
- #64 routes.ts: accepted as type-forced (decision 1).
- Spec seams: §5.1 "no numeric business planRevision" vs the current required `planRevision` field — keep the existing field (tests already use planRevision: 1). CA01 inputDigest: renderContext returns no inputDigest; equality of the input string is the check (H(input) follows) — part-2 rule.
- The rest (#2, #4–#11, #15–#48, #50–#60) agree with or extend the lead's own reading; included in the guided round as listed in part1b.sent.md.

## 4. Guided round (§6.4, the one allowed round for part 1)

- Message: scratchpad/impl/s3/part1b.sent.md (WSL copy ~/dsh-work/slices/_books/s3-p1b.md, sha256 5ac77c43489c17e5b3af87a41c52c61861836d5a9a3dbcc186029f8f81b0132c).
- Content: scope (11 test files only, no src change, no file outside scope even temporarily), six lead decisions, per-file items as file:line + spec row/section + direction (no code), checks to run (typecheck, architecture, the 11 new files only), reply format.
- Sent to the same Session session-63415678-640d-4955-9662-5521933a5396 via run-part.sh p1b at 16:23:20. (A first launch failed before starting because Git Bash rewrote the /mnt/c path; relaunched with MSYS_NO_PATHCONV=1.)

## 5. Guided round result (p1b), recorded in the resumed run

DSH run (`S/run-p1b/`, `S/p1b.runner.out`): same Session session-63415678-640d-4955-9662-5521933a5396, 16:23:20–16:48:18
(1498 s), exit 0, `stoppedBy: null`, contamination none. Reply `S/part1b.reply.md` (four sections, complete). DSH spawned
10 subagents. Only the 11 test files changed; no `src/` change. DSH reported (NOTES) that two subagents wrote
verification output to `/tmp` and deleted it; nothing left; correction C12 forbids it in part 2.

The first run's review agent ran the checks without the regression (`S/check-copy-noreg.sh lead-p1b`, outputs
`S/lead-p1b-*`), probed SC01/SC02 in a throw-away copy `~/dsh-work/probe-s3` (`S/probe-sc.txt`: both scenarios stop at
"the Run selects tool names this Runtime does not know: look_graph, find_graph"), and prepared `S/frozen-tests.sha256`,
`S/corrections.txt` and `S/part2.sent.md`, but was stopped (16:53) before recording this section.

## 6. Re-verification after the restart (resumed run, 2026-10-08 20:33–20:42)

Full lead check again, regression included: `S/check-copy.sh lead-p1r` (DSH sandbox, tests under
`flock ~/dsh-work/slices-tests.lock`), 20:37:05–20:38:43, outputs `S/lead-p1r-*`, summaries `S/lead-p1r-new-vsum.md`,
`S/lead-p1r-reg-vsum.md`.

| check | result |
| --- | --- |
| copy | `~/dsh-work/slices/s3` HEAD = slice-base 96f3208, no new commit or tag; status 14 ` M` + 21 `??` + `?? .dsh-scratch/` (`S/lead-p1r-status-final.txt` = `S/lead-p1-status-final.txt`); name-status 35 paths, identical to part 1 |
| typecheck / check:architecture | 0 / 0 |
| 11 new files | `Test Files 10 failed / 1 passed (11)`, `Tests 141 failed / 27 passed (168)` = DSH's p1b numbers, per file identical to its reply |
| RED reasons | 126 runs `not implemented: …` (stub throws); 15 runs expected-value assertions; 0 TypeError / ReferenceError / import / SQLite / timeout / setup errors (grep over the verbose output). The 15: AT02/03/05/06 (observer gives no details yet, `graphChanges` unwired), AT04/AT11 (the test's fail-fast guard on a legacy plan read; scanner not yet on `readAttentionGraph`, C8), CA15 (preparation ignores `_contextAssembler`, `execution-preparation.ts:288`, C7), AD08 ×2 (the G-CTX revision guard of CTX-01 is part 2, spec §3.2 / §5.6 AD08), GT05/GT10/GT11/GT12 and SC01/SC02 (look/find not registered or granted; SC01/SC02 confirmed by the probe, C9). All are part-2 behaviour |
| passing runs (27) | AD01–AD07 ×2, RP03/RP04 ×2, AT01, CA03, CA04, RT01–RT06. RP03 passes through the accepted early enum check (decision 2); the rest test existing behaviour, the accepted part-1 route wiring or a part-1 data table |
| src unchanged since part 1 | the `src/` hunks of `S/lead-p1r.patch` equal those of `S/part1.patch` / `S/lead-p1.patch` byte for byte. So `src/` is still stubs plus the early work accepted in decisions 1–2 (role.ts enum, host.ts grant + configurationRevision, role-profiles lookup, routes.ts two labels) |
| regression (50 files) | `20 failed / 30 passed`, `64 failed / 1027 passed / 29 skipped (1120)`; per file and per failing name (sorted, round UUIDs masked) identical to part 1, and identical to the baseline except `production-reach.test.ts` 3/1, whose one failure lists the same 25 unreached new declarations (allowed in part 1; no stale allowlist entry) |
| frozen shas | `S/lead-p1r-sha.txt` minus platform-duty = `S/frozen-tests.sha256` (11 lines) = `S/lead-p1b-sha.txt`; `src/contracts/platform-duty.ts` 6adfb57e…9e39 = README |

Guided items, checked against the corrected files by grep and reading: ST04/ST05 (otherwise valid layouts, only the
named rule broken), ST08 (callKind `continuation`, only the trailing line broken), ST14 (no `task_phase`; real
`transitionRun` RUN-02), IN01/IN09 separate fixtures, IN05 (owner load answers a different Run; the real applicability
guard decides), IN11/IN12 (finalized PASS / PASS→FAIL Round chain), IN14 (replied Message + `decisionApplications`),
IN19 (canonical Query via the real owner), GR07 (`uppercaseB` fixture), GR10 (no early `return` on a null cursor),
GR17 (decodes a real outer cursor's `scopeKey`), GR18 (counts `findSessions`/`readSession`), AD02 (tautology removed),
AT04/AT11 (legacy reads throw), RP06 (two skills), RT06 (real `createPlatformCoreRouteBindings`), GT14 (whole JSON
≥ 80 KiB), SC02 (16384-byte notification, consumed once, second scan 0). All addressed.

DSH's UNSPECIFIED list (22 items in `S/part1b.reply.md`) are partial fixes with a named reason (no exported seam, no
public owner that seeds a completed RunSnapshot, the Host has no requestId / watermark seam, the reader has no Kernel
dependency). Lead verdict: each reason holds for the code at slice-base and none makes a row pass for a wrong reason
(the affected rows are RED now and turn green only with part-2 behaviour); accepted, no second round (§6.4 allows one).
The part-2 review must watch: C4 (IN14), C7 (CA15), C8 (the in-test copy of the Host attention glue: lead compares
host.ts with it), C9 (registration); also IN16 has no claim for runB (if part 2 needs one, DSH reports it under rule
15), and GT06 is not driven through the driver's proxy.

## 7. Freeze and part-2 message

- Frozen tests: `S/frozen-tests.sha256` (11 lines, verified equal to the files now in the copy).
- `S/part2.sent.md` = `docs/refactor/design/orchestration-2026-10/slices/slice-3-book-part2.md` (byte-equal to
  `S/part2.template.md`) with exactly its two placeholders filled: the sha block (= `S/frozen-tests.sha256`) and the
  corrections block (= `S/corrections.txt`, C1–C12). No `【` left, LF only. Code locations used there, verified in the
  copy: `execution-driver.ts:377` (coordination tools seam), `host.ts:1075-1101` (attention delivery loop),
  `execution-preparation.ts:288` / `query-preparation.ts:259` (`_contextAssembler` ignored), `create-platform.ts:586`
  (`trackedCall`), `create-platform.ts:531-577` (raw owners passed).
- One edit in this run: C1 now also says that "42 lines" (FILES CHANGED) and "21 modified" read 43 / 22, because the
  book's final checks and report sections say "42 files (21 new, 21 modified)" and "42 lines". Same edit in
  `S/corrections.txt`. New sha256 of `S/part2.sent.md`: eeb1d7b442b3924c63fd316ec27fefeb2973b1e5ca6fbdf9f7b54c5d2a2084ec.
- Part 2 NOT sent (not copied to `~/dsh-work/slices/_books/`).
- Cleaned: the review agent's throw-away probe copy `~/dsh-work/probe-s3` removed (its `node_modules` was a symlink;
  the copy's `node_modules` checked intact afterwards).

## 8. Measurements (decision 43)

| who | wall | tokens | tool calls / steps |
| --- | --- | --- | --- |
| DSH part 1 (p1), main Session | 1386 s (23.1 min) | 21,594,773 | 177 calls, 109 steps |
| DSH part 1 (p1), 6 subagents | inside | 74,254,736 | 582 calls, 501 steps |
| DSH guided round (p1b), main Session (run.json) | 1498 s (25.0 min) | 6,168,656 (in 31,281 / cache 6,115,712 / out 21,663) | 26 calls, 18 steps |
| DSH guided round (p1b), 10 subagents (`S/p1b-cumulative-usage.jsonl` minus `S/p1-usage.jsonl`) | inside | 118,983,659 | 931 calls, 784 steps |
| DSH p1b total | 25.0 min | 125,152,315 | 957 calls, 802 steps; no cap hit (the runner counted only 6.2M) |
| DSH part 1 + guided round | 48.1 min | 221,001,824 (in 2,293,694 / cache 217,372,672 / out 1,335,458) | 1716 calls, 1412 steps |
| Codex review (high) | 9.3 min | in 2,791,872 (cache 2,680,192) / out 14,870 (reasoning 3,835) | ≈27 commands |
| lead, first run part-1 stage | ≈44 min | not recorded | ≈83 calls |
| lead, first run review stage (16:08–16:53, stopped) | ≈45 min incl. DSH wait 25 min | not recorded | ≈72 calls (transcript) |
| lead, this resumed stage | ≈9 min (20:33–20:42) | not recorded | ≈28 calls; waiting: lead check 1.6 min |
