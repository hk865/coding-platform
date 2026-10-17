# 20k-note measurement: reads vs spec-4 §11.7 budget (Claude subagent ab8dd12b, 2026-10-17, report verbatim in substance)

Code: `~/dsh-work/measure-4c2/repo` (merge tree 05121e2 = lead 247fcd57 + 4C-2 session B). Dataset: copy of
measure-s4f full-r1. Probe: `~/dsh-work/measure-4c2/probe/measure-probe.mjs` (loader-hook only, async-stack per store
call, named-function timers, find-header toggle, two fix emulations, CPU profile); stats scripts `dataset-stats.mjs`,
`target-stats.mjs`; outputs `probe/probe-*.out.json`. Ledger stayed at 66409 events. Probe reproduced the counts
(2,254, 209, 222, 358, 1,226). Load average 7–8; times warm p50. Load inflates little (lookup rows match speed-1:
busiest anchor 22.9 ms then, 22.5–27 now).

Dataset buckets: pending buckets 97 non-empty, max 8 → G+1 = 102 scans; accepted/reviewed buckets ≤ 55 each; the
`project` anchor has 456 heads, all slot 0 → a scan costs 3 calls, slots 1–4 one call each; the 293 pending notes
have 244 relation targets (all `replaces`, none `contradicts`) on 227 anchor keys in 85 goals; 45 targets
task-anchored.

## Heartbeat (readScribeTodos, 101 goals)

Measured 2,254 calls, 853–1,074 ms. Budget: per goal 2 (plan window) + 3 (§11.5) = 505, + pointer 1, head 1, pending
buckets 102, target batch 1 = **610**; exactly those 610 are measured inside the budget.

Excess **1,644 calls (≈1 s)**, all from `pendingTodosBatch` → `deps.check.checkHeads` over the 244 targets
(`note-scribe-todos.ts:128-129`, **session A**): `conflictingOf` anchor sets 1,138 (227 keys × 5 + 3); `overQuotaOf`
status buckets 340 (85 goals × 4); `classFiveHints` → `agentRunTaskScope` Run 74 + PlanRevision 74; catalog +2 over the
budget's 1; not store calls but slow: 287 workspace file observations (419 ms). These are 9,569 of the call's 11,083
decoded records.

No rule needs these reads: `userReasonsOf` (§11.6) needs only state, the user flags and the primary anchor's non-file
retirement; the code reads only `anchorStatus`/`anchorRetiredReasons`.

Fix: call session B's `userReasonFacts` (`note-service.ts:917`, already wired for the card source at
`create-platform.ts:1393-1396`), passing the plan windows the shared reader already read; drop the `check` dependency
and its seeding (~25 lines). Also makes the to-dos use the same retirement function as the card gate and the guard:
today the to-dos treat any reason except `file_deleted` as non-file, while B treats every file-anchor reason as file —
they could diverge (inferred, not seen in this data). Emulated: **762 calls, 156–184 ms, identical result digest.**

Remaining (B code): `primaryAnchorRetiredNonFile` (`note-service.ts:1079`) → `resolveNoteAnchors` →
`readAnchorGoalFacts` (`note-anchor-facts.ts:63,67`) reads Goal, Goal, PlanRevision **per task-anchored target**
(+135), ignoring the seeded `call.planWindows`. Fix: a `goalFacts` hook on `NoteAnchorFactsDeps` fed by
`planWindowOf(call)`, the same pattern as `catalogModuleFacts` (~15 lines). Expected ≈ 627 calls (inferred; an
anchor-only emulation measured 627) = budget + 15 stage plan-revision lookups (within "2–3") + 1 catalog. The same
per-target re-read is in B's card source (3 calls for one target).

## Goal card, memory material (bracket = readMemoryMaterial)

Measured **43 of 1,226 calls, 35–64 ms of 150–200 ms**; the other 1,183 are the decision queue's goal-conflict
footprint over 101 goals (pre-4C); B adds 8 there via `readNoteDecisions`.

Budget: pointer 1 + head 1 + project scan 3 + plan window 2 (+1 lookupOrdered) + related set (Run index 1, RunActivity
1, two anchor sets 10, stage prefix 5) + update-due 3 = **28**; C(10) needed no further store reads.

Excess 15: +7 the check's `conflictingOf` re-reads the project set (`readMemoryMaterial`, `note-read-model.ts:1966`,
**A**, does not put the set `selectProjectHeader` read into `anchorSets`); +4 `selectProjectHeader` (`:1338`,
**4C-1**) reads all 5 slots against the literal "一次扫描"; +4 4B `overQuota` buckets for g000 (unchanged 4B reads per
§12.7). The project anchor is 912 of the material's 1,212 decoded records.

Fix: `selectProjectHeader` takes the `anchorSets` map, uses the entry if present, else reads and stores it (~6 lines).
Emulated **43 → 36 calls, material 64 → 35 ms, identical output.** Budget wording: once shared, 7 calls is the minimum
(the conflict derivation needs all five slots of `project`); the line should read "a project anchor set shared with
the check".

## Find first page

These are 4C-1 and 4B code; neither 4C-2 session touches `note-read-model.ts` or `note-views.ts` (project part = 4C-1,
36602e53).

Host unsegmented: measured 209, budget **22** (ledger 1 + text 4 + pointer 1 + project scan 3 + C(30); C(30) = plan
windows 10 (4 goals) + catalog 1 + 2 head reads). Excess 187: 154 from 4B derivations inside the check (anchor sets for
21 keys + 10 more, 44 status buckets = 11 goals × 4) — C(k) leaves these out and §12.7 calls them unchanged reads; they
now run on every item because §11.3 makes every page item accepted or reviewed; 20 from post-write hints run on reads
(`note-views.ts:820, :1192`, 4B); catalog +2 (4B); project anchor 11 (4C-1: +4 slots, +7 re-read by the check).

Executor segmented: measured 222; the related set already contains `project` (read by `readHeadsForKeys`) and
`selectProjectHeader` reads it again: +7; same fix (expected −7 calls, ~15 ms; inferred).

Time (host unsegmented, 143–158 ms): checking 30 items ≈ 150 ms (derivation reads ≈ 90 ms, project re-read ≈ 20; file
observations ≈ 50 ms; anchor status/hints ≈ 20 ms); `selectProjectHeader` ≈ 21 ms; search ≈ 20 ms. The project part
costs 27–44 ms (A/B: 109–131 ms without the header); the seed fix measured 126 ms. Records decoded per call 2,432 (912
= the project anchor twice, 649 status buckets). CPU profile: SQLite/store 41 %, JS 40 % (mostly JSON parse/validate
of heads), I/O wait 13 %. The jump from 41 ms (speed-1) is code, not load (inferred): the speed-1 page had 14
superseded items of 20; now 30 current items each pay for buckets and files.

Reading the whole project anchor is what §11.4/§11.7 require; its cost here is dataset and design: dataset — the
anchor has 130 current general notes (112 from agents) against the soft quota L7 = 5 (only user writes may exceed it,
so seeded data is the cause); design — the anchor index has no state, so all 317 retired heads are scanned too, and
that history grows even when L7 is respected.

The busiest-module find (240–260 ms, 358 calls) is the size of 4C-1's §11.2 module scope (54 anchor sets + 1,200 rows
from the module path prefix scans). Lookup and stale are within their rulers.
