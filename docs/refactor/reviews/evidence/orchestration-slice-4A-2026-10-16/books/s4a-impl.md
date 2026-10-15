# Task: slice 4A — notes: records and writes; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not seen
this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not make
design decisions. Where the spec and this message do not determine something, do not invent behaviour: list it under
UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (`sleep 300`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents; keep your own context small** (an earlier session ran out of its 360K context). Do not read the
spec, the code or the tests yourself beyond what you need to coordinate; use `grep -n` and `sed -n a,bp`, never whole
large files. At most **2 subagents at once**. Each subagent's message contains sections 1–5 of this message verbatim,
its own group block verbatim, and: read `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`; read the spec sections its
block names, always including §0.2, §0.3 L1–L8, L2a, L18, §0.4, §8; work through its rows test-first; run
`npm run typecheck` and its own test files only; reply with FILES, per row the test name(s) and the implementation
file:symbol, the RED/GREEN log, and UNSPECIFIED items (short).

## 1. What this copy is

- **Base:** commit `slice-setup` holds the content of commit e8b3edae of the lead's branch (slices 0, 1, 3, 5, wiring
  1 and 2, K parts A and B, 2A and 2B merged; slices 4, 6, 7, 8 frozen). Slice 2C is **not** in this copy (it is being
  merged separately); 4A does not need it. This copy has its own history; use `slice-setup`, not outside hashes.
- **Commit `slice-base`** adds `DSH-BASELINE.md`, the baseline of this sandbox.
- **The TDD skill** is in `./.dsh-ref/tdd/` (not committed, excluded from `git status`).
- **What you do:** implement **slice 4A** of `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`
  **test-driven**: for each row N-01 … N-22 of spec §5.2 (entry NE1; the user confirmed it), write one failing test at
  the entry, see it fail for the right reason, write just enough production code to make it pass, go to the next row.
- **This sandbox has no bubblewrap.** `DSH-BASELINE.md` lists the tests that fail here only for that reason. 4A needs no
  real sandbox. Never instrument a harness to fake a sandbox.

## 2. Where the rules are (all inside this copy)

The frozen spec, slice 4 (Chinese prose, English identifiers). For 4A read: §0.2 (code facts, at 5c7a3258 — find the
symbol if a line moved), §0.3 **L1–L8, L2a, L18** (binding), §0.4, §1.1 (the 4A paragraph), §2 (interfaces: names and
signatures are binding; only the parts 4A delivers), §3 (state rows S4-NOTE-*), §4 (rules), §5.1 NE1, §5.2 N-01–N-22,
§5.3, §6 (the 4A line), §7, §8. The later rules (L9–L17, L19–L23) belong to 4B and 4C: do not build them.

