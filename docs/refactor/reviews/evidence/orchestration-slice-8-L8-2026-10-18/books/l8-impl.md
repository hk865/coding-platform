# Task: slice 8 L8 — automatic capture, its request record and retry, and the stale-architecture reminder; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory): the lead branch 8d14dc95 (8A, 4C-2, 8D
and the §10 segment merged; tags `slice-setup`, `slice-base`). This is a NEW session. The spec, this book and the
lead's rulings in §2 are binding; do not make design decisions; report anything undetermined under UNSPECIFIED with the
smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`; **read "How tests reach their state: no hand-written facts" (with "A name does not
change what it is") and "Before you build: what the reworks were about" first; both bind every brief**). Files disjoint
between subagents, every vitest command `--maxWorkers=2`, the close-out runs one vitest command at a time. **Do not end
your turn while a subagent has not reported back.** **Finish within 180 minutes** (the run stops at 190). Finish whole
items; an unfinished item is reported, not half-done. Delete `./.dsh-scratch/` (the directory too) before you end.
TDD as `./.dsh-ref/tdd/` says: one failing test, then just enough code, per row.

## 1. What to read

- Spec `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`: §0.1 告知 5; §1 L7 (with its rule that a
  dependency touched by unknowns is only `unknown`), **L8**, L12; §5.2 AE1 (automatic capture), **AE2**, **A-03**,
  **A-04**; §9, §10, §12 (binding over earlier sections). Decision 79 (`docs/refactor/HANDOFF.md`, top): only the
  current format is read; changing a record's shape needs no migration.
- Your read-through `./.dsh-ref/l8-preread-final.md` and Codex's two checks of this book `./.dsh-ref/l8-book1.out.md`
  and `./.dsh-ref/l8-book2.out.md` (Chinese). Where they disagree on a line number, Codex's has the corrected place;
  the rulings below already answer both checks.

## 2. Lead rulings (answer the read-through's questions 1–11 and Codex's items 1–9; recorded in the spec at merge)

1. **Triggers, detached, on every path.** A trigger fires after a non-replayed success of:
   - **a workspace registration**, once its root is bound in the Host. Both paths register: the settings flow
     (`src/app/host.ts` ~869–888, after `addWorkspaceState`) and the route `src/app/core-routes.ts` ~642; make them
     share one step that triggers after binding (not inside `project-bootstrap-service.ts`).
   - **a formal adoption**, initial or revision (`catalog-service.ts` ~555–579, ~737–765).
   - **a formal check finalized with outcome `PASS`** (`evidence-service.ts` ~1463, result ~1605). The public wrapper
     (`create-platform.ts` ~1213) and the Workflow (`create-platform.ts` ~1570, `workflow.ts` ~1903) both call the same
     `rawEvidence` instance: wrap that one instance's `finalizeChecks` once, where it is built, so both paths go through
     the one notification (no change inside `evidence-service.ts`, no second check).

   The commit observer (`src/composition/commit-observer.ts` ~79) carries only the type and the project (~21), not the
   outcome, so it is not enough alone. The trigger's caller gets exactly the result it gets today. An adoption or a
   PASS reaches every workspace of that project bound in this Host. Precedent for work after a commit:
   `src/app/goal-fan-out-driver.ts` ~139–148, ~568–578.
2. **One driver per Host, serial, coalescing.** A Host-side driver in `src/app/` (next to the fan-out driver) runs at
   most one capture at a time for the whole Host (~27 s and much memory on a large workspace). Triggers for a workspace
   that is already waiting merge into it; a trigger for a workspace whose capture is running queues exactly one more.
   Its work is tracked like the platform's other detached work (`create-platform.ts` ~966–973).
3. **The request record ("失败记一条").** One current record per workspace, rewritten with a new revision:
   `{ workspace, requestSeq, trigger: 'workspace_registered' | 'catalog_adopted' | 'catalog_revised' | 'check_passed'
   | 'startup_retry', requestedAt, status: 'requested' | 'failed', failure: { code, reason } | null }`.
   - **When a trigger is accepted** (before queueing, not when the capture starts), the driver writes it with
     `requestSeq + 1` and `status: 'requested'`, so a queued workspace that never started is still known after a close.
   - **The start snapshot.** When the driver starts a capture it reads the record once: `{ requestSeq, revision }`.
     That one `requestSeq` is both the capture's identity (ruling 4) and its start watermark, passed into the
     observation service with the request; the same snapshot's `revision` guards the failure write.
   - **When the capture fails**, the driver sets `status: 'failed'` and `failure` (the capture's rejection,
     `architecture-service.ts` ~825–842) and keeps `requestSeq`, guarded by the start snapshot's revision. On a revision
     conflict it writes nothing (a newer request exists and is pending anyway); it never re-reads and forces `failed`.
   - **A cancelled capture** (ruling 5) writes nothing.
   - **The watermark in the pointer.** The observation service owns the records (`architecture-service.ts` ~733). At its
     entry, before the underlying capture runs, it fixes the start watermark: the driver's `requestSeq` when given, else
     (a manual capture) the record's `requestSeq` read there, 0 without a record. Its pointer commit (~943–961) writes
     `satisfiedRequestSeq = max(current pointer's satisfiedRequestSeq, start watermark)` under the existing pointer
     revision guard, so a manual capture that started earlier and commits later never lowers it.
   - **Pending is computed, never stored:** `record.requestSeq > pointer.satisfiedRequestSeq` (no pointer → 0). A
     trigger that arrives during a capture therefore stays pending after that capture succeeds.
   - **Writing it goes through the state layer** (AGENTS.md rule 9). The request record's creation, the new request
     and the `failed` transition are state-layer constructors in `src/core/work-graph/state/` (pure: inputs only, no
     clock; precedent `state/task-failure.ts` ~1197 `newTaskReworkRefusalRecord`). Register the type in
     `tests/architecture/state-writes.test.ts`'s protected table (~108) and its decoder in the decode allowlist (~186).
     Shared types go in `src/contracts/`. The commit follows the pointer's precedent (`architecture-service.ts`
     ~943–961: guarded `records.commit` with its own event and encoder); a commit needs an event
     (`record-store/record-codec.ts` ~645), so add one per write (requested / failed) with its codec. **Lead ruling:**
     add `"state"` to the `architecture` submodule's `dependencies` in `docs/refactor/module-target.json` (~67). State
     is the lowest layer, and `configuration`, on the same layer as `architecture`, already lists it.
