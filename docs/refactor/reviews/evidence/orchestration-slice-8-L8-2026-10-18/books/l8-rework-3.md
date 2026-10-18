# Task: slice 8 L8, rework 3 — the open rows of the frozen table (decision 80); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books, the test rule sheet and the lead's rulings are binding; do not make design decisions; report anything
undetermined under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`). **The test rule sheet `./.dsh-ref/test-rule-sheet.md` (v3; for L8 it says the
same as v2) binds every brief; put it, or a pointer to it, into every brief that writes tests.** Files disjoint between
subagents, every vitest command `--maxWorkers=2`, the close-out runs one vitest command at a time. **Do not end your
turn while a subagent has not reported back.** **Finish within 150 minutes** (the run stops at 160). Finish whole rows;
an unfinished row is reported, not half-done. Delete `./.dsh-scratch/` (the directory too, including
`s2b-r2-kernel-host-public`, which a test writes there) before you end.

## 1. What this copy is, and what this book is

Tag `s8l8-r2` (HEAD) = L8 rework 2 (book `./.dsh-ref/l8-rework-2.md`, your reply `./.dsh-ref/l8-rework2-final.md`).
The frozen finding table of rework 2 and its rulings 1–9 still bind.

Codex verified rework 2 line by line: `./.dsh-ref/l8-verify2.out.md` (Chinese; `V§n` below). Its count: of 90 ids,
61 fixed, 27 partly, 2 not; 11 ledger lines are weakenings; 13 new rule-sheet instances on this round's lines; four
production defects (`B-1`, `B-2`, `B-3`, `C-1`, V§4). Your reply said "A–G done, BLOCKED none"; the code does not
support that for the rows below. Codex then checked the first draft of this book: `./.dsh-ref/l8-book5.out.md`
(Chinese); its call chains, the per-call read trace (§4: 12 and 21 hold) and the await tables (§6) are the reference
for §2, whose wording here is final.

**This book is the rest of the frozen table.** Do every row of §3, as V§1–§4 describe it, unless §2 overrides it.
Nothing else is must-fix. Anything else you find goes under FOUND, not fixed, unless it blocks a row.

## 2. Lead rulings (binding)

1. **Your UNSPECIFIED.** (1) Accepted: the failure category and the real cause are fixed; the wording is not a
   contract. (3) Accepted: the post-close read through a real `createTargetPlatform` and the public `observationState`
   on the same SQLite file. (4) Accepted: `materials` stays optional for an explicit assembler, with the explicit
   throw. (2) **Not accepted:** see row D.
2. **Commits and cancellation, one order of precedence** (rework-2 ruling 5; `B-1`, `B-2`, `B-3`; replaces any other
   reading). For `capture`, `requestAutoCapture` and `failAutoCapture`:
   - The signal is checked before the commit starts.
   - Before this call holds a `committed` receipt: an await that resolves, or throws or rejects, while the caller's
     signal is set returns `cancelled` (this includes the early lookup and restore, and the reads before the commit);
     with the signal not set, today's results and throws stay.
   - The commit returns anything but `committed`: if the signal is set by then, return `cancelled`, with no conflict
     retry (this says nothing about whether the store wrote); otherwise today's mapping and bounded retry stay.
   - The commit returns `committed` (not replayed): that result stands, whatever the signal does later.
   - The commit returns `committed` with `replayed: true` and the event restore that follows succeeds: that result
     stands too. If that restore returns a failure, keep the failure; if it throws, keep the throw; never build a
     `committed`, never roll back, never turn it into `cancelled`.
   - There is no lost-reply recovery after a commit throws; do not add one.
   - The cleanup keeps not overriding the main result.
3. **Reads.** `readAutoCapture` and `observationState`: an await that resolves, or throws or rejects, while the
   caller's signal is set returns `cancelled`; the signal is checked again before returning ready.
4. **Cancellation through the preparation** (`C-1` and R2-4 as a whole). From the reminder read to the prepared
   material put, the original signal being set, or a dependency that has a cancelled result answering
   `{ status: 'rejected', code: 'cancelled' }`, ends the preparation as cancelled: the upstream missing-input facts
   (`context-assembler.ts:1084–1098`), the input page, the continuation basis and Turn window, the workspace
   `resolveRoot` (`:799`), the session-basis window (`:850`), and the assembler and put boundaries (V§4 and
   `./.dsh-ref/l8-book5.out.md` §6 list the awaits). Cancellation passes through the shared helpers; it never turns
   into unavailable facts or `null`. A port whose result type has no cancelled result (`StoreError`, `captureDigest`,
   `readTurnBounds`) is judged by the signal only: never add or fake a result type. Non-cancel behavior stays. When a
   shared helper changes, check its other reader (the archive changed-file facts through
   `execution-preparation.ts:55–56,132`, and `session-anomaly-facts.ts:123`). Cancelled before the put: 0 puts;
   cancelled during the put: no ready, the written body is not rolled back.
5. **Replays that no public step reaches.** The driver's retry writes a new request with a new request id,
   `requestSeq` and revision every time (construction book ruling 4–5, `l8-impl.md:74–82`); it never re-sends an old
   command. So the early and late replay branches of `requestAutoCapture` and `failAutoCapture`, and the automatic
   capture's replay, are reachable only by a test that builds the owner's command (`l8-book5.out.md` §3). Rule sheet
   F1/F3 and AGENTS rule 4 (no tests for states only tampering makes): **delete** the rows that build those commands
   (`Obs:384–390` helper, `:415–417`, `:441–442`, `:615–617`, `:883–889`, `:900`, `:971–974`), list each deleted
   assertion in the D1 reply under this ruling, and do not change the driver's identity rules. The branches stay in
   production as ruling 2 shapes them; the lead puts them on the T list (code nothing reaches). The manual
   `architecture/capture` replay through the public route with the same public request stays and covers `capture`'s
   own replay contract (`Obs:1034–1057`).
6. **Read counts** (rework-2 ruling 9): count read **calls**, not keys: each record-store read call is 1, each body
   read call is 1, inside the one public `runtime.prepareExecution`, with the window set by the real reminder wrapper.
   Keep 12 (5 + 7) and 21 (6 + 15). If the corrected counter measures something else, stop that row and report the
   calls you saw; do not change the literals.
7. **H4's reader.** `platform.materials.openArtifact` with the Host context and `usage: 'historical_explanation'`, as
   B§9 says. If the Host branch refuses, stop and report BLOCKED with the refusal; never switch to a Run identity.

## 3. The rows (do every row)

| Row | Ids (V§n) | Disposition |
| --- | --- | --- |
| A Production | `B-1`, `B-2`, `B-3`, `C-1` (V§4); `P05`–`P09` | §2 rulings 2–4. Rows on memory and SQLite, through public steps (a real trigger, `runtime.prepareExecution`) and public reads, with A2 wrappers around the real dependencies: a dependency that throws while the signal is set (one row per owner method the driver reaches); a commit that does not commit after the signal is set; a commit that commits keeps its result although the signal is set right after; for the preparation, one row per await of ruling 4 where a public step reaches it (signal set, and explicit `cancelled` with the signal not set), 0 material puts. Replay rows: ruling 5. |
| B Triggers through the real callback | `K4-03`–`K4-09`, and the same hand calls at `Obs:606`, `Obs:847` | B§7: the notification comes from the real commit callback of the adoption or revision (as `K4-01`, `K4-02` do), never a hand call of `driver.projectChanged`. |
| C Read counts and the observation facts | `K4-17`–`K4-23`; ledger `Obs:600`, `:602`, `:603`, `:623`, `:625`, `:626`, `:627` (old lines) | §2 ruling 6 (each read call counts 1, counted when called, whatever it returns). Restore the seven lost checks with the same subjects and literals (facts ready, `previous` null then not null, 12, 13 and 12 nodes) through public reads in the same scenario, outside the counted window. |
| D T18, T19 and the lost backend | `T18`, `T19`; ledger `Gate:309`, `Gate:331` (old lines) | Keep the SQLite A-running/B-queued Host-restart row (rework-2 row E) as it is. Add a separate scenario on memory and SQLite: the first Host registers B and B really **enters** `captureObservation` (the old `bEnteredBeforeRetry > 0`); close; the second Host binds only A; wait for its start-up work's completion boundary; a public read shows B's request unchanged and B's entry count not raised. On memory, the A4 factory wrapper gives both platforms the same real record backend (and body store if needed); the Host's logical close runs as usual, and the world closes the physical backend at the end; never hand back a backend that was physically closed. |
| E H4's reader | `K4-24`, `T15`, `T28` | §2 ruling 7. |
| F Barriers instead of sleeps | `K5-01`, `K5-02`; `T20`, `T22`; V§3 instances 4, 5 | The Host-close helper waits on an entered Promise from the A3 gate and on the original signal's `abort` event (the listener attached before the close, or `signal.aborted` checked first), never a timed poll. `T20`, `T22`: a notification count or a completion barrier before the read (rule sheet F9). |
| G maxActive over the whole capture | `T24`; V§3 instance 7 | The A3 count spans the whole real `workspace.captureObservation` (enter to return), and the row checks the high-water mark `maxActive = 1` only after B has entered its capture. |
| H Rows that build internal commands | V§3 instances 1, 2, 3 and the same shape at `Obs:415–417`, `:441–442`, `:615–617` | §2 ruling 5: delete them; keep the manual-capture replay. |
| I Refusals grouped | V§3 instances 8, 9 (`S8A-L8-http-watermark.test.ts:25–26,37–50`, `S8A-L8-chunk-scope.test.ts:498`) | Into `describe('rejects: …')`, one error per row, and a public read after the refusal showing nothing changed. |
| J The explicit-cancel rows | ledger `Pub:504`, `Pub:505` (old lines) | Restore the row where the reminder reader answers `cancelled` with the signal not set (an A2 wrapper around the real reader): `rejected`/`cancelled`, `input = null`, 0 prepared-material puts. Today's `context-assembler.ts:1056` already handles this branch, so the restored row may be green at once (it is a restored check, not a RED row; say so); it is a different branch from row A's upstream `C-1`. |
| K A Codex miss (logged, not a new round) | `S8A-L8-host-restart.test.ts:55`, `:116` (your FOUND) | Rule sheet F9: replace the timed loops proving a non-event with a counted call or a completion barrier. |

## 4. How

- Test first, one row at a time: show it RED, then GREEN. The PASS rows: run once and quote the bubblewrap error; the
  lead runs them with bubblewrap.
- Production reach: a new helper is reached from production or deleted; never add to the allowlist.
- Detectors in the close-out, both: `python3 -I .dsh-ref/d1-ledger.py . slice-base WORKTREE` and
  `python3 -I .dsh-ref/d1-ledger.py . s8l8-r2 WORKTREE`. Every D1 line must belong to a row of §3 (or of rework 2's
  table) that asks for it; list each line of the round ledger with its id. A line no row asks for is a weakening: undo
  it or report BLOCKED. D3 must show 0 hits.
- **BLOCKED:** if a row cannot be done as written, stop that row, report the exact refusal (file:line, message) and the
  smallest options. Never weaken a test, change a literal or pick another disposition to get past it.

## 5. Checks and reply

Checks: the changed and new test files (exact lists, one vitest command at a time, `--maxWorkers=2`), then typecheck,
check:architecture and build. No real model calls, no git writes, never ports 3080/3099/44797.

Reply under 900 words:
- per row A–K: the ids done (RED → GREEN) and the ids BLOCKED with the refusal;
- the read calls you counted, by reader;
- the production lines added and removed this round;
- the round D1 output with an id per line, the cumulative D1 line count, and D3;
- the checks, with numbers;
- FOUND and UNSPECIFIED.