Lead amendments to the spec, binding (decision 56 of `docs/refactor/HANDOFF.md`):
- **A1 — you write the fixtures** (spec §7 says so), under section 4's L-fixtures.
- **A2 — §5.3 for 4A:** only `tests/architecture/state-writes.test.ts` (add the note records and events to the
  protected type table and the decode allowlist, the way slice 2C's rows were added) and, if the composition root gains
  a non-enumerable `notes` owner, confirm `tests/composition/platform.test.ts` still passes unchanged. No other existing
  test changes in 4A; the graph `find` changes of §5.3 are 4C's.
- **A3 — scribe scope before slices 7D1 and 8B.** 4A writes the scribe scope facts (L5) and the per-scope counts (L7);
  the multi-scribe wiring arrives with 7D. Today:
  - a **region scribe** is a Session of duty scribe with an open `responsible` link to a module (the `module` work-link
    target exists today); its region is that module plus its containment subtree when the active catalog declares
    `containment.parentOf` (`src/contracts/architecture-catalog.ts:29-33`), and the module alone when it does not;
  - the **project-scope scribe** is a scribe Session with no open module (or goal) responsibility — today's start scribe;
  - **goal scribes** need the `goal` work-link target, which slice 7D1 adds: the goal-scribe cases of N-10 (n5, n6, `SG`)
    and N-22's last case are **not written now**; list them in the reply as "7D1 联动补验".
  - If the containment cases of N-10/N-21 (A ⊃ A1) cannot be built through public services (the catalog adoption and
    revision you can reach), stop on those cases and report why; build the rest.

## 3. Frozen files (never change them, not even temporarily)

`DSH-BASELINE.md` and `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`. **No existing test file
changes except A2.** Throw-away probes go under `./.dsh-scratch/` and are deleted at the end; never use `/tmp`. If the
spec seems to contradict an existing test, keep the test, report it under UNSPECIFIED (test id, assertion, spec line,
minimal counter-example) and go on.

## 4. Lead decisions for this round (binding)

- **L-scope.** Only the files of spec §6's 4A line may change, plus new test files whose names start with `S4A-` under
  the fitting `tests/` directory, new helpers `tests/helpers/S4A-<name>-fixture.ts` or `-support.ts`, the A2 edit, the
  two new files `src/core/work-graph/notes/note-anchors.ts` and `notes/scribe-scope.ts` (P11), and in `docs/` exactly
  `docs/refactor/module-target.json` (P3). No other `docs/` file, no lock files, no `vendor/`, no RecordStore files
  (`src/core/record-store/*`: 2C and 4B change them). A file outside this list that you believe must change: stop and
  report it.
- **L-tdd.** One row → one failing test → minimal code → next row; tests at the entry (NE1: the public
  `NoteWritePort`, `NoteReadPort`, both backends); **no reading the database or record store to verify** (the user's
  standing rule) — assertions go through the public reads (`readNote` by id, `listByAnchor`, the per-scope count of L7);
  expected values are literal, hand-computed from the spec, never computed with the product's own functions; each test
  name starts with the row id (`N-05 …`); a row with several cases has one assertion per case; no tests whose answer is
  obvious from the code.
- **L-fixtures.** Build every dataset only through the real public services (goals, plans, tasks, Sessions, Runs — for
  agent sources use a real execution's call context). Exceptions, exactly as spec §7 names them: the storage-boundary
  interleaved-commit double of N-07 and N-14. Each fixture file starts with a comment listing what it builds and through
  which public calls.
- **L-reach.** `tests/architecture/production-reach.test.ts` must pass: every new exported declaration is reached from
  production code (4A adds no route, so no allowlist entry).
- **L-interfaces.** Names, signatures, record and event types, index ids exactly as spec §2 and L1–L8, L18 give them.
- **L-state.** State changes go through `src/core/work-graph/state/` (AGENTS.md rule 9): the note machine is
  `state/note-machine.ts` (§6), with the S4-NOTE rows of §3.

## 5. Rules for every group

1. Test-first, one row at a time; keep the RED/GREEN log per row for the reply.
2. Spec §4 rules and §8 hold, and L1–L8, L2a, L18.
3. Read failures and refusals are returned, never turned into success, zero or an empty result.
4. No real model calls, no network; do not touch ports 3080, 3099 or 44797.
5. No git write commands.
6. One vitest command at a time per agent, `--maxWorkers=4`; the full suite only once at the end (section 8).

## 6. Lead answers to the read-through (binding; where they differ from another section, they win)

A read-only session read this book and the spec before you and reported what was unclear. The lead's answers:

**P1 — The per-scope count (L7) gets a port.** Spec §2 names none; the lead names it here (it does not change
`NoteReadPort`). In `model/note-contracts.ts`:
```ts
export type NoteScopeV1 = { kind: 'project' } | { kind: 'region'; moduleId: string } | { kind: 'goal'; goalId: string };
export interface NoteScopeReadPort {
  countCurrentNotes(ctx: CoreCallContext, input: { scope: NoteScopeV1 }):
    Promise<ReadResult<{ scope: NoteScopeV1; current: number }>>;
}
```
`current` = the number of distinct note ids whose stored state is `accepted` or `reviewed` and whose L5 managing scope
(P6) is exactly `scope`. A scope with no scribe manages nothing: its count is 0, and its notes count for the scope they go
up to. (Slice 7 L28 counts `currentEligible`; that needs 4B's L9, so 4B narrows the filter. Do not build that; say it in
NOTES.) Implemented in `notes/scribe-scope.ts`, exposed on the `notes` owner (P2). Tests go under row N-10 (`N-10 count
…`). With the N-10 fixture's n1–n4 only: region `A1` → 1, region `A` → 1 (n2 has two anchors, counted once), project →
2 (n3, n4), region `B` → 0.

**P2 — Composition.** 4A adds a non-enumerable `notes` owner to the platform: add `'notes'` to the
`Object.defineProperty(platform, key, { enumerable: false })` list near the end of `src/composition/create-platform.ts`
(same rule as `runActivity`, `activity`). It holds `writeNote`, `reviewNote`, `withdrawNote`, `readNote`, `listByAnchor`
and `countCurrentNotes`, bound to the one note service and read model; 4C's routes will bind to it. Tests reach the ports
through `platform.notes` on both backends. `tests/composition/platform.test.ts` must pass unchanged (A2).

**P3 — `module-target.json` is in scope** (section 4 used to forbid `docs/`; that was wrong: spec §1.1 and L18 put it in
4A, and `scripts/check-boundaries.mjs` rejects a `notes/` file without it). Change exactly
`docs/refactor/module-target.json`: add the `notes` submodule (`"path": "notes/"`, dependencies `model`, `state`,
`persistence`, `architecture`, `sessions`, `tasks`) and add `notes` to the dependencies of `evidence` and `views` (F17).
Do not edit the `note` prose in that file and do not touch `module-dag.md`; the lead writes both at merge. If a notes file
needs another submodule, stop and report it; do not add it.

**P4 — Who the caller is (L5), from the trusted `CoreCallContext` only:**
- `host` principal with a human actor (`reworkActorClassOf` in `src/contracts/task-requeue.ts` gives `'human'`) → user
  source `{ kind: 'user', principalId }`; the goal is `WriteNoteInput.goalId`. A system actor → `forbidden`.
- `work_run` → agent source: `runRef` = the principal's run; `sessionRef` = that Run's Session (public reads); goal =
  `runRef.goalId` (the input `goalId` is not used for agents: L5 "agent 写的是它这次执行的目标"); duty = the Session's duty
  from the injected resolver (P5). Duty `reviewer` or `unknown` → `forbidden`. A scribe is a Session whose duty is
  `scribe`: build scribe contexts like executor ones (a RoleSpec with `platformDuty: 'scribe'`, a Session, a claim, a
  real Run with the scripted model).
- `query_run` → `forbidden` in 4A. Read-only copies (N-03) come in this way. The secretary and `role_exploration`
  branches arrive with slice 6 (6B registers `record_note` for them, with the request's effective goal); list them as
  "第 6 片联动补验".

**P5 — Duty resolution.** `notes` may not import `business/` or `configuration/`. Declare in `model/note-contracts.ts`:
`export type NoteDutyResolver = (role: RoleConfigurationRef, ctx: CoreCallContext) => Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;`
The composition root passes the SAME resolver instance the Workflow gets: hoist
`options.sessionDutyResolver ?? createSessionDutyResolver({...})` (`create-platform.ts`, the Workflow's `sessionDuty`)
into one const and pass it to both. Do not build a second resolver.

**P6 — Scribe scope facts are derived, not stored.** Slice 7 L23: a scope is an open `responsible` SessionWorkLink, with
no purpose field. No new record. The "scope facts" of spec §1.1/§6 are the code in `notes/scribe-scope.ts` that computes,
from public reads:
- (a) each scribe's scope: an open responsible link to a `module` → the region of that module; none → project. This is
  A3, valid until 7D1 adds explicit `project`/`goal` link targets; list "7D1 联动补验".
- (b) a module's region: the module plus its `containment.parentOf` subtree in the active catalog; the module alone when
  the catalog declares no containment.
- (c) write admission (L2a class 3): a region scribe may use module-class anchors in its region, deeper regions
  included; a project scribe may use every anchor.
- (d) a note's managing scope (L5): the deepest scope that has a scribe and contains all anchors of the note and of the
  notes in its `replaces`/`contradicts`. Module-class anchors go by containment; file anchors map to modules by the
  longest path prefix. Mixed module-class and goal-class anchors, or several goals → project. No scribe on that scope →
  go up, and finally to project.

Compose these from the public reads the read-through named: `findSessions` for open responsible module links, duty via
P5, and the architecture catalog read. Archived Sessions have no open links and do not count. With several project-scope
scribes, each of them manages the project-scope notes.

**P7 — Rows that reach into 4B, 4C or slice 8.** Build the 4A part and skip the rest. List each skipped case in the reply
under the name given:
- **N-06:** build the first half: `pending_review`, `contradicts` points at the old note, and the old note is still
  current. The contradiction-card `supersede` half is L17/4C → "4C 联动补验".
- **N-11:** assert each of the three versions' `storedState` through `readNote({ noteId, version })`, and that a text
  change makes a new version while the old version reads unchanged. The "经过" (`change`) is the history read (L12, 4B) →
  "4B 联动补验".
- **N-13:** build `staged`, its withdrawal, and the refusal to accept it here; write the staged-run index (L3). Listing
  by staged run has no 4A read → "第 8 片联动补验".
- **N-19:** build every case but the last; "全文能查到" is 4B (L10) → "4B 联动补验".

**P8 — `NoteItemV1` in 4A.**
- Compute from records: every stored field, plus `conflicting` (both parts of L9; N-14 needs it) and `overQuota` (L7;
  N-07 needs it).
- Fields that need L11, L22, L23 or the caller's goal view take their unchecked values:
  - `freshness: 'unchecked'`;
  - `uncheckedFacts`: every fact index;
  - `currentEligible: false` (L9 requires `fresh`);
  - the arrays `changedFiles`, `observedFiles`, `staleReasons`, `anchorRetiredReasons`, `retiredExtraAnchors`,
    `unresolvedFacts`, `hints` and `matchedTerms`: `[]`;
  - `sourceUnavailable`, `invalid` and `crossGoal`: `false`;
  - `updateDue: null`, `anchorStatus: 'live'`, `score: 0`;
  - no `body` paging.
- 4A tests never assert these unchecked values; 4B replaces them through `NoteCheckPort`. 4A applies no cross-goal
  visibility filter (that is L12, 4B).

**P9 — Names the spec uses but does not define** (lead definitions, binding):
```ts
// src/contracts/note.ts
export type NoteHeadRef = { aggregateType: 'NoteHead'; projectId: string; noteId: string };
export type NoteVersionRef = { aggregateType: 'NoteVersion'; projectId: string; noteId: string; version: number };
export type CurrentPointerRef = { aggregateType: 'CurrentPointer'; projectId: string; anchorKey: string };
// model/note-contracts.ts
export type NotePageV1 = { items: NoteItemV1[]; next: string | null; complete: boolean;
  pointer: { noteId: string | null; revision: number | null } | null };   // goal/stage anchors only; { null, null } when none yet
```
- **Refs:** `ledger.ts` adds the three refs to `AggregateRef`, imported from `note.ts` (the way `RunActivityRef` is).
- **Event shapes:** follow `persistence/run-activity-codecs.ts` (an event-type const, the snapshot in the body, a strict
  decoder):
  - `NoteWritten { head: NoteHeadSnapshot; version: NoteVersionSnapshot }`;
  - `NoteDispositionChanged { head; version; acknowledgementRef: SessionMessageRef | null }` (always null in 4A; 4C's
    card fills it);
  - `CurrentPointerMoved { pointer: CurrentPointerSnapshot }`.
- **Event order:** one event per head written, per disposition change and per pointer change, all in the same commit. In
  a disposition commit (review or withdraw), the subject note's `NoteDispositionChanged` is the last event; superseded
  heads and the pointer move come before it.
- **`stagedRunKey`** = `${runRef.goalId}/${runRef.runId}` for a staged repair, else null.
- **`listByAnchor`:**
  - matches a head on any of its five anchor keys, in every stored state;
  - orders ascending by (`createdAt`, `noteId`);
  - `limit` must be 1–`MEMORY_PAGE_MAX`, else `invalid`;
  - the cursor is opaque and bound to the anchor and the limit; a mismatch → `invalid`, `cursor_mismatch`;
  - no head with the anchor key and the anchor does not exist now → `not_found`, `anchor_not_found` (L12's rule, without
    candidates); an existing anchor with no notes → an empty page with `complete: true`.
- **Pointer revision:** an absent pointer reads `{ noteId: null, revision: null }`, and the first understanding write
  expects `null`. The first pointer record has revision 1; each move adds 1.

**P10 — Basis files and missing-file candidates** (L2a; §4 rule 13).
- Read through the injected `WorkspaceToolsPort.readWorkspace` with `version: { kind: 'working_tree' }` and
  `maxBytes = min(NOTE_BASIS_FILE_MAX_BYTES, the workspace tools' configured maxFileBytes)`, injected at the composition
  root.
- Tests use the real workspace tools on the test's real temporary workspace, as the slice-3 and 2B tests do. N-01's
  case: a real 1,048,577-byte file → `basis_file_too_large`. If the fixture workspace's cap is below 1 MiB, use that cap
  + 1 and say so.
- Missing-file candidates: the write's capture (`captureSourceChanges`), then
  `querySource(ctx, { capture, query: { kind: 'paths' }, cursor, limit })`, paged, at most `NOTE_ANCHOR_CANDIDATE_SCAN`
  paths. If the capture fails: no file candidates and `candidatesUnavailable: true`.

**P11 — Grouping: your cut, run in sequence.** Every group's tests need the previous group's code at the entry, and W
and G would both change `note-service.ts`. Run **one subagent at a time**, in the order R → W1 → W2 → G:
- **R — records, machine, codecs (no rows):**
  - `src/contracts/note.ts` (with P9);
  - `src/contracts/ledger.ts`;
  - `model/note-contracts.ts` (§2, P1, P5, P9);
  - `state/note-machine.ts` (S4-NOTE rows);
  - `persistence/note-record-codecs.ts` (two records, the pointer, three events, three index groups of L3);
  - the record-group registration;
  - P3 and A2.
  Spec: L1, L3, L6, §2, §3. Its RED/GREEN log is empty; say so.
- **W1 — rows N-01 to N-09, plus N-10's non-scope cases** (review rules with today's project scribe):
  - `notes/note-service.ts`;
  - the minimal `notes/note-read-model.ts`;
  - new `notes/note-anchors.ts` (anchor keys; L2a classes 1–2 without candidates);
  - the `notes` owner (P2) and the resolver hoist (P5).
- **W2 — rows N-11 to N-19**, in the same files.
- **G — rows N-20, N-21, N-22, plus N-10's scope cases and the count (P1):**
  - candidates, `anchor_out_of_goal`, `anchor_ended` and the `deleted` rules in `notes/note-anchors.ts`;
  - new `notes/scribe-scope.ts` (P6, P1);
  - the scope checks in `note-service.ts` (write admission L2a; review and withdraw of others' notes only in the
    managing scope, `outside_managed_scope`).

**P12 — §0.2 drift.** Yes: find each symbol on this base. List the moved facts (old → new file:line) in NOTES. F3's path
and F13's file are known drifts; they concern 4C. Take no action on them.

**P13 — A3 is not a contradiction.** N-10, N-21 and N-22 are 4A rows (spec §5.2, "4A（NE1）"). L5's "8B 以后" says when
real containment data reaches production. §8 says production behaviour stays as it is today because only the start
scribe exists. The code reads `containment.parentOf` when the active catalog declares it. Build per A3.

**P14 — N-10's handover and archive cases.**
- "SA1 完整换手给 SA1b": move the responsible link through public calls available today. Use the Workflow's archive with
  transfer if it moves responsible links to a successor; otherwise close SA1's link and open SA1b's with
  `linkSessionWork`. Say which you used. The real handover is slice 7 → also list "7 片联动补验".
- "SA1 归档": use the public Workflow archive (it closes SA1's links); n1 then goes up to SA.
- If either case cannot be built through public services, stop on that case and report why.

## 7. Size and time

Finish within 180 minutes. If you run short, finish whole rows rather than half of many, and say which rows are left.

## 8. Checks

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`; the
4A test files; the full suite once (`--maxWorkers=4`) compared with `DSH-BASELINE.md` §A — list every failure outside
it. `git status --short` must show only the files of L-scope.

## 9. Reply

FILES CHANGED; per row N-01–N-22 the test name(s), the implementation file:symbol and RED/GREEN in one line each; the
rows or cases not built and why, grouped by the names of A3, P4, P6, P7 and P14 ("4B 联动补验", "4C 联动补验",
"第 6 片联动补验", "7 片联动补验", "7D1 联动补验", "第 8 片联动补验"); CHECKS (each command and its result, the full-suite numbers and the failures
outside the baseline); UNSPECIFIED; NOTES (regrouping, size).
