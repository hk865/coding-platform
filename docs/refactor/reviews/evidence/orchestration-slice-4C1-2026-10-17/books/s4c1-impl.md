# Task: slice 4C-1 — the note tools, routes, node-detail notes column, related-first find, default states and the protection rules; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec and the
lead's rulings below are binding; do not make design decisions. Where this book and the spec do not determine
something, choose nothing: list it under UNSPECIFIED with the smallest options, and go on with the next item.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it. Subagents write all code and tests; you split, brief, check and
reply. **Finish within 200 minutes** (the run stops at 210, with a handoff if needed): do the groups in order and finish
whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch with 4A, 4B, speed round 1 (decision 66; `269a9748`) and decisions 66–71 merged.
  `slice-base` adds `DSH-BASELINE.md` (tests that fail in this sandbox only).
- 4A/4B built the note records, the write service, the check port and the six memory reads on the non-enumerable
  `platform.notes` holder, with no tools and no routes. Speed round 1 rewrote the read model's candidate paths
  (`headInScope`, one HeadCache per call, `checkHeads`, the per-call memos).
- This round wires the notes into work: the `record_note` tool, the memory branch of `look_graph`/`find_graph`, the
  person's note routes, the node-detail notes column; and it adds the rules of spec §11 that change what reads return
  and what writes and dispositions are allowed. Assembly, note cards, notices, `updateDue` and scribe reminders are 4C-2.

## 2. Inputs (inside this copy)

- **Binding:** this book (section 4 wins over everything else); `docs/refactor/HANDOFF.md` decisions 66–71; the spec
  `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`: **§11 first** (it overrides earlier sections),
  then §9, §10, and L13, L14, L15, L19, L21, §2 (tool and route shapes), §5.2 rows G-01–G-05, R-01–R-03 and the §11.8
  rows assigned to 4C-1 below.