4. **Request identity.** Each capture the driver starts uses `meta.requestId = auto-capture:<projectId>:<workspaceId>:<requestSeq>`
   (the start snapshot's `requestSeq`), so two workspaces never share a key (the fingerprint includes the workspace,
   `architecture-service.ts` ~787–790). A `requestSeq` starts at most one capture, with the input assembled at that
   start. Any retry (after a failure, a crash or a close) first writes a new request and so gets a new `requestSeq`. A
   key is therefore never reused with a different input (that would be an idempotency conflict, ~800).
5. **Retry and close.**
   - **At Host start**, after the workspaces are bound, every pending workspace bound in this Host gets a new request
     (`trigger: 'startup_retry'`, `requestSeq + 1`) and is queued. Precedent: `src/app/startup-reconcile.ts` ~159,
     candidate reads ~224–366. A pending workspace not bound in this Host stays pending.
   - **The next trigger** of a workspace retries it anyway.
   - **Closing the platform**, in this order: stop the queue, abort the running capture through the driver's own
     AbortController (the capture takes the call's signal, `capture.ts` ~581), then let the platform drain its pending
     work. Today `close()` waits for pending work first (`create-platform.ts` ~1938), so the abort must come before that
     wait. The cancelled capture writes nothing, so its request stays pending for the next start.
6. **Mappings.**
   - **Without an adopted catalog** the capture uses `mappings: []` (`architecture-service.ts` ~147–149, ~244–252,
     ~846–850): file layer only, module layer empty.
   - **With a catalog** the driver builds the mappings from the active catalog exactly as the manual request does
     (`src/ui/views/setup/requests.ts` ~200–209, pins ~208). If that logic lives only in the UI, move it to one shared
     function both call (no second copy).
   - **Context and actor:** as the Host builds them for a capture (`host.ts` ~983), with the Host's system actor.
   - The manual buttons and the `architecture/capture` route stay as they are.
7. **Latest and previous.** The current pointer (`architecture/contracts.ts` ~18–20, ~70–73; written
   `architecture-service.ts` ~943–961) also records `previousObservedRef`: the observation it replaced, in the same
   commit. "按观测时刻排的前一个" is read as that one (captures commit in order under ruling 2; a manual capture commits
   through the same pointer). Observations are never deleted, so the previous one stays readable.
8. **One public read.** A plain route `architecture/observation-state` and a port method return, per workspace:
   `{ current: { captureRef, observedAt } | null, previous: captureRef | null, autoCapture: <ruling 3's record with the
   computed pending: boolean> | null }`. Tests observe triggers, failures and retries through it; bounded polling on
   this read is the wait; no test-only hook.
9. **Moves (pure).** The input is the full node lists of the latest and the previous observation (loaded as
   `architecture-service.ts` ~634, ~683; the stored nodes carry `digest`, `architecture-inspection.ts` ~68).
   - A deleted path (in previous, not in latest) and an added path (in latest, not in previous) are a "可能移动" only
     when their digest is carried by exactly one deleted and exactly one added path. Otherwise nothing is said.
   - This is a different rule from `diffContent` (`workspace-read.ts` ~111, which needs uniqueness across both full
     lists): write it, don't reuse that.
   - Moves are not filtered by the task and not removed from other kinds.
   - No previous observation → no move rows.
10. **What belongs to the task.**
    - **Dependency findings:** from `compareFormalObserved(active catalog, latest)` (`formal-comparison.ts`), the
      `dependency_missing` and `import_undeclared` findings with the task's module at either end. A-03's B→A import is
      the task's.
    - **Ungrouped:** files ungrouped in the latest observation whose longest common directory prefix is strictly longest
      with the task's module among all catalog modules. Measure it in path segments of the file's directory against a
      module path, with at least one segment; a module scores its best path. A tie is nobody's: A-03's `src/new.ts`,
      tied between `src/a/core` and `src/b`, is not listed. Write a new helper next to `pathOwnershipOf`
      (`src/contracts/path-ownership.ts` ~36–63), which does containment only.
    - **No catalog, or a task with no module** → only move rows.
    - **The task's module** is resolved as the assembler does today (`context-assembler.ts` ~593–597).
11. **Rows.**
    - **Order:** 声明的依赖没有 import, import 没有声明的依赖, 新文件没归组, 可能移动; inside a kind by path, then by
      the rest of the row.
    - **Text:** `<种类>：<内容>（<时刻>的观测）`. The contents are:
      - `A→B，<the finding's path>`;
      - `<from> → <to>`;
      - `<path>`;
      - `<old> → <new>`.

      A dependency finding with `certainty: 'unknown'` ends its contents with `，不确定` (spec L7; never shown as
      certain).
    - **Time:** the preparation's clock minus the latest `observedAt`, rounded down: under 1 minute `刚才`, under 60
      minutes `N 分钟前`, under 24 hours `N 小时前`, else `N 天前`.
    - **Limits and empty cases:** at most 10 rows, then one line `另有 N 条架构提醒没列出`. No successful observation →
      one row `还没有观测`. An observation with no row → no section.
    - **A-03's first row** is `声明的依赖没有 import：A→B，src/a/core（3 小时前的观测）`. `formal-comparison.ts` ~169
      gives the module's path, as A-02 shows; the spec's `src/a/core/one.ts` is replaced. The other three rows:
      - `import 没有声明的依赖：src/b/extra.ts → src/a/core/util.ts（3 小时前的观测）`
      - `新文件没归组：src/a/loose.ts（3 小时前的观测）`
      - `可能移动：src/old.ts → src/new.ts（3 小时前的观测）`
12. **Where the rows go.**
    - **Section:** the assembler's reminder section (`context-assembler.ts` ~658–687, ~990–1000, ~1024–1053; render
      ~210–320, sort by key ~217; clock ~945), through a new assembler dependency that reads ruling 8's state, the
      active catalog and the node lists. AgentRuntime → WorkGraph is allowed (`module-target.json` ~185).
    - **Order and caps:** the keys keep ruling 11's order. The 10-row cap is this section's own; the global budget and
      its omission line (`reminders: 另有 N 条，用‘看’读`) stay as they are.
    - **Reads:** one preparation loads each of the two observations at most once and shares the latest between the
      comparison (`architecture-service.ts` ~1148) and the moves. Report the reads per preparation.

