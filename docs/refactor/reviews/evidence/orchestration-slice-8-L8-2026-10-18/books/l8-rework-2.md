# Task: slice 8 L8, rework 2 — the frozen finding table (decision 80); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books, the test rule sheet and the lead's rulings are binding; do not make design decisions; report anything
undetermined under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`). **The test rule sheet `./.dsh-ref/test-rule-sheet.md` (v2) binds every brief and
replaces the judgment calls in coordinator-mode.md wherever they differ; put it, or a pointer to it, into every brief
that writes tests.** Files disjoint between subagents, every vitest command `--maxWorkers=2`, the close-out runs one
vitest command at a time. **Do not end your turn while a subagent has not reported back.** **Finish within 150
minutes** (the run stops at 160). Finish whole rows; an unfinished row is reported, not half-done. Delete
`./.dsh-scratch/` (the directory too, including `s2b-r2-kernel-host-public`, which a test writes there) before you end.

## 1. What this copy is, and what this book is

Tag `s8l8-r1` (HEAD) = L8 rework 1 (book `./.dsh-ref/l8-rework-1.md`, reply `./.dsh-ref/l8-rework1-final.md`, diff
`./.dsh-ref/s8l8-r1.diff`). The construction book `./.dsh-ref/l8-impl.md` (rulings 1–12) still binds. The lead's
bubblewrap check of rework 1 was green (419 files, 3,904 passed, 5 skipped; the PASS rows pass).

Codex then audited the whole L8 change without a length limit, and checked the first draft of this book:
- `./.dsh-ref/l8-audit.out.md` (Chinese): every file read; findings with ids `K1-01`…, `K4-24`, `K5-01`, `T01`…`T71`,
  `P01`…`P16`, `S01`…`S12`, each with one disposition; the paths H1–H7 in its §2.
- `./.dsh-ref/l8-book3.out.md` (Chinese): the call chains, the await tables, the per-instance test table (§7), the
  capacity hand computation (§4), the Host gate (§8), the reachability table (§9) and the proposed wording R2-1…R2-8.
  Below, `B§n` and `B R2-n` point into this file.

**This book is the frozen finding table.** Do every row of §3, in the way the cited text says, unless §2 overrides it.
Nothing else is must-fix in this round. If you find something outside the table, list it under FOUND in the reply and
do not fix it, unless it blocks a row (then say so).

## 2. Lead rulings (binding; they override the cited texts where they differ)

1. **Scope** (rule sheet v2, "Scope"). In `WP2-wiring.test.ts`, `WP2-wiring-scenario.test.ts` and their helpers
   (`task-claim-fixture.ts`, `WP2-platform-support.ts`, `tests/scenarios/harness.ts`), only the lines L8 changed are in
   scope. The audit's `K4-25`–`K4-53`, `T33`–`T69` and Q6 are older debt: T list, do not change them.
2. **Accepted under rule sheet v2:** `T01`, `T02` (a Plan draft through `plans.proposePlan`, which the public route
   `plans/propose` exposes: A1); `T03`–`T14` (workspace root, revision, authorization and runtime configuration are
   Host inputs: A8). Keep them as they are. The paths H1, H6 and H7 are therefore not needed.
3. **Background failures that cannot be recorded, and a partly failed binding** (Q1): no new diagnostics interface.
   `P01`–`P04`, `P10`, `S09`–`S11` stay as known limits this round. An existing pending request is retried by a later
   successful start-up scan or a real trigger; when there is no pending request, nothing recovers it at start-up, and
   the workspace waits for its next real trigger. Do not change them; the lead records this exception in the spec's
   failure and retry rules.
4. **The failure write belongs to the running round** (Q2, `S12`): the driver passes the round's own signal to
   `failAutoCapture`; a Host close cancels it; `failAutoCapture` checks the signal before its commit starts.
5. **Commits and cancellation** (Q3): the signal is checked before a commit starts. A commit that this call started and
   that completed keeps its committed result; a later cancellation does not rewrite it, and nothing is rolled back. An
   early replay that only looks up and restores an earlier commit still checks this call's signal after each await and
   returns cancelled when it is set; the earlier commit is not affected.
6. **Q4** is answered by A8. **Q5:** the fixed reminder text is enough; add no provenance pins.
7. **`P12`:** fix the driver's own key (`auto-capture-driver.ts:65`) with an unambiguous tuple encoding (the canonical
   JSON of `[projectId, workspaceId]`). `host.ts:183` is older code: T list.
8. **The chunk format:** B R2-1 and B R2-2 verbatim, with B§2's three points (the empty chunk counts toward the limit;
   the envelope is built from the escaped scope values and a fixed structure, never by searching the JSON for array
   positions; same-scope chunks are still reused across captures, and the reference the store returns is kept).
   `schemaVersion` stays 2; only the new shape is read (decision 79).
9. **Read counts** (B§7 end): in one public `runtime.prepareExecution`, the architecture-reminder dependencies read 12
   times without a previous observation (5 record + 7 body) and 21 times with one (6 record + 15 body), at 6 and 7
   chunks (B§4). The other preparation dependencies and the material read afterwards are not counted. If you measure
   another number, stop that row and report it with the reads you saw; do not change the literal.

## 3. The finding table (do every row)

| Row | Ids | Disposition |
| --- | --- | --- |
| A Chunk scope | `K1-01`–`K1-10` | §2 ruling 8. Update every test B§4 lists, with the caps 297 and 294 (A12) and 6 and 7 chunks (L8 500-byte case). Regressions through public steps on memory and SQLite (B§9 rows 1–4): two workspaces of one project with identical content, each captures, each is triggered again by a real adoption or revision, each `prepare` shows its rows; the same `workspaceId` in two projects; a chunk reused by a later capture of the same workspace; an empty graph. Old unscoped chunks, a body scope that differs from the record, and non-ASCII or escaped ids: pure codec rows, one error each. |
| B Capture start and owner cancellation | `K2-01`–`K2-03`, `P05`–`P09`, `S12` | B R2-3, §2 rulings 4 and 5. One invariant for every L8 owner method (`requestAutoCapture`, `failAutoCapture`, `readAutoCapture`, `observationState`, the capture's early replay): check the caller's signal after each await, before a commit starts, and before returning ready or replayed. Rows (B§9): the start observation read returns a failure; it throws; it is cancelled while it returns a failure, throws or returns ready; an old failure does not overwrite a newer request. |
| C Reminder and preparation cancellation | `K3-01`–`K3-11` | B R2-4. Rows: cancelled while the reminder read throws; cancelled while it returns ready; a non-cancel failure still gives one `架构提醒不可用` and the preparation succeeds; no material is written after a cancellation that came before the write. |
| D Tests through public steps | `K4-01`–`K4-24` | Per instance as in B§7 (where B§7 and the audit differ, B§7 wins). Delete the duplicated service row at `S8A-L8-capture-mappings.test.ts:281` (`K4-12`, `K4-13`). Use the audit's paths H2–H5. H4 is one shared helper: `platform.runtime.prepareExecution`, then `platform.materials.openArtifact` with `usage: 'historical_explanation'` (B§9, last paragraph); the reminder tests use it instead of their own body store. After real adoptions, replays use the same mappings as the original command (B§7, end). |
| E Real Host close and restart | `K5-01`, `K5-02` | B R2-6 and B§8: an A3 gate around the real `workspace.captureObservation` of the real `createObservedArchitecture`, never a `lightScan` fault; a real `host.close()` with A running and B queued, then a new Host on the same SQLite database retrying both. SQLite only (a Host restart); name the rows so. Keep the driver gate rows on both backends. |
| F Other test rows | `T15`–`T32`, `T70`, `T71` | As the audit says. `T15` and `T28` through H4. `T16`–`T23`: a gate, a completion barrier or a counted call (rule sheet F9). `T24`: A held in the gate, B accepted, record and assert `maxActive = 1`. `T25`–`T27`, `T30`–`T32`: the pure reminder rows go into `S8A-L8-reminders-pure.test.ts`, one input per rule, hand-computed literals. `T29`: the new row. |
| G Production | `P11`, `P12`, `P13`, `P14`, `P15`, `P16`, `S01`–`S08` | As the audit says, with §2 ruling 7 for `P12`. `P11`: the Host close stops and aborts the auto-capture first, then drains as before. `P16`: the public HTTP input and its runtime parse reject `requestSeq`; only the driver passes a start watermark, through a non-public path. |

## 4. How

- Test first, one row at a time: show it RED, then GREEN.
- The PASS rows (`S8A-L8-pass-capture.test.ts`) and any other row that needs bubblewrap: run once and confirm that it
  fails only for the missing bubblewrap (quote the error); the lead runs them with bubblewrap. Do not skip them.
- Production reach: a new helper is reached from production or deleted; never add to the allowlist.
- Detectors in the close-out: `python3 -I .dsh-ref/d1-ledger.py . slice-base WORKTREE`. Every D1 line must belong to
  a row of §3 that asks for it; list each line with its id in the reply. A line that no row asks for is a weakening:
  undo it, or report BLOCKED.
- **BLOCKED:** if a row cannot be done as written (a public path refuses, a cited line is not what the table says),
  stop that row, report the exact refusal (file:line, message) and the smallest options. Never weaken a test, change a
  literal or pick another disposition to get past it.

## 5. Checks and reply

Checks: the changed and new test files (exact lists, one vitest command at a time, `--maxWorkers=2`), then typecheck,
check:architecture and build. No real model calls, no git writes, never ports 3080/3099/44797.

Reply under 900 words:
- per row A–G: the ids done (RED → GREEN), and the ids BLOCKED with the refusal;
- the chunk format as built, the empty envelope's bytes for one example, and the limits;
- the read counts you measured;
- the production lines added and removed this round;
- the D1 output with an id per line, and the D3 result;
- the checks, with numbers;
- FOUND (outside the table) and UNSPECIFIED.
