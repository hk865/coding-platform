# Task: slice 4C-2, session A — the assembly (L20, U8), "update due" (§11.5) and the scribe reminders (U10); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, with **at most 3 subagents at once** (files of running subagents
disjoint; every vitest command `--maxWorkers=2`). Subagents write all code and tests; you split, brief, check and
reply. **Finish within 200 minutes** (the run stops at 210, with a handoff if needed). Finish whole items; an unfinished
item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch after 4C-1 merged (`5b445650`); `slice-base` adds `DSH-BASELINE.md`.
- 4C is two rounds (spec §11.9). 4C-1 (merged) built the tools, routes, node-detail column, related-first find, default
  states and the protection rules; its readings are spec **§12** (binding, same weight as §11). 4C-2 is split into two
  sessions: **this session A** = assembly, "update due", scribe reminders; **session B** (later) = the note cards and
  their application, the proof events, the notices (L17, U3, U6, U7, U9). Do not build session B's parts.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`: **§11 and §12 first** (they override
  earlier sections), then L16, L20, §11.4 (Goal card part), §11.5, §11.7 (read bounds), §11.8, §5.2 rows named below.
- Code facts Codex rechecked on the merged branch: `./.dsh-ref/s4c2-facts.md` (Chinese; current file:line for every
  function the spec names, the stale spec line numbers, what to reuse). Use them.
- Reuse rulings (decision 72): `./.dsh-ref/reuse-rulings.md`, items **U8** and **U10** for this session.
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding)