- Background: `./.dsh-ref/s4f-impl.md` (speed round 1's rulings; the read-model names), `./.dsh-ref/facts-*.md` (the
  lead's code-grounded fact reports for §11).
- The TDD skill: `./.dsh-ref/tdd/`.

## 3. Frozen files and the allowed test changes

- Never change `DSH-BASELINE.md`, `docs/`, lock files, `vendor/`, `src/core/record-store/`.
- Production files you may change (spec §6 for 4C, minus 4C-2's):
  - Runtime: `src/core/agent-runtime/graph-tools.ts`; new `src/core/agent-runtime/note-tool.ts`;
    `src/core/agent-runtime/execution-driver.ts` (registration); `src/core/agent-runtime/execution-contracts.ts` (the
    runtime dependency that carries the notes port to the tools).
  - Notes and their contracts: `src/core/work-graph/notes/` (all), including new `notes/note-related-scope.ts`;
    `src/core/work-graph/model/note-contracts.ts`; `src/contracts/note.ts`;
    `src/core/work-graph/persistence/note-record-codecs.ts` (the review-reason whitelist gains `user_note_replaced`,
    and the stored shapes the rulings add); `src/core/work-graph/state/note-machine.ts`.
  - Views and lines: `src/core/work-graph/views/note-views.ts`; `src/core/work-graph/views/node-detail-reader.ts`;
    `src/core/work-graph/views/graph-context-reader.ts` (G-04's matching, about line 1550);
    `src/core/work-graph/model/work-line-contracts.ts`; `src/contracts/work-line.ts` (the node-detail `notes` field,
    today `NotYetV1`, about line 260).
  - `src/core/work-graph/tasks/plan-readers.ts`: only the narrow resolver read (C2.2).
  - Composition, routes and UI: `src/composition/create-platform.ts`; `src/app/core-routes.ts`;
    `src/app/core-http-types.ts`; `src/ui/api/routes.ts`.
  - The four skill files' "注记" section (C1.6).

  A file outside this list that you believe must change: stop that item and report it. **`query-execution.ts` is not
  in scope** (C1.3).
- **Existing tests stay unchanged, except exactly these (spec §11.8):**
  - `tests/work-graph/S4B-memory-paging.test.ts:108` (M-09): lookup's empty page becomes `complete: true`; move its
    empty-page point to the new DS-06.
  - `tests/work-graph/S4B-memory-l12-bounds.test.ts:173`: another goal's agent-accepted note is no longer in `find`;
    move its "not current" assertion to a direct `checkNotes` call.
  - `tests/work-graph/S4A-note-write.test.ts:336`, `:486`, `:502`, `:653`, `:676`, `:890`,
    `tests/work-graph/S4A-note-history.test.ts:475`, `:499`, `tests/work-graph/S4B-memory-similar.test.ts:22`: they
    make pending notes with `structural: true`. After C3.3/C3.4 some become accepted, and some stay pending for
    another reason (user protection, quota).
    - Where the test needs a pending note: change only how it is made, through the public write service (e.g. an agent
      note that `replaces` a user-confirmed note, or a full anchor for `quota_full`).
    - Where the test asserts the reason: change only the reason assertion to the new one.
    - Keep what each test verifies. `:336` checks the projected quota minus the superseded item: keep the superseded
      item on the same anchor.
  - `tests/work-graph/S4A-note-write.test.ts:370`, `:702`: the superseded note is the user's, so the reason becomes
    `user_note_replaced`; change that reason assertion only.
  - `tests/work-graph/S4A-note-write.test.ts:403`: an agent replacing a user note is now pending (C3.3). To keep the
    quota check it makes, make the superseded item agent-written.
  - `tests/work-graph/SP-memory-check-scoped.test.ts:68`–`:69`: the structural staging no longer makes a pending note,
    so the second write hits the same-topic check. Re-make the pending data through the public service; keep the
    conflict and quota assertions.
  - `tests/work-graph/S3-graph-context.test.ts:856`, `:869`: G-04 makes `find_graph` matching case-insensitive (NFC +
    ASCII lowercase). Update only these expected results, hand-computed under G-04. The role name `builder` (`:365`) now
    matches, and role text takes part in matching (`graph-context-reader.ts:948`).
  - `tests/work-graph/S2C-node-detail-executions.test.ts:34`: `notes` is no longer `not_available`/`slice_4` (C1.5).
    Change that assertion to C1.5's shape.
  - Any other existing assertion that fails after a ruling: do not edit it; report it under UNSPECIFIED (test id,
    assertion, the ruling, a minimal counter-example) and go on.
- Throw-away probes go under `./.dsh-scratch/` and are deleted at the end; never `/tmp`.

## 4. Lead rulings for this round (binding)

### C1. Tools and routes (spec L13–L15, L19, L21)

1. **Memory branch (L13, G-02, G-04).** `look_graph` and `find_graph` schemas become the strict union of the old
   graph parameters and `{ memory: {...} }`; dispatch on `memory` first, old validation after. Old graph answers stay
   byte-identical except G-04's `find_graph` matching (NFC + ASCII lowercase on names, paths, descriptions; path query
   hits a module whose path equals it, is its longest-prefix owner by directory boundary — the same rule as
   `mapExecutedFilesToModules` — or lies under `query + '/'`). The memory branch calls `platform.notes`' reads with the
   trusted context from the adapter (F9); `find`'s schema includes `related` (§11.2).
2. **`record_note` (L14, G-01, G-05).** New `agent-runtime/note-tool.ts`, ops `write` / `review` / `withdraw` strictly
   separated; `review` gains `resolution?: 'supersede' | 'coexist'` (§11.6). `write` returns `{ write, check }`
   (`checkNotes` with `withSimilar: true` after a successful commit; a check failure is `{ status: 'unavailable',
   reason }` and never undoes the write). Plan and catalog revisions and the stage anchor's `planRevision` come from the
   execution's binding, never from the model.
3. **Registration (L14 table).**
   - Work executions: the executor and the adviser get `write` and `withdraw` (own notes); the scribe gets all three.
   - Read-only copies and independent reviewers get none (G-03).
   - The secretary's registration is slice 6.
   - **`role_exploration` is not in 4C-1** (lead ruling after the Codex book check). The call kind does not exist yet:
     `src/contracts/query-job.ts:150` and `:247` know three kinds, and `note-service.ts:115` refuses every `query_run`.
     6A/7D2 add the call kind; its `record_note` registration and L2a's admission go with it. G-01's
     `role_exploration` part and G-03's query part are reported as moved, not as failures.
   - The Work registration and the tool (C1.2) are one deliverable. The tool without its registration does not count.
4. **Routes (L15, L19, R-01, R-03).** The six routes of §2 (`notes/list`, `notes/write`, `notes/withdraw`,
   `notes/review`, `plans/versions`, `architecture/versions`) on `CORE_ROUTE_SPECS`, owner `notes` non-enumerable in the
   composition root; person only for the three writes and review; every write carries `commandId`, replay returns the
   original receipt (N-12); `notes/write` returns `{ write, check }`; `notes/list` labels rows with `renderNoteHeader`.
   Add them to the UI route label table (`src/ui/api/routes.ts`).
5. **Node detail (L21, R-02).** `readNodeDetail`'s `notes` changes from `not_available`/`slice_4` to the node's current
   understanding and the first `lookup` page, side by side with the existing anomaly anchors (unchanged); the hover
   card shows counts only; the tool's "look" drill-down reads the same thing.
6. **Skill and tool text (L14 last items).** Write the "注记" section of `resources/skills/platform-work/content.md`,
   `platform-adviser/content.md`, `platform-scribe/content.md`, `platform-secretary/content.md` (the secretary's includes
   the 61-5 guidance) and the `record_note` description, from L14's list, plus: only `currentEligible: true` items are
   current conclusions (§11.3); the scribe resolves agent-vs-agent contradictions with `resolution` (§11.6); the project
   understanding is the scribe's curated project document (§11.4). Content, not new behaviour assertions.

### C2. Reads (spec §11.2, §11.3, §11.4 read side)

1. **Related-first find (§11.2)** exactly as written there: request field, the resolution table and check order, the
   related key set for tasks and modules, the two segments with the shared predicate, per-segment order and L10's
   1,000-candidate cap, `segment` / `related` / `boundary` / `ranking` / `complete`, `RULE_VERSION = 2`, paging and the
   48 KiB rule, read failures `unavailable`. New `notes/note-related-scope.ts` (reads separate from the pure builder
   and predicate); export `moduleOfAnchor` from `scribe-scope.ts`.
2. **`NoteRunTaskResolver`** (§11.2): one `readMany` of the Run snapshot from the trusted `ctx.principal.runRef`,
   returning `{ goalId, taskId, planRef }`; injected into the read model by the composition root.
3. **Default states and b11 (§11.3)**: one `visibleByDefault(head, g)` used by find and lookup, inside `headInScope`,
   before U/df, caps, paging and slicing; explicit `state` overrides; lookup's filter moves before sort and slice;
   conflicts derive `conflicting` first and pass it into `checkHeads`; the R3 `coverage` amendment; `stale` drops the
   unreachable `invalid` test; `RULE_VERSION = 2` for all reads.
4. **Project understanding, read side (§11.4)**: `pointerOf` / `understandingOf` accept `project`; the visibility
   exception; `find`'s first-page `project` header with the norms selection, one deduplicated `checkHeads`, the
   extended R12 trim. `updateDue` stays `null` everywhere in 4C-1 (4C-2 wires it); the type of
   `UnderstandingStatusV1.updateDue` becomes `boolean | null` with `null` for the project anchor.

### C3. Writes and dispositions (spec §11.4 write side, §11.6 rules and guards)

1. **Project understanding writes**: allowed on `{kind:'project'}`, `goalId` always null, no extra anchors
   (`project_understanding_extra_anchors`), writers = the project scribe (`manages(..., {kind:'project'})`) and the
   user (`project_understanding_scribe_only` otherwise), body cap `PROJECT_UNDERSTANDING_BODY_MAX_BYTES = 4096`. In
   `note-service.ts` change exactly the paths these need:
   - the anchor-kind check (about `:649-653`);
   - the body length check (about `:333`);
   - the goal id given to anchor resolution (about `:637`);
   - the goal quota (about `:835`): the project understanding takes no goal quota;
   - the stored goal id (about `:887`).
2. **`userReasonsOf(head, targets)`** in `state/note-machine.ts`, per actual disposition target (`replaces` minus
   `coexistWith`, plus `contradicts`), from facts at read/commit time; the machine guard at `note-machine.ts:219-223`
   uses it instead of the stored reasons.
3. **Admission**: `contradiction` is recorded only if some contradicted target is accepted or reviewed at write;
   `user_note_replaced` when the superseded set holds a current user-confirmed note (understandings excepted);
   `revised_while_pending` withdraws the same author's pending note named in `replaces`, in the same commit.
4. **Structural**: an agent's structural general note is admitted like any other (accepted in its own goal, the header
   keeps `!`); the notice is 4C-2. Structural repairs stay staged (slice 8).
5. **Dispositions**: the scribe's `accept` with `resolution` (required / not applicable rules, error codes), the
   `supersede` and `coexist` transitions shared with the card application of 4C-2 (S4-NOTE-05 + 08, S4-NOTE-10 with
   `by: 'scribe' | 'user'`; a scribe's coexist does not set `confirmedByUser`), version guards and receipts as
   `reviewNote`; the scribe cannot withdraw a user-confirmed note unless the scribe is its author (`forbidden`,
   `user_confirmed`; spec :774 keeps the author's and the user's withdraw, cf. `note-service.ts:997`, `:1004`); an outdated pending
   understanding cannot be accepted (`invalid`, `understanding_outdated`).
6. Pending notes with `goalId` null stay pending (no card until 7D2); `notes/list` shows them.

## 5. Rules for every group

- **TDD:** one test first (it must fail for the right reason), then the smallest change, then the next. Follow
  `./.dsh-ref/tdd/`.
- **Through public interfaces only:** NE3 (`platform.notes` reads, both backends, real workspace tools and files in a
  temporary workspace), NE4 (platform mode: real Runtime, frozen Kernel, scripted model; tools through the real
  registration), NE7 (HTTP routes, `readNodeDetail`). No reading the database or the record store to verify (the
  user's standing rule). Expected values are literal and hand-computed; test names start with their row id.
- **Rows to cover in this round:** G-01–G-05, R-01–R-03; from §11.8: F-01–F-08, DS-01–DS-07, PU-01, PU-02, PU-04,
  D-04, D-06 (without the card: the pending state and reason), D-07, D-08, D-09 (no card: pending, visible in
  `notes/list`), D-14, D-15, D-16; the call-count rows of §11.7 for find, lookup and the writes (counting wrapper on the
  public store ports: count calls only, never read contents).
- No real model calls, no git writes, never ports 3080/3099/44797.
- **Line budget (decision 69):** about 1,400 new production lines; report the actual count; over budget needs a reason
  in the reply. Reuse the list in §11.7; do not build a second reader for anything listed there.

## 6. Groups (order)

- **G1 Reads** (C2): related scope, resolver, visibility and b11, the project read side; NE3 rows.
  - Shared first: the contract changes in `note-contracts.ts` / `src/contracts/note.ts` for all three groups (`related?`,
    `segment`, `boundary`, `updateDue: boolean | null`, `resolution?`), one subagent.
  - Then in parallel: `note-related-scope.ts` with its tests, and C2.3/C2.4 in the read model.
- **G2 Writes and dispositions** (C3): NE3/NE1 rows through the public write service. `note-service.ts` and
  `note-machine.ts` are one task; the allowed changes to existing tests (section 3) are another.
- **G3 Tools, routes, node detail, skills** (C1): NE4 and NE7 rows. `production-reach` must pass (no stragglers).
  - `note-tool.ts` and the registration are one task.
  - The routes, the UI label table and node detail are another.
  - The skill text (C1.6) is a small last task.

**Priority when time runs short** (finish whole items; what is left goes to the next round and is reported):
1. **Must:** C2.3, C2.4, C3.1–C3.5, C1.1, C1.2 together with C1.3 (the tool and its Work registration), C1.4.
2. **Then:** C2.1, C2.2 (related-first find and the F rows), C1.5.
3. **Last:** C1.6 (text), C3.6.

Leave about 25 minutes at the end for the close-out subagent.

## 7. Checks (the machine may be shared with another DSH run: keep it light)

- Run only the files you touch while working, with `--maxWorkers=2`.
- **At the end, once, with `--maxWorkers=3`:**
  - `tests/work-graph/S4*.test.ts`, `tests/work-graph/SP-*.test.ts`, `tests/work-graph/S3-graph-context.test.ts`,
    `tests/work-graph/S2C-node-detail-*.test.ts`;
  - `tests/record-store/`, `tests/runtime/` (the graph tools are in `tests/runtime/S3-graph-tools.test.ts`);
  - `tests/composition/platform.test.ts`, the `tests/app/` route tests you touched, `tests/architecture/`.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- **Do not run the full suite.** The lead runs it with bubblewrap.

## 8. Reply

Under 900 words: FILES CHANGED (production / tests, with new production line count); per ruling (C1.1 … C3.6) done or
not, with the row ids, RED → GREEN; the allowed test changes you made; CHECKS with numbers; UNSPECIFIED (short, with
options); anything that surprised you.

## 9. Answers to the read-through and the Codex book check (lead, 2026-10-16 21:40; binding like section 4)

Sections 3, 4 and 6 above were already revised after the Codex book check. That covers:
- `graph-context-reader.ts`, `contracts/work-line.ts`, `execution-contracts.ts` and `note-record-codecs.ts` are now in
  scope;
- `role_exploration` moved to 6A/7D2;
- the S3, S2C and S4A test changes;
- the author's withdraw;
- the check directories.

The remaining questions:

1. **`notes/list` (C1.4).** Add `listNotes(ctx, request)` to the non-enumerable `notes` holder. It is the route-facing
   side of the existing reads; no new reader and no new index (decision 69).
   - `{ anchor, state?, limit, cursor }` → the `lookup` read. `state` is lookup's explicit state override (§11.3).
   - `{ goalId: string | null, state: 'pending_review', limit, cursor }` → the per-goal review-status bucket that the
     pending reads already use. `goalId: null` is the no-goal bucket (§11.6: goal-less pending notes are visible in
     `notes/list`).
   - `{ goalId: string, state: 'accepted' | 'reviewed', limit, cursor }` → the current heads of that goal (the existing
     per-goal current read).
   - Any other filter → `invalid`, reason `notes_list_filter_unsupported`.
   - Rows carry the L9 fields of the underlying read plus `label` from `renderNoteHeader`. The cursor is the
     underlying read's cursor.
2. **`userReasonsOf` (C3.2).** It is a pure function in `state/note-machine.ts`:
   `userReasonsOf(head, targets: Array<{ noteId; version; state; userConfirmed; userWritten; primaryAnchorRetiredNonFile }>)`.
   - The service reads the actual disposition targets (`replaces` minus `coexistWith`, plus `contradicts`) at read and
     commit time, builds those facts, and calls it.
   - The service puts the result in the field the machine guard reads. The guard at `note-machine.ts:219-223` then
     sees the computed set, never the stored `reviewReasons` (they stay as history).
   - A target that cannot be read → `unavailable` (§11.6).
3. **Structural scope (C3.4):** only general notes change (§11.1 item 7 says "普通注记"). An understanding with
   `structural: true` keeps today's behaviour; `S4A-note-write.test.ts:464` and `:555` stay as they are. Repairs stay
   staged.
4. **`find`'s first-page `project` header:**
   - It is on every first page (`cursor === null`), segmented or not; §11.4 is explicit.
   - §11.2's "non-segmented results unchanged" covers the items, their order and paging, not this new field.
5. **`resolution` on `reviewNote`:** add the optional `resolution` to the `NoteWritePort.reviewNote` request (§11.6
   extends §2). The tool, the route and 4C-2's card application all use it.
6. **Node detail (C1.5).**
   - Goal, stage, task and module nodes map to the note anchors of the same kind; the stage takes the goal's current
     plan revision.
   - Each of those nodes gets its current understanding (goal and stage only) and the first `lookup` page.
   - Other node kinds (Session, Run, round) keep `{ status: 'not_available', reason: 'no_note_anchor' }`.
7. **`production-reach`:** add `wire-format` entries in the existing format for the new route Body/Response aliases,
   and report each one.
8. **G-04 elsewhere:** `tests/scenarios/S3-context-and-inputs.test.ts` (sc01-find) and
   `tests/scenarios/S3-query-graph.test.ts` (sc02-find), if they fail only because of G-04's matching.
   - Update only their expected values, hand-computed under G-04, and report them.
   - The path rule is C1.1's (equal, longest-prefix owner, or under `query + '/'`). It replaces today's substring
     `.includes`.
9. **`S4A-note-write.test.ts:358`/`:373` and `:687`/`:701`:** compute by hand what C3.3/C3.4 give: accepted, or
   pending with `user_note_replaced`. Change only the state/reason assertion.
10. **Line numbers:** the fact reports and §11 predate speed round 1. Use the code, as the read-through listed.
    `UnderstandingStatusV1.updateDue` is already `boolean | null`; nothing to change there.
