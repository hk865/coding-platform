# Slice 1 — tests stage, third run (fixture repair by Codex, freeze, new-Session part-2 brief)

2026-10-08 21:55–23:31, lead (Claude). Branch feat/reliability-and-structure at dd21c239 (docs only after HB 48c8d473);
real worktree untouched, nothing committed; the product model was not called; no DSH run in this stage.
`S` below = `scratchpad/impl/s1`.

## 1. Start state

- Copy `~/dsh-work/slices/s1` = part 1 + guided round p1g2 (89 paths, uncommitted, HEAD 578844c2 = slice-base).
  Exported diff vs slice-base (temporary index, incl. untracked, excl. .dsh-scratch) `S/fx/fx0-full.patch`
  = byte-identical to `lead-p1g-full.patch` (sha 9fdc13de…1578): copy unchanged since run 2.
- Defects to repair: review1.md §5–§6 (6 verified + ~16 likely must-fix) and resume/codex2.md (31 findings).

## 2. Codex fixture runs (decision 46: Codex writes fixtures, 4 disjoint groups, parallel)

Clones `D:/cxt/impl-s1-fx1..4` (shared clone of the worktree, detached 48c8d473, core.longpaths, `git apply --binary
fx0-full.patch` → 89 paths). Inputs `D:/cxt/impl-s1-fx-msg/`: RULES.md (common rules), fx1..fx4.md (files, lead
decisions, findings with file:line + row + direction), review-codex2.md, guided-round.md, fail-reasons.txt,
file-to-case-map.txt. Codex 0.162 (`bin/9691020b546a15b2/codex.exe`, newest by mtime), `exec -s workspace-write`,
effort xhigh, `--ephemeral --json`; launcher `S/fx/run-fx.sh`; outputs `S/fx/fx<k>.md`, events `fx<k>-events.jsonl`.

| group | files (cases) | wall | Codex tokens (in / cached / out) |
| --- | --- | --- | --- |
| fx1 | work-graph S1-requeue, S1-archive-owner, S1-wait-disposal (24 SV) + helper S1-archive-service-fixture.ts | 22:00:14–22:38:40 (38.4 min) | 11.22M / 10.83M / 49K |
| fx2 | work-graph S1-provenance, S1-codecs-indexes, S1-session-facts, S1-responsibility, S1-dispatch-guards (33 SV) + helper S1-session-facts-fixture.ts | 22:00:14–22:51:31 (51.3 min) | 12.34M / 11.93M / 62K |
| fx3 | business S1-session-maintenance, S1-archive-flow, app S1-session-routes (18 IT) + helper S1-workflow-archive-fixture.ts | 22:00:14–22:43:44 (43.5 min) | 13.20M / 12.81M / 54K |
| fx4 | runtime S1-archive-files-brief, S1-routed-replies, scenarios S1-archive-restart, S1-wait-copy-retirement (16 IT), invariants.ts (S1-5) + helper S1-runtime-scenario-fixture.ts | 22:00:14–23:06:23 (66.2 min) | 16.74M / 16.30M / 83K |

All four exit 0, no rate limit. Each clone changed only its own files (checked with `S/fx/cmp-fx.sh`, CR-insensitive
compare of src/ tests/ docs/ vs the copy). Applied into the copy with `S/fx/apply-fx.sh` (CRLF → LF, UTF-8 BOM
stripped: Codex wrote BOMs in fx1/fx2 files and CRLF in fx3/fx4 files).

Lead decisions given to Codex (binding, also in the brief): D1 SV50/SV59 no `refusal.automation`, automation values
via `nextRequeueAutoCount` on the stored chain; D2 SV61 `partial`; D3 real control/result paths; D4 legacy givens are
old-format records; D5 inject the real facts / provenance readers; D6 stops are real (terminal observation); D7 unknown
Runs through real reconciliation; D8 IT34 = frozen U1 skip; D9 invariants with previous worlds; K7 IT01; D10 plain
continue after the final returns `receipts: []`, originals by replaying the original GraphWrite; D11 S1-5 per anchor
commit.