## 3. Tests (through public steps; memory and SQLite each, unless a row says otherwise)

**How the tests work:**
- Expected values are hand-computed literals.
- Captures are real: temporary workspaces with real files, and a second capture after changing files.
- Preparation is the public `createExecutionPreparation.prepare`, stopped before the model is called. Its clock is set
  from the public `observedAt` (for example + 3 h 5 min); the capture's own clock is the real one
  (`architecture-service.ts` ~869).
- **A failed capture** must really fail: move the workspace root away for the failing step and back before the retry.
  The sandbox resolves the root with `realpath` first (`workspace-sandbox.js` ~115), and the failure becomes a
  rejection (`access.ts` ~102). A scan fault does not work: it becomes failed coverage and the observation still saves
  (`capture.ts` ~819). Never write a failure record by hand.

**Rows:**
- **A-03** as ruling 11: four rows with the 3-hour time. Also:
  - the same with twelve rows → ten rows and `另有 2 条架构提醒没列出`;
  - an `unknown` dependency finding → its row ends `，不确定`;
  - no observation → `还没有观测`;
  - an observation with nothing to say → no section.
- **A-04**:
  - Each of registration (both paths), first adoption, a revision and a PASS (through the Workflow and through the
    public finalize) yields one capture, seen through `architecture/observation-state`.
  - A replayed adoption and a replayed finalize start none.
  - Before any adoption the module layer is empty, and comparing that first observation with the later catalog gives
    the uncovered files.
  - A failed capture leaves `status: 'failed'` and `pending: true`, and the reminder still uses the last successful
    observation. The next Host start captures and clears pending; separately, so does the next trigger.
  - A trigger during a running capture of the same workspace yields exactly one more capture, and that request stays
    pending until it runs.
  - A manual capture that starts before an automatic one and commits after it leaves `satisfiedRequestSeq` at the
    higher value (not pending). Hold the manual capture with a gate on a dependency the platform already takes by
    injection. If no such dependency can hold it, test the `max` rule as a pure test and say so.
  - A close with a queued request leaves it pending; the next start captures it.
  - The manual capture route works as before.
- **Old tests:** check each test the read-through and Codex named: R3d (it counts `captureSourceChanges`; the
  observation now calls `captureObservation`), R3d-R3g, R5a, R6-host (roots pre-bound, ~124), A2 (PASS ~411), and
  `tests/composition/WP2-wiring.test.ts` ~543 (the omitted-reminder count; "还没有观测" or new rows change it).
  - Re-count it by hand.
  - Change an expectation only where the automatic capture or the new rows are the cause, and say so per file.
  - Never loosen an assertion.

## 4. Size, checks, reply

Estimate 1,000–1,300 production lines (`src/`, `scripts/`); report the real count and why if over. Checks: the changed
and new test files (exact lists, one vitest command at a time, `--maxWorkers=2`), typecheck, check:architecture,
build. No real model calls, no git writes, never ports 3080/3099/44797.

Reply under 1,000 words: per ruling and per test row RED → GREEN, the files with lines added/removed, the changed old
tests and why, the way the failure test fails, the reads per preparation, the checks with numbers, UNSPECIFIED.
