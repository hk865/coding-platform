All three read-only verification subagents have reported. Working tree is clean (`git status --short` prints nothing).

## 1. Unclear

1. **Spec §2 (L583–663)** names the new interfaces (`ActivityReadPort`, `TaskTimelineReadPort`, `RunActivityPort`) but no factory/export names for `activity-read-model.ts`, `track-read-model.ts`, `task-state-timeline.ts`, `run-activity-service.ts`, `activity-backfill.ts`; spec L576–578 says only "工厂". Book §6 groups F/R/B/S and `create-platform.ts` must import concrete names, and L-interfaces makes names binding. I would assume `createActivityReadModel`, `createTrackReadModel`, `createTaskStateTimeline`, `createRunActivityService`, `createActivityBackfillService` and stop for confirmation.
2. **Spec §2:695** names events `RunActivityRecorded`/`ActivityRecordingStarted` but gives no payload or schema id; book §6 Group F must write "两 records, two events" in `run-activity-codecs.ts`. I would copy the nearest event-codec convention with no extra fields.
3. **Book §4 L-fixtures:107,110** says "the scenario budget has `timeoutMs: null`" and "the platform `now` reads the same `Date`"; `openHostScenario` options (tests/scenarios/harness.ts:802–817) expose neither, the budget is the hardcoded `AG2B_RUNTIME_BUDGET` (harness.ts:702,720; `timeoutMs: 60000`, tests/helpers/AG2b-collaboration-fixture.ts:86), and the platform clock is the literal `now: () => '2026-10-06T00:00:00.000Z'` (harness.ts:746). I would build a new `tests/helpers/S2B-*-fixture.ts` that constructs the Host/platform directly with a Date-following `now` and null-timeout budget.
4. **Spec §2:551 / L6:212** expose `readRunActivityFacts(...maxPages?)`, but 2B-41 must inject the page cap through the Workflow backfill path and `countRunActivity` takes only `{runRef}` (spec L557–558). L17:430 (`ACTIVITY_READ_RECORD_CAP`, 2B-27) and §10:941 (`ACTIVITY_BACKFILL_BATCH_RUNS`, 2B-17) likewise have no named injection point. I would add an override parameter to each factory/dep bag.
5. **Spec L1:146** says `unresolvedCalls` "和 `unresolvedToolCallIds` 对同一个窗口给的个数相同", but `unresolvedToolCallIds` takes a reduced `RunState` (kernel-turn-facts.ts:81), not a window. I would compute it from the raw window as L1 first defines.

## 2. Contradictions

1. **Book §4 L-fixtures:108–109** "Reuse … `blockingTool`, `controlledTool`, `restartedHost` … do not build new versions": all three are file-local/unexported (tests/runtime/A2-reconcile-runtime.test.ts:129/92, tests/runtime/R4-control-runtime.test.ts:93), and spec §5.3:810–811 lists those files as "run and confirm", not editable under L-scope.
2. **Spec §5.3:806** stub importers vs code: `tests/work-graph/WP2-context-extensions.test.ts:38` and `tests/helpers/S2A-window-fixture.ts:19` import `src/core/work-graph/tasks/executed-files-stub.ts` but are not listed; listed `S5-decision-queue.test.ts:17` is really `:18`, `S5-notices.test.ts:13` is `:14`. Book §3:64 ("exactly those edits") plus §4 L-scope:83–88 forbid the two needed edits.
3. **Spec §5.3:807 / book L-reach:115** "五个 route Body/Response aliases": each plain route has both aliases (`PlainBody`/`RouteResponse`, core-http-types.ts:239–240) and the allowlist is one entry per alias (24 = 12 routes × 2). Five routes need 10 entries, not 5.
4. **Spec §0.2 F22:91** "RecordStore 今天只有等值的 `lookup`" no longer holds after 2A: `RecordOrderedLookupPort` exists (src/core/record-store/lookup-ports.ts:56), implemented at sqlite-record-store.ts:688 and in-memory-record-store.ts:487.
5. Other §0.2 drift: F23:92 `create-platform.ts:26,660` — call is `:671`; F25:94 `workflow.ts:1890–1910` is `run_check`/`finalize_checks`, Session maintenance is `:2006–2079`; F36:105 and F14:77 cite `tests/scenarios/harness.ts:665`, real clock `:746`; spec:809 names `tests/work-graph/A2-reconcile-classifier.test.ts`, which does not exist (only tests/composition/…-platform.test.ts). Spec header:10 and §0.4:438 still say "2A … 没施工；K 片 A 在施工", false here (`readTurnBounds` session-operations.ts:1015; `lookupOrdered` lookup-ports.ts:56).