Codex UNDETERMINED items and the lead's decision:
- SV22 (fx1): a literal yield on S after the final read cannot happen (S unoccupied, R excludes claims); Codex races a
  legal Session-health write on S. Lead: accepted (the row's point is "a legal write on S between read and commit →
  revision_conflict, current = S"); recorded in the brief §4a.
- SV36/SV48/SV49, SV05/SV11, SV18/SV39/SV41/SV52/SV58, SV19/SV20: reason prefixes not in the spec → not asserted. Lead:
  correct (rule: do not invent).
- SV60 (fx1): automatic delivery needs a runtime port the sessions owner lacks; SV60 goes through Workflow
  `archiveLine` (first stub `SessionArchivePort.archiveLine`). Lead: fine (delivery is Workflow step 3, §4.1).
- SV06 (fx2): the given "newer Query over a yielded Work" is created through the Query owner without the injected
  SessionFactsPort (§0.2 L1 old behaviour for narrow doubles). Lead: accepted, in the brief §4a.
- IT29 (fx4): overlapping candidates injected through a paginated adapter over real persisted records. Lead: accepted.

## 3. Lead fixes after applying (small leftovers, lead work)

| file | fix | why |
| --- | --- | --- |
| tests/helpers/S1-archive-service-fixture.ts:182 | `reads.readContinuationBasis!(` | TS2722 (optional method) |
| tests/helpers/S1-workflow-archive-fixture.ts:1066 | removed the `roleResolution.status === 'inadmissible'` check | TS2367 (type already excludes it) |
| tests/work-graph/S1-provenance.test.ts:284 | narrow `requeued.outcome.kind === 'requeued'` before `.requeue` | TS2339 |
| tests/runtime/S1-routed-replies.test.ts:90 | `deliverControl!(` | TS2722 |
| tests/helpers/S1-archive-service-fixture.ts (growChain) + S1-requeue.test.ts:164 | new `requeueClaimRequest` (requeueRef + pinned budget); `buildRequest()` drops `requeueRef` | SV35/SV50/SV59 failed at setup: "this Task already has a Run and cannot be claimed for the first time" |
| tests/helpers/S1-archive-service-fixture.ts (kernelAccept) | tool-group barrier yields only at `after_group` (as the production driver) | SV54 failed at setup: "Kernel terminal is missing" |
| tests/work-graph/S1-wait-disposal.test.ts (SV54) | removed the asserted reason "the accepted response does not belong…" | not in the spec (rule: do not invent) |
| tests/work-graph/S1-archive-owner.test.ts:89 (SV22) | removed `startsWith('record version changed')` | not in the spec |
| tests/business/S1-archive-flow.test.ts, S1-session-maintenance.test.ts | `describe.each(['sqlite'])` instead of memory+sqlite | Codex doubled the IT runs (82 instead of 66); the book fixes 7 + 9 runs; SQLite keeps the invariant checker active |
| tests/helpers/S1-runtime-scenario-fixture.ts:177 | Host tools `write` instead of `edit` | IT01–05, IT28–32 failed at setup: "the Run selects tool names this Runtime does not know: edit" (builtins are read/write/shell; the Kernel tool `edit` is what the model calls) |
| tests/runtime/S1-archive-files-brief.test.ts (IT04) | old manifest body stored with `sourceRefs: [{kind:'workspace', refId:'w', revision:'1'}]` | setup failed: "put sourceRefs must be a non-empty array" |
| tests/work-graph/S1-session-facts.test.ts (SV10) + helper `observeStore().seed` | 1 real completed execution of S + 2,500 complete copies of its Outbox/Run/Attempt records (fresh ids, raw old-format seed, no per-commit invariant check during the seed) | Codex's all-real construction took 455 s (memory) and timed out at 900 s (SQLite) |
| tests/state/invariants.ts (I-12) | `deriveReworkClass(run, intent, chain, archiveInterruptionOf(requeue, world.anchors))`: the verified interruption from a stored anchor of that afterRun (execution origin) or the wait origin of that afterRun | fx1 RISK: the three-argument re-derivation would report every correct archive requeue (class interrupted) as an I-12 violation |

fx4's S1-5 change (`slice1CommitCounts` from the SQLite idempotency table; S1-5 checked only when exactly one commit
separates the two worlds, or for hand-built worlds) kept as is (D11).

## 4. Checks (DSH sandbox, tests under the slices lock; `check-copy.sh lead-fx2`, 23:24–23:28)