1. **Assembly (L20 as changed by §11.4, U8).**
   - The `notes` context extension splits into `understanding` (project, goal, stage — §11.4: at most 3 rows, in that
     order; the project row carries the whole body; then the project norms, one `renderNoteHeader` line each, with
     "另有 n 条，用‘看’读项目" when some do not fit) and `general` (`NoteIndexRowV1` rows: source order and tiers per
     L20; deduplicated; excluding what the Goal card already has).
   - **U8:** one memory-material function, input `project + optional goal/stage/task`, output `{ projectUnderstanding,
     norms, localUnderstanding, general, reminders }`, one read window per assembly; the caller picks the parts. The
     optional goal is in the type now; the null-goal branch is 6A's (do not build or test it; a null goal returns
     `unsupported` with the reason "6A").
   - Reuse `selectProjectHeader` and `buildFindPage`'s one-check-per-page shape (`note-read-model.ts`, facts §2), and
     `checkHeads` with the per-call caches; do not add a second check path.
   - Conclusion and warning lines: one or the other per item, never split; what does not fit goes into the section's
     omitted count with the existing wording (`state/context-input.ts`).
   - The context record lists only rendered note rows: `ContextSourceV1`'s `note` branch becomes `{ kind: 'note';
     anchorKey; noteId; version; digest }` (L20; no writer exists today — confirm and report).
   - The renderer's key re-sort (`context-assembler.ts` ~173, facts §1) must keep L20's source order.
   - Query assembly gets `understanding` (with the project row and norms, §11.4), never `general`.
   - Bound executions replay without re-assembly (C-03).
   - The reminder section tells a Work agent "当前理解该更新了" for its own goal/stage when `updateDue` is true (L20).
2. **"Update due" (§11.5).**
   - `readGoalTriggerRecords(records, goalRef, plan)` in `tasks/plan-readers.ts` (the three steps; any `unsupported` or
     failure → `unavailable`; do not change `readReworkRecords` or its callers).
   - `foldUpdateDue({ triggers, plan, anchors })` pure, in new `notes/note-update-due.ts`.
   - `note-views.ts` keeps the triggers per goal in the per-call cache next to the current-plan cache; `lookup` takes
     them from the same cache; **delete `understandingOf`'s own pointer read** (`note-read-model.ts` ~1177, its call
     ~1740) — decision 69 item 3.
   - `NoteUpdateDuePort` (§11.5's shape) **declared in `work-graph/model/note-contracts.ts`**, implemented in
     `notes/note-update-due.ts` (notes may import tasks and state, never views), injected by the composition root into
     the assembly and the Host.
   - The project anchor's `updateDue` stays `null` (§11.4).
3. **Scribe reminders (§11.5, L16 as changed, U10)** in `src/app/host.ts`:
   - **U10 shell:** scope facts once → to-dos → recipient resolver → idempotent delivery. The recipient resolver is one
     function (today: the project scribe with the smallest `sessionId`), the one 7D replaces with `resolveResponsibleLine`.
   - The check runs for every configured workspace **whether or not attention or input consumers are configured**
     (today the loop starts only when they are, `host.ts` ~1152 — extend the start condition; do not change attention's
     logic).
   - **Clock:** use the Host's injected `now` (`host.ts` ~150, ISO) for the heartbeat lines §11.5 names (facts §1:
     ~1167, ~1168, ~1204), converted where a number is needed; no new clock.
   - To-dos: pending = `noteId@version` counted only when `userReasonsOf` is empty (includes `quota_full` and the
     overridden pending understanding, excludes cancelled goals); update due = `anchorKey@latestTriggerCursor`.
     **The overridden pending understanding:** one shared pure predicate in `state/note-machine.ts` (e.g.
     `pendingUnderstandingOverridden(pending, currentHead)`: the current understanding of the same anchor was created
     after the pending one). `userReasonsOf` returns `structural` for a structural understanding unconditionally, so the
     reminder count must use this predicate, not "no user reasons" alone; session B's card gate will use the same
     predicate.
   - Thresholds 10 / 5; the immediate send on an `archive:` trigger whose rework no Run has claimed (`Run.requeueRef`).
   - One message per recipient, request id `scribe-reminder:<ws>:<owner>:<sha256(sorted to-do identities)>`, at most 20
     anchor names, at most one unhandled reminder per recipient (same rule as today's reminders); compute and send are
     recorded separately: an unchanged ledger cursor does not recompute, but a failed send is retried on the next
     heartbeat.
4. **Rows (§11.8, §5.2):** C-01, C-02, C-03, C-04, G-01's assembly assertion ("下一次准备能看到索引行"), PU-03,
   M-12a–M-12h, D-03, D-10 (the counts), D-15's reminder part (the overridden understanding counted as the scribe's
   to-do, not a card), D-18. NE5 (assembly through the public `createExecutionPreparation.prepare`) and NE6's heartbeat
   part (real Host scenario, injected clock). Memory and SQLite for service-level rows.
5. **Not in session A:** cards, application, proof events, notices (session B); C/C++ and Python providers; anything
   of 6A.

## 3. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id or `S4C2-<n>`. Expected values literal and hand-computed from the rows.
- State transitions only through `src/core/work-graph/state/` (AGENTS rule 9). Production-reach allowlist: remove the
  entries your wiring reaches; add new ones only with the reason "4C-2 wires it".
- **Old tests:** the facts file §4 lists the expected changes: `tests/runtime/S3-context-assembler.test.ts:268, :632`
  (the extension's shape) may change to the new shape; CA14's "extension not injected" (`:802`) and
  `S3-graph-context.test.ts:1067` stay; `S4C-project-understanding.test.ts:91` (project `updateDue: null`) stays; the
  attention tests (`tests/app/orchestration-mechanism.test.ts:51, :83, :331`) stay. Any other assertion that fails: do
  not edit it; report it (test id, assertion, rule, minimal counter-example).
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end.
- **Line budget (decision 69):** about 1,000 new production lines for session A (soft; Codex estimated 1,000–1,400 for
  these parts). Report the count.

## 4. Order (suggested; you decide the briefs, files disjoint, at most 3 at once)

1. Shared first, one subagent: the contracts (`NoteUpdateDuePort`, the `notes` extension's two parts,
   `ContextSourceV1`'s `note` branch, U8's input/output types) and the pure functions (`foldUpdateDue`,
   `pendingUnderstandingOverridden`) with their unit tests.
2. Then in parallel: (A) the trigger read and the update-due wiring in `plan-readers.ts`, `note-update-due.ts`,
   `note-views.ts`, `note-read-model.ts` (M-12a–h); (B) the assembly: U8 and `context-extensions.ts`,
   `context-assembler.ts` (C-01..C-04, PU-03, G-01's assertion); (C) the Host reminder shell in `host.ts` and its
   composition wiring (D-03, D-10, D-15's reminder part, D-18).
3. Close-out (one subagent): the checks below.

## 5. Checks (close-out subagent)

- `--maxWorkers=2`: `tests/runtime/S3-context-assembler.test.ts`, `tests/runtime/S4C-*.test.ts`, `tests/work-graph/S4*.test.ts`,
  `tests/work-graph/SP-*.test.ts`, `tests/work-graph/S3-graph-context.test.ts`, `tests/app/S4C-*.test.ts`,
  `tests/app/orchestration-mechanism.test.ts`, `tests/composition/platform.test.ts`, `tests/composition/WP2-wiring.test.ts`,
  `tests/architecture/`, the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox. Name any other failure. **Do not run the full suite.**

## 6. Reply

Under 900 words: FILES CHANGED (production / tests, production line count); each scope item and row: done or not,
RED → GREEN; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at once); anything
surprising.

## 7. Answers to the read-through (lead, 2026-10-17 03:35; binding like the sections above)

1. **The `notes` extension's shape (U-1):** keep the outer `availability`:
   `notes: { availability; understanding: { rows; norms; normsOmitted }; general: NoteIndexRowV1[] }`, where `rows` are
   at most 3 understanding rows in the order project, goal, stage (each = `UnderstandingStatusV1` plus its scope and,
   for the project row only, the whole body), and `norms` are `NoteIndexRowV1`. CA14 (`:802`) and
   `S3-graph-context.test.ts:1067` stay unchanged. The test doubles that build the old `notes` shape
   (`S3-graph-context.test.ts:712`, `tests/app/S3-graph-routes.test.ts:42`, `tests/helpers/WP1-units-fixture.ts:360`)
   change only that shape.
2. **U8's file (U-2):** new `notes/note-memory-material.ts`; it uses `selectProjectHeader`/`buildFindPage`'s pieces
   from `note-read-model.ts` (export what it needs; do not copy them). `reminders` = the update-due rows of the
   goal/stage anchors (`{ anchorKey, updateDue, latestTriggerCursor }`).
3. **`understandingOf` (U-3):** the check owns the per-call caches, so the check returns the understanding status too:
   `NoteCheckPort`'s input gains an optional `understandingAnchors: string[]` (goal/stage/project anchor keys) and its
   result gains `understanding: UnderstandingStatusV1[]` for them, computed from the same caches (pointer, triggers,
   plan). `lookup` asks for its anchor through this and uses the answer; **`understandingOf`'s own pointer read is
   deleted**. One trigger read per goal per call.
4. **Pending to-dos (U-4) and the immediate send (U-5):** a second narrow port for the Host,
   `NoteScribeTodoPort.readScribeTodos(ctx, { goalIds })` → per goal: pending to-dos (`noteId@version`, counted by the
   §11.5 rule with `userReasonsOf` and `pendingUnderstandingOverridden`, cancelled goals excluded, plus the goal-less
   pending bucket once per workspace), update-due to-dos (`anchorKey@latestTriggerCursor`), and the immediate flag (an
   `archive:` trigger whose `TaskRequeue` no Run of the goal holds as `requeueRef`; the trigger read already reads the
   goal's Runs). Declared in `model/note-contracts.ts`, implemented in notes over the same trigger reader and fold.
   `NoteUpdateDuePort` stays for the assembly.
5. **The Host loop (U-6):** every workspace in `options.workspaces`; the loop runs when attention, input consumers **or**
   the scribe to-do port is configured; the reminder period is a constant `SCRIBE_REMINDER_PERIOD_MS = 60_000`,
   injectable through `CreateHostOptions` (tests inject a short one with the injected clock); the loop period is the
   minimum of the configured ones. New `CreateHostOptions` seams for the port and, if needed, the existing message
   sender — no new sender.
6. **One unhandled reminder per recipient (U-7):** reuse today's rule (`host.ts` ~1173–1195: the previous reminder
   message to that recipient is still unprocessed → do not send another); it reads the message records, so it survives
   a restart. Only the ledger cursor ("nothing changed, do not recompute") is in memory (§11.5).
7. **`pendingUnderstandingOverridden(pending, current)` (U-8):** `pending: NoteHeadSnapshot`,
   `current: NoteHeadSnapshot | null` (the head the same anchor's pointer points to); true iff `pending` is an
   understanding in `pending_review`, `current` is not null, is `accepted` or `reviewed`, has the same anchor key, and
   `current.createdAt > pending.createdAt`; `current === null` → false.
8. **`foldUpdateDue` (U-9):** a trigger is `{ key; at; kind: 'task_end' | 'rework' | 'archive' | 'plan'; taskId:
   string | null }`; the fold maps tasks to stages through the plan it is given. T2's first-cancelling plan follows the
   rule at `plan-readers.ts` ~1995–2009; a source plan that cannot be read → `unavailable`. No current plan → no
   triggers; the goal anchor `updateDue: false`; no stage anchors (§11.5).
9. **`NoteIndexRowV1` (U-10):** new, in `src/contracts/graph-context.ts`, shape per L20.
10. **`moduleOfAnchor`:** it stays as the anchor-level wrapper over `pathOwnershipOf` (module and interface anchors give
    their module; file anchors go through the shared function). It is not an old copy; leave it.
11. **`orchestration-mechanism.test.ts:331`:** must stay green unchanged. The reminder check sends nothing when there
    is no scribe to-do; if that scenario still changes, report it.
12. **The 20,000-note measurement** (spec §12 item 12) is the lead's, after session B; not yours. `npm run build` is
    part of the checks and is not skipped.