## 3. Cannot build as written

1. §5.3 stub move (2.2): the move only compiles after editing the two unlisted importers.
2. **Book §4 L-fixtures:108–109** reuse of the three unexported helpers.
3. **L7/L8 scenario span (2B-16/17/19)** cannot be built through `openHostScenario` because `endedAt`/`since` come from a fixed clock (harness.ts:746; AG2b-collaboration-fixture.ts:266, `AG2B_AT` :57); 2B-05/41 need long simulated spans.
4. **2B-41** needs a `maxPages` seam unreachable from `backfillActivityRange`/`countRunActivity` (spec L557).
5. **Book §6 Group F** joins codecs into `EXECUTION_ENTRY_RECORD_SCHEMAS` (§5.3:815, `persistence/execution-entry-codecs.ts:841`), a file absent from spec §6:817–834 while L-scope:83–88 says only §6 files may change; I read "the §5.3 edits" as allowing it.
6. **Wave 3 ordering (book §6):** V must import S's `views/task-state-timeline.ts` factory into `create-platform.ts`/`core-routes.ts` (L15:691), and B's 2B-20 needs V's `activity/backfill` route (L8:271); V cannot finish before S, B not before V. Owner table create-platform.ts:1475–1478 has no `activity`/`timeline` yet.

## 4. Missing

1. Factory names (1.1).
2. Event payloads/schema ids (1.2).
3. Injection points for `maxPages`, `ACTIVITY_READ_RECORD_CAP`, `ACTIVITY_BACKFILL_BATCH_RUNS` (1.4).
4. Exported `blockingTool`/`controlledTool`/`restartedHost` (A2-reconcile-runtime.test.ts:129/92; R4-control-runtime.test.ts:93) — a new S2B fixture must copy them, which contradicts "do not build new versions".
5. The Workflow backfill port/method home: `ports.ts` has no activity member and no analogue (ports.ts:168,214–215); spec §2:680–683 shows bare signatures without their port.
6. For §5.3:815 BE1r "另在同一个存储上建 activity 的读取", `B2-runtime-fixture.ts` exposes no store handle and its registration must not change; the build path is unstated.
7. Timeout is covered: book L-fixtures:112 gives `S2B_SLOW_TIMEOUT_MS = 1_800_000` (cf. tests/helpers/S2A-queue-fixture.ts:30).

## 5. Size (book §6 groups)

- **F — large:** contracts, 10 indexes across 6 codec files, `finalizedAt` across 4 files (VR-07 submit/preserve/validate), stub move, §5.3.
- **T — medium:** one pure function and 3 rows, but the `agentEventSchema`-validated Kernel-record fixture with 10 L1 shapes is the real cost.
- **R — large:** observer RUN-07/08 pending items and cancellation, startup reconcile/stopPaused, same-commit WorkGraph write, composition, 5 entries, without flipping many old observer/control tests.
- **B — medium/large:** backfill service, candidates, Workflow port, host start-of-recording/auto/leaseGated; hard 2B-41/44.
- **V — large:** calendar, track, per-run reads, real `goal-executed-files` reader, 5 routes + 10 allowlist entries, composition, SC02.
- **S — medium:** one view and 3 rows, but subtle folding plus many plan/pause/anomaly fixtures.
- **Wave 4 integration — large.**

## 6. Grouping

- The cut matches spec §7's G1→G2→(G3,G4) and keeps files disjoint on paper.
- Real serialization stays inside waves: T waits on F's `run-activity.ts` (book §6 acknowledges); wave 3 is B→V→S (V needs S's factory for L15:691; B's 2B-20 needs V's route per L8:271).
- Same-wave shared file: `src/composition/create-platform.ts` (plus `core-routes.ts`, `core-http-types.ts`, `src/ui/api/routes.ts`). V owns them, but S's `tasks/timeline` route and B's `activity/backfill` route both require edits there, so "groups at the same time write disjoint files" holds only nominally.
- My cut: wave 3 runs B, V-readers (`activity-read-model.ts`, `track-read-model.ts`, `goal-executed-files-reader.ts`), and S in parallel; then one wave-4 wiring group owns all route/composition wiring (`create-platform.ts`, `core-routes.ts`, `core-http-types.ts`, `routes.ts`, allowlist, SC02, stub replacement) after B/V/S report. That breaks the cycle and satisfies "a shared interface is finished and reported before the groups that use it start."

`git status --short` prints nothing; no file was changed.