| check | result |
| --- | --- |
| status | 93 paths (89 + 4 new helpers), then `.dsh-scratch/` moved out (to `S/fx/dsh-scratch-part1/`, old Session notes) |
| typecheck / check:architecture | exit 0 / exit 0 |
| new tests | 23 files, **212 runs: 201 failed, 11 passed**; runs per file = book table (diff vs p1g per-file run totals: equal) |
| passes | UT06, UT08, UT33, UT34, UT35, SV03 ×2, SV50 ×2 (old cap behaviour), IT17 (route table, part 1 wiring), IT04 (old manifest bytes: proves the frozen literal equals today's encoding) |
| failure lines (`S/fx/lead-fx2-fail-reasons.txt`) | 178 `Error: not implemented: …`; 23 AssertionError on new behaviour (UT04, UT05, UT07, UT32, SV01 ×2, SV04 ×2, SV05 ×2, SV42 ×2, SV44 ×2, SV39 ×2, SV40 ×2, SV51 ×2, IT18 HTTP 500 from the archiveLine stub); no setup error, compile error or timeout |
| regression | `8 failed / 14 passed (22)`, `30 failed / 511 passed (541)`; per file identical to p1g (only production-reach 3/1, message-machine 90/9, session-availability 121/7 differ from baseline; 13 bwrap failures unchanged) |
| patch | `S/lead-fx2.patch`, `S/lead-fx2-full.patch` (sha256 de472f97…8ed9), 93 paths |
| runtime of the 23 new files | ≈ 64 s (was > 20 min with the all-real SV10) |

Review: all flagged cases checked for their failure line (stub or new-behaviour assertion only); read in full SV22,
SV35–SV38, SV48, SV50, SV57, SV59, SV61, SV10, SV54, IT01, IT04, IT06–IT09, createLegacySession; grep of every asserted
reason prefix against the §3.2 refusal table and src (two invented prefixes removed, see §3).

## 5. Freeze

`S/frozen-tests.sha256`: 31 files = 23 new test files + 4 changed existing (state-writes, invariants,
session-availability, message-machine) + 4 helpers (S1-archive-service-fixture, S1-session-facts-fixture,
S1-workflow-archive-fixture, S1-runtime-scenario-fixture). LF, no BOM.

## 6. Part-2 brief (decision 46, new Session)

`S/part2-brief.md` (sha256 106db3c0…1111, now ≈ 35 KB / 3.4K words, about 10K tokens; draft `S/part2-brief.draft.md`):
§0 what the copy is; §1 spec map with the copy's line numbers; §2 the 31 frozen sha256; §3 corrections K1–K7 and
D1, D2, D6–D8, D10, D11; §4 rules (spec §8 + book rules 11–16); §4a how the tests build their givens; §5 the 62
source files; §6 the work split: step 0 (main Session freezes the part-1 signatures), wave 1 G0 contracts/codecs +
G1 pure state, wave 2 G2 sessions owners, G3 facts/claim guards/queries, G4 anomaly/requeue, G5 mailbox, wave 3 G6
AgentRuntime + G7 Workflow, wave 4 G8 composition/Host/routes, then a self-check pass by fresh subagents; §7 checks
with expected numbers (typecheck/arch/build 0; 23 files 212 pass; regression 528 / 13 bwrap of 541); §8 final checks
(93 paths, no stub, sha256); §9 reply format. Not sent (Implement stage).

## 7. Measurements (decisions 43, 46)

- DSH: none in this stage.
- Codex: 4 runs in parallel, 22:00:14 → 23:06:23 (wall 66.2 min for all; 38.4 / 51.3 / 43.5 / 66.2 min), purpose:
  fixture rewrite; 53.5M input tokens (52.0M cached), 247K output.
- Lead: ≈ 95 tool calls; wall 21:55–23:31 ≈ 96 min. Waiting, listed separately: Codex ≈ 40 min not overlapped with
  own work (drafting the brief and applying fx1/fx3 overlapped the rest); the all-real SV10 test run 23 min
  (22:54–23:17, overlapped with fixes); the final checks 4 min. So ≈ 45 min waiting, ≈ 50 min reading, fixing,
  deciding and writing.

## 8. Kept / where

- Copy `~/dsh-work/slices/s1` (frozen tests + part-1 src; no .dsh-scratch), Session of part 1 not to be reused.
- Codex clones `D:/cxt/impl-s1-fx1..4`, inputs `D:/cxt/impl-s1-fx-msg/` (the user deletes D:/cxt).
- `S/fx/`: run-fx.sh, apply-fx.sh, cmp-fx.sh, tc.sh, vt.sh, fix1–fix5.py, mkbrief.py, freeze.sh, Codex outputs and
  events, applied-fx<k>/ copies, test outputs fx13a/fx2a/fx4b, scope-src.txt.
