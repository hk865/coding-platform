# Task: 4C-1 rework — the Codex review's findings, decision 72's U1 and U2; coordinator mode (3 subagents at once); test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, with one change for this run: **at most 3 subagents at once**
(a trial; files of running subagents must be disjoint; every vitest command `--maxWorkers=3`). Subagents write all
code and tests; you split, brief, check and reply. **Finish within 150 minutes** (the run stops at 160, with a handoff
if needed). Finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

- Tag `s4c1-a` (HEAD) = the 4C-1 build, committed by the lead; your first reply is `./.dsh-ref/s4c1-final-1.md`.
- The book `./.dsh-ref/s4c1-impl.md` stays binding (sections C1–C3, section 9's answers).
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` (§11; read only what an item names).
- Lead check with bubblewrap: 77 files, 942 passed, 5 skipped (the two A2 sandbox failures pass with bwrap).
- Codex reviewed the build read-only; two Claude subagents verified every finding against the code. The items below
  are the verified ones with the lead's rulings.

## 2. Items (binding)

Each production fix starts with a failing test (row id or the item number in the test name), through public entries,
literal expectations, memory and SQLite backends for service-level rows.

1. **`record_note` never reaches a production Work Run.** `host.ts:258-262` (`localWorkbenchGrant`) does not list it,
   and `execution-preparation.ts:96-99,224` caps the manifest at the Host tools, so only tests that grant it themselves
   (`S3-graph-tools.test.ts:733-735`) see it. **Ruling:** `src/app/host.ts` is in scope for this one change: add
   `'record_note'` to `localWorkbenchGrant` under the same condition as the mailbox tools (both are platform
   coordination tools that write WorkGraph records, not the workspace). Test through the real Host grant: an executor
   Work Run started through `HostScenario` lists `record_note` among its tools and can `write` a note. Report the
   changed `configurationRevision` effect (Runs prepared before the change) under NOTES; do not work around it.
2. **A concurrent user confirmation can be superseded** (`note-service.ts:1156` decides user reasons on v1;
   `supersessionOf(..., prereadHeads = null)` at `:1227` re-reads and guards v2). **Fix:** `userReasonTargetsOf` returns
   the heads it read; pass them as `prereadHeads`; and guard (read-only guard, `record-codec.ts:464-465`) at the read
   version every target read for the decision (contradicted targets kept by `coexist`, `replaces` targets, the
   no-resolution path). Test: a scribe accept with `supersede` whose target the person confirms between the read and the
   commit → `revision_conflict`, the user-confirmed note stays current (use the store-wrapper seam of
   `tests/helpers/task-claim-fixture.ts` style to interleave).
3. **Not changed:** the review/withdraw fingerprint shape (no pre-upgrade command can exist; refuted).
4. **Supersede leaves a target that is also in `coexistWith`** (`note-machine.ts:286-287`; `note-service.ts:287`).
   **Fix:** in the `supersede` branch, also remove the superseded targets from `coexistWith`. Test: a D-14 variant with
   X in both `contradicts` and `coexistWith`; after `supersede`, X is superseded. (Rejecting the overlap at write is not
   ruled; do not add it.)
5. **Stage continuity in the protection check** (`note-service.ts:659-664` drops `planRevision`; `note-views.ts:559-569`
   is L23's per-revision rule). **Fix:** one shared pure continuity function in `notes/` (notes may not import views),
   used by both callers; the service reads the plan revisions it needs (one window read, as `readGoalPlanWindow`). Test:
   S@p1, absent in p2, back in p3 → the old user-confirmed note on S counts as retired for the scribe's disposition
   (`resolution_not_applicable` for an agent-only target set, no `forbidden`).
6. **Segment 1's `partial` is lost on segment-2 pages** (`note-read-model.ts:1438`). **Fix:**
   `ranking = partial1 || seg2.ranking === 'partial' ? 'partial' : 'full'`. Test: the real F-08 row (§11.8) with the
   1,000-candidate cap injected small: paging reaches segment 2 → `ranking: 'partial'`, the last page `complete: false`.
7. **UNSPECIFIED 1:** split the request type from the resolved type; `memoryFind`'s `related` accepts only
   `task | module | null` shapes, rejects `caller_task` and extra keys with `invalid`. Small unit test.
8. **UNSPECIFIED 8:** `resolution` given with verdict `review` or `reject` → `resolution_not_applicable`, checked before
   the target reads. One test per verdict.

9. **Byte trim and `boundary`** (`note-read-model.ts:1619-1633`). The norm-trim loop always recomputes `next` from the
   kept items, so an empty-items `match:'all'` page with a non-null port `next` loses its cursor; `boundary` is added
   after the trim loops, so a multi-item page can exceed 48 KiB. **Fix:** compute `next` once after the item loop and
   reuse it in the norm loop; put `boundary` inside the measured result (initial result and every rebuild). Tests with
   the injected `resultMaxBytes` (F-05's hook): an empty-items page keeps `next`; a two-item page near the bound is
   trimmed with `boundary` counted.
10. **Coverage counts every checked header norm** (`:1275`, `:1305` check up to 10; `:1319-1325`, `:1561-1586` count
    only the 5 shown). **Ruling:** coverage, `filesRead` and `observedFiles` count every norm actually checked (§11.3:
    "只数这一页实际核对的项"; §11.4: header items' file observations count). On a byte trim, checked norms stay counted
    while the project header is kept; when the header is trimmed, they drop with it. Test: the only reviewed norm has a
    changed basis file and the query matches nothing → `checkedItems: 1`, the file in `observedFiles`.
11. **Node detail hides a failed notes read** (`node-detail-reader.ts:961`, `:963`). **Fix:** add
    `{ status: 'unavailable'; reason: string }` to `NodeNotesV1` (`contracts/work-line.ts`) and return it for a missing
    dependency or any non-ready read, as `hoverNoteCount` already does (`:973-975`). Change your own
    `S4C-node-notes.test.ts:125` accordingly and add a failing-port case.
12. **§11.7 read bounds** (book §5 requires the call-count rows):
    - (a) scribe scope facts derived once per call (pass the facts through, or a per-call memo), relation targets and
      disposition targets read in one batched `readMany` (`scribe-scope.ts:305-307,322,352,370`;
      `note-service.ts:634,588,728,764,823,828,1134,1139`). A project-understanding write may derive once more (the
      §11.7 row), no more.
    - (b) a task's Run files through `RUN_BY_TASK_INDEX` (`plan-readers.ts:91`) and one batched RunActivity read, as
      `run-activity-service.ts:539-553` (not a scan of the goal's activity index, `note-related-scope.ts:197-224`).
    - (c) stage keys: one prefix scan per anchor slot (`stage:g/`, 5 calls) by generalising `headsOnPathPrefix`
      (`note-read-model.ts:637`) to any key prefix and filtering revisions in memory; fold the duplicate five-slot scan
      at `note-related-scope.ts:263` into it.
    - (d) no-term finds read the second segment only when the page actually reaches it (`:1378`; keep the spill branch
      `:1395` and the exact-limit check `:1410`).
    - **Count tests** with the existing counting wrapper (`S4C-related-scope.test.ts:68-71`), each number computed from
      §11.7's row for the fixture's bucket sizes and written as a literal: a find page that stays in segment 1, a page
      that reaches segment 2, a `lookup` page, a `record_note` write with relations, a scribe disposition.
13. **U2 — one path-ownership function** (decision 72). One pure function in `work-graph/notes/` (or
    `architecture/`): input a path and the modules' paths; directory boundary with `/`, one trailing `/` stripped, the
    longest prefix wins, a tie means no owner (reported as a tie). No `.` semantics (8A adds it; `architecture-source.ts`
    rejects `.` today). No backslash handling (catalog paths use `/`). Callers: `scribe-scope.ts` `moduleOfAnchor`,
    `views/goal-conflicts.ts:470-498`, `views/graph-context-reader.ts:203-224` (G-04: the caller normalises query and
    paths for search, then calls the function; a tie is reported, not two hits), `views/node-detail-reader.ts:739-742`
    `underModule` (containment aggregation stays in the caller; a file belongs to its owner only). Delete the old
    copies. Tests: A=`src`, B=`src/deep`, file `src/deep/x.ts` → B only, in every caller; A and B both `src` → tie, no
    owner; existing conflict and node-detail tests stay green (report any that relied on the old prefix rule, with
    file:line, and do not edit them).
14. **U1 — the pure request builder.** Export `recordNoteRequestOf(args, commandId)` from `note-tool.ts` (or a small
    sibling file) covering write, review and withdraw (`note-tool.ts:177-200,258-277`); the tool uses it. The owner's
    tool-commit lookup is wired when K3 and 4C meet (K3 spec :167), not now.
15. **R-02 on the real platform.** Rebuild R-02 (`S4C-node-notes.test.ts:38-48,107-113`) on `createTargetPlatform`
    with notes written through the public routes; the node detail's notes column equals the first `lookup` page read
    through `platform.notes` for the same anchor (NE7: "背后是真实的读写").
16. **Not required:** an HTTP-listener smoke test for the note routes (dispatch-level route tests are the repo's
    established entry).

## 3. Order (suggested; you decide the briefs, files disjoint, at most 3 at once)

1. Shared first, one subagent: item 5's continuity function, item 7's request types, item 13's ownership function (new
   file(s) plus contracts: `note-contracts.ts`, `contracts/work-line.ts` for item 11's variant).
2. Then three in parallel, disjoint files:
   - (A) `note-service.ts`, `note-machine.ts`, `scribe-scope.ts`, `note-tool.ts`: items 2, 4, 8, 12(a), 13's
     scribe-scope caller, 14;
   - (B) `note-read-model.ts`, `note-related-scope.ts`: items 6, 9, 10, 12(b)(c)(d);
   - (C) `src/app/host.ts`, `views/node-detail-reader.ts`, `views/graph-context-reader.ts`, `views/goal-conflicts.ts`:
     items 1, 11, 13's view callers.
3. Then the test items: 12's count tests and 15 (R-02), at most 2 subagents; then close-out (section 4), one subagent.

## 4. Checks (close-out subagent)

- `--maxWorkers=3`: `tests/work-graph/S4*.test.ts`, `tests/work-graph/SP-*.test.ts`, `tests/runtime/S4C-*.test.ts`,
  `tests/app/S4C-*.test.ts`, `tests/work-graph/S3-graph-context.test.ts`, `tests/work-graph/S2C-node-detail-*.test.ts`,
  `tests/runtime/S3-graph-tools.test.ts`, `tests/composition/platform.test.ts`, `tests/architecture/`,
  `tests/record-store/`, the conflict-reader tests if you touch `goal-conflicts.ts`, the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox. Name any other failure. **Do not run the full suite.**

## 5. Rules

- State only through `state/`; no database reads to verify; literal hand-computed expectations; test names start with
  the row id or `RW-<item>`.
- No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted at the end.
- Line budget: the rework should shrink or hold the production line count where items say "merge"; report the net.

## 6. Reply

Under 900 words: FILES CHANGED (production net lines); each item done or not, RED → GREEN; CHECKS with numbers;
UNSPECIFIED (short, with options); subagents (task, time, how many ran at once at most); anything surprising.
