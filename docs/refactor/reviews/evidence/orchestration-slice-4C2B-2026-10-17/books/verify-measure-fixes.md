# Verification of the measurement fixes (workflow wf_42c42436-9b3, four Claude verifiers, 2026-10-17)

One verifier per fix, each told to refute. Line numbers are tag s4c2-b4. The lead rulings in the rework book settle the open points.

## Fix 1 — heartbeat to-dos via userReasonFacts (lens: semantics) — partly

Most of the claim holds. The to-dos use only two fields from checkHeads: anchorStatus and anchorRetiredReasons. userReasonsOf needs only state, userConfirmed, userWritten and primaryAnchorRetiredNonFile. Nothing else in note-scribe-todos.ts reads the check: the overridden-understanding rule, immediate and updateDueTodos all come from the shared reader. B's userReasonFacts returns exactly the NoteUserReasonTargetV1 map the to-dos build by hand.

"Keeps behaviour" is not strictly true. Three reachable differences follow from the code:

(1) A file-anchored target whose symbol went missing. The to-dos (A) treat symbol_missing as a non-file reason; B treats it as a file reason. B matches §11.6, the 4C-1 reading (facts book R8, note-service comment 1050-1053) and the guard and card, which already use B's function. So the fix corrects a real A bug where the to-dos count a note the guard forbids the scribe to accept. No test pins it, and the 20k dataset cannot show it: it has 133 file targets and none with a symbol.

(2) Fewer failure paths. The check's own reads go away (conflict and quota derivations, hints, file observation), so fewer calls end as `unavailable`. A's result also depended on the check's file and symbol budgets (256 files, 20 symbol rechecks); B's does not.

(3) Possible regression in a project with two workspaces. B's task branch goes through readAnchorGoalFacts, which returns forbidden for a goal in another workspace. A relation target only has to share any anchor key (no workspace test), and a project can register several workspaces. So the Host's per-workspace to-dos could become permanently `unavailable` where the check works today. This is inferred from code, not tested.

No existing test changes result; none pins A's rule. §13 item 2 (spec line 1017) still names the check as the consumer of the to-dos' reads, so it needs a lead post-note.

### Evidence

- `src/core/work-graph/notes/note-scribe-todos.ts:128-143`: The ONLY use of the check: checkHeads over the target heads, then only item.anchorStatus and item.anchorRetiredReasons. retiredNonFile = retired && reasons.some(r => r !== 'file_deleted'), so symbol_missing counts as NON-file. checked.value.understanding, currentEligible and conflicting are never read.
- `src/core/work-graph/notes/note-scribe-todos.ts:146-167, 217-239`: The pending count uses userReasonsOf over this head's own targets, then pendingUnderstandingOverridden with anchors.pointers and anchors.heads from the shared reader. updateDueTodos and immediate use row.anchors, row.triggers, row.claimedArchiveKeys and foldInputOf. None of these use the check (sub-question c).
- `src/core/work-graph/notes/note-scribe-todos.ts:181-193`: The target understanding anchors join the shared reader only so the check's understandingPointers seeding works (comment 181-183). After the fix they serve nothing; dropping them keeps one batch and only shrinks it.
- `src/core/work-graph/state/note-machine.ts:102-109, 150-172`: NoteUserReasonTargetV1 = state, userConfirmed, userWritten, primaryAnchorRetiredNonFile. userReasonsOf reads nothing else, which confirms the claim's 'rule only needs' part.
- `src/core/work-graph/notes/note-service.ts:866-877, 917-931`: reasonFactsOf / userReasonFacts build the same NoteUserReasonTargetV1 per head from head fields plus primaryAnchorRetiredNonFile. Plan windows are seeded under the same key planWindowOf uses. No head reads.
- `src/core/work-graph/notes/note-service.ts:1049-1085`: primaryAnchorRetiredNonFile: file, goal and project return false with no reads ('File retirement (deleted path, missing symbol) is a file reason'). Stage goes through planWindowOf plus stageContinuityOf. Module, interface and task go through resolveNoteAnchors(skipCandidates); anchor_not_found counts as retired.
- `src/core/work-graph/notes/note-service.ts:1604-1622`: The disposition guard already computes user reasons through userReasonTargetsOf → reasonFactsOf, i.e. B's rule. Today the to-dos (A's rule) and the guard can disagree.
- `src/core/work-graph/views/note-views.ts:664-746`: The check's anchorStatusOf: module → module_removed; interface → interface_removed; task → task_ended (plan null → live); stage → stage_not_in_current_plan or unchecked; file → file_deleted; main-anchor symbol recheck missing → symbol_missing (733-736). File and symbol work is budgeted (unchecked once over budget).
- `src/core/work-graph/notes/note-anchors.ts:692-764`: B's resolveOne: a missing module or interface in the catalog, or a null catalog, gives not_found → retired. A task with plan null, a missing task, or a cancelled/superseded task is retired. These differ from the check only where no active plan or no catalog exists, which public flows cannot produce for an already-anchored target (an active plan is null only at goal creation: goal-machine.ts:97).
- `src/core/work-graph/notes/note-anchor-facts.ts:63-78`: readAnchorGoalFacts returns forbidden when goal.workspaceRef.workspaceId !== ctx.workspaceId. The Host calls the to-dos with a workspace-bound ctx (host.ts:1098-1101, 1313). The check's currentPlan (note-views.ts:407-419) has no workspace test.
- `src/core/work-graph/notes/note-service.ts:1243-1248`: The write's relation gate requires only one shared anchor key with each target; there is no workspace test. Together with registerWorkspace into an existing project (project-bootstrap-service.ts:617-680), a W2 pending note can have a W1 task-anchored target.
- `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:875, 885, 887, 898-899, 913`: §11.5: count only notes with an empty userReasonsOf, including quota_full and overridden pending understandings; cancelled goals excluded. §11.6: ONE function decides the card, the machine guard AND the reminder count. contradiction applies only if the target's main anchor is not retired for a non-file reason (L23). §11.7 heartbeat: target facts = one batched read of the relation targets.
- `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:263, 1017`: L23 lists six reasons, two of them file-related (file_deleted, symbol_missing). §13 item 2 says the to-dos' target understanding anchors join the shared read and '读到的触发交给核对' (the triggers read go to the check). §13 wins on conflict, so the fix needs a lead post-note there.
- `docs/refactor/reviews/evidence/orchestration-slice-4C1-2026-10-17/books/facts/facts-human-filter.md:65, 77`: R4: non-file reasons only. R8 names the non-file reasons as task_ended, module_removed and stage_not_in_current_plan (interface_removed is missing, apparently an oversight), so symbol_missing is a file reason. B's rule matches; A's does not (sub-question b).
- `tests/work-graph/S4C2-read-counts.test.ts:270-318`: The only readScribeTodos test where the check runs: pointer 1, pointedHead 1, targetHead 1, trigger 2, status only. It stays green under the fix: B's stage path makes no NoteHead, CurrentPointer or TaskReduction/TaskRequeue readMany. It does not pin plan-window reuse.
- `tests/app/S4C2-scribe-reminders.test.ts:72-109`: D-10 and D-15 (and the Host D-03/D-18/item 2 runs) use pending notes with no relation targets, so targetHeads.size === 0 and the check never runs. Unchanged under the fix.
- `tests/work-graph/S4C2-D-rows.test.ts:191-215, 217-272`: D-12's to-do read has no targets, so it is unchanged. D-13 pins stage_not_in_current_plan as non-file, but only for the card (B path). No test pins symbol_missing for user reasons in any path.
- `src/core/work-graph/model/note-contracts.ts:178-185`: understandingTriggers on checkHeads is passed only by the to-dos (seeded at note-views.ts:1302-1310). After the fix it is dead.
- `src/composition/create-platform.ts:1373, 1395-1396, 1463`: noteWrite (with userReasonFacts) is built before noteScribeTodos, so the wiring change is one line. No test constructs createNoteScribeTodos directly.
- `~/dsh-work/measure-4c2/probe/verify-semantics/target-anchor-facts.mjs`: Read-only stats on the dataset: 1 workspace, 0 goal-less pending notes, 244 targets all current, 133 file-anchored targets, 0 with a symbol. So the 'identical digest' emulation cannot exercise divergences (1) or (3).

### Fix

Smallest correct version:

1. note-scribe-todos.ts
   - Deps (45-48): replace `check: NoteHeadCheckPort` with `userReasonFacts: NoteUserReasonFactsPort['userReasonFacts']`, using the type exported at note-service.ts:410-414.
   - Lines 109-144: keep the `targetHeads.size > 0` guard. Inside it, call:
     `const facts = await deps.userReasonFacts(ctx, [...targetHeads.values()], anchors.map(row => ({ goalId: row.goalId, window: { status: 'ready', goal: row.goal, plan: row.plan, readThrough: row.readThrough } })));`
     If `facts.status !== 'ready'`, return `{ ok: false, reason: facts.reason }`. Otherwise use `facts.value` as `targets`. The loop at 146-167 stays as it is.
   - Remove the now-unused imports: NoteHeadCheckPort, NoteUpdateDueTriggerV1, PlanRevisionSnapshot.
   - Delete targetAnchorKeys (187-192): only the check's seeding needed them. Keep pendingAnchorKeys.
   - Update the header comment (20-24).

2. note-update-due.ts
   - Carry `readThrough` from the window into GoalWindow (146-152, 168) and into GoalUnderstandingAnchorsV1 (103-116, 201), about 3 lines.
   - Alternatively pass `readThrough: null` with a comment saying primaryAnchorRetiredNonFile reads only status, code and plan.

3. create-platform.ts:1463
   - Change to `createNoteScribeTodos({ records: backend.records, userReasonFacts: noteWrite.userReasonFacts })`.

4. Delete the now-dead `understandingTriggers` input of checkHeads: note-contracts.ts:178-185 and note-views.ts:1302-1310.

5. Spec (lead): add a post-note to §13 item 2. It should say:
   - the to-dos take target facts from the note service's userReasonFacts, the same function the card source and guard use;
   - the "non-file" reasons of §11.6/L23 are task_ended, module_removed, interface_removed and stage_not_in_current_plan; file_deleted and symbol_missing are file reasons.

6. Lead decision, together with or before this fix: should a cross-workspace task target make the user-reason facts forbidden? The report's goalFacts hook would feed the task branch from planWindowOf, i.e. readGoalPlanWindow, which has no workspace gate. That would remove both the +3-reads-per-task excess and the cross-workspace divergence, but it also changes the card and guard behaviour for such targets.

### Tests

All tests go through public entries and run on both memory and SQLite (it.each(KINDS)), using the S4A fixture. Its src/a/x.ts holds `export const a = 1;` (tests/helpers/S4A-note-fixture.ts:116).

T1 — red today, green after the fix: file reason on a missing symbol.
- The user writes U, a general note on {kind:'file', path:'src/a/x.ts', symbolRequest:{language:'typescript', name:'a'}}; it is accepted.
- An executor Run writes P on {kind:'file', path:'src/a/x.ts'} with a different topic and contradicts:[U]. Expect pending_review with reason 'contradiction'.
- Rewrite src/a/x.ts to `export const renamed = 1;` (recipe from S4B-note-symbol-recheck.test.ts:73-82).
- Precondition: readNote(U) gives anchorStatus 'retired' and reasons containing 'symbol_missing'.
- Expected by hand: U is accepted, user-written, and its main anchor is a file, so this is a file reason. The contradiction stays live, so readScribeTodos({goalIds:[g]}) for g has pending []. Today it returns [P@1].
- Agreement check: a scribe's reviewNote accept on P is rejected forbidden ('a note with a user reason is accepted or rejected only by the user', note-machine.ts:418-421).

T2 — green before and after; guards the seeded-window stage path.
- Use D-13's setup (S4C2-D-rows.test.ts:217-257), but give the agent note contradicts:[stageUserNote] only (no replaces).
- Drop the stage.
- Expected: the to-dos for g have pending == [P'@1]. stage_not_in_current_plan is non-file, so no user reason remains.

T3 — read counts; red today.
- Extend createCountedScribeFixture in S4C2-read-counts.test.ts so it also counts `lookup` by index name and `readMany` by aggregate type.
- Data:
  - g: a goal understanding (so a pointer exists);
  - user-written targets on goal:g, on stage s1 and on module A1;
  - one agent pending note sharing those keys and contradicting all three.
- Hand-computed counts for one readScribeTodos({goalIds:[g]}) after the fix, with every bucket under 200:

  | Read | After the fix | Today |
  | --- | --- | --- |
  | s4-note-by-anchor-0..4 lookups | 0 | 5 per distinct target anchor key |
  | s4-note-by-review-status lookups | G+1 = 2 | 2 + 4 for the quota buckets |
  | CurrentPointer readMany | 1 | |
  | NoteHead readMany | 2 (pointed heads + target batch) | |
  | PlanRevision readMany | 1 (only the shared reader's window; the stage target reuses it) | |
  | ArchitectureBaseline/Catalog readMany | 1 | |

  The `pending` result for g is [], since all three targets are live and user-written.

T4 — to settle risk (3).
- Register a second workspace into the same project.
- Data:
  - a W1 user-confirmed note on task:gW1/t1 with extra anchor module:A;
  - a W2 agent note on module:A that replaces it (pending).
- Call readScribeTodos with the W2 Host ctx. Assert whatever the lead rules: ready with W2's count, or `unavailable`.

### Risks

- Behaviour change, not covered by any test: a user-relevant target anchored to a file whose symbol is missing. After the fix the pending note stops counting as a scribe to-do, because it now has a live 'contradiction' or 'user_note_replaced' reason. This is the spec-correct direction, but it is a change.
- Possible regression in a project with two workspaces. B's task branch returns forbidden (note-anchor-facts.ts:76-78) for a target anchored to another workspace's goal, so that workspace's Host to-dos become `unavailable` on every heartbeat. Today the check returns a result. The card source and the guard already behave this way in B.
- §13 item 2 (spec line 1017) still describes the to-dos' reads as feeding the check. Without a lead post-note, the code and the spec disagree.
- The fix alone does not bring the heartbeat within the §11.7 budget. Task-anchored targets still pay readAnchorGoalFacts (3 calls each; +135 in the 20k data), and stage targets of goals outside goalIds read their own plan windows.
- The shared reader's rows do not carry readThrough. Seeding windows with readThrough: null is harmless today, because only status, code and plan are read (note-service.ts:1062-1068), but it puts a made-up value into a per-call cache.

### Open

- Lead ruling needed: is symbol_missing a file reason for §11.6? B and 4C-1 say yes (note-service.ts:1050-1053; facts book R8); A says no. This report assumes yes. Settle it in a spec post-note with T1.
- Lead ruling needed: should a target anchored to another workspace's goal make the user-reason facts forbidden or unavailable (B today), or be computed from the plan window without the workspace gate? Settle with T4 on the merge tree before deciding whether the goalFacts hook goes in with this fix.
- Not verified by running: the claim that T3's PlanRevision count is exactly 1 assumes readGoalPlanWindow does not re-confirm in a quiet store (sameCursor, plan-readers.ts:979-984). The first T3 run settles it.
- Optional, not required for correctness: read target ids only from entries in pendingBuckets, so cancelled goals' notes' targets are neither read nor able to fail the call. Today both A and the fix read the targets of every bucket.

## Fix 2 — the plan-window hook for task targets (lens: correctness across callers) — partly

The diagnosis holds and I measured it. On the reason-facts path, primaryAnchorRetiredNonFile calls resolveNoteAnchors once per target (note-service.ts:1079-1081). resolveNoteAnchors keeps its goal cache only for that one call (note-anchors.ts:496-514), so every task-anchored target goes through readAnchorGoalFacts: readGoal, then readGoalPlanWindow (which reads Goal + PlanRevision). That is Goal, Goal, PlanRevision per target, and call.planWindows is never consulted.

I emulated the fix in memory over the 20k dataset (verify-goalwindow.mjs; repo untouched, ledger stayed at 66409 events):
- heartbeat: 2254 (current) → 762 (fix 1) → 627 (fix 1 + this hook), with the same to-do result digest and identical per-target facts with and without the hook;
- dispose/apply shape (empty call cache, all 244 targets): 182 → 107, identical facts. The 8 goals that have both stage and task targets share one window;
- seeded card-source/heartbeat shape: 152 → 17;
- other-workspace ctx: forbidden with the same reason in both modes;
- missing-goal ctx: same facts in both modes.

The proposed fix only survives in a narrower form than "the same pattern as catalogModuleFacts":
(1) It must be wired at the reason-facts call site only, like skipCandidates. anchorFactsOf(call), where catalogModuleFacts lives, is also the write path's facts object (note-service.ts:1123). There the hook would drop one Goal read per write and turn the frozen RW-12a (12→11) and RW-12b (17→16) red (S4C-write-read-bounds.test.ts:77-85, :169-181). The §11.7 write row also says the 4A write path is unchanged (spec :915).
(2) The window has to be fed into readAnchorGoalFacts, not replaced by a pure projection. A window not_found is ambiguous (missing Goal vs dangling or foreign plan, plan-readers.ts:973-981), so readGoal must still disambiguate. The project/workspace forbidden checks and the agent's bound-plan read also have to stay (note-anchor-facts.ts:60-90).

No rule needs the removed reads, and no guard or CAS uses goal/plan pins: the write commit guards only note records (note-service.ts:1444-1495), finishDisposition guards only heads and the pointer (:704-774), and the card pins only the head and pointer (note-decision-source.ts:83-87). §12.7 and §11.7 explicitly require one plan window per goal per call (spec :979, :907, :914). The heartbeat part of the saving only exists after fix 1: today's heartbeat goes through check.checkHeads (note-scribe-todos.ts:128) and never reaches primaryAnchorRetiredNonFile. The card source and the disposition/apply guards pay the re-read today.

### Evidence

- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-anchor-facts.ts:53-72`: readAnchorGoalFacts reads readGoal (63), then readGoalPlanWindow (67), which itself reads Goal + PlanRevision: 3 calls per invocation. The leading readGoal exists only to tell a missing Goal (not_found) from a dangling or foreign active plan (unavailable), per the comment at 60-62 and the header at 13-14.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-anchor-facts.ts:73-90`: Project and workspace forbidden checks on window.goal, and the bound-plan read for an agent's own goal. A hook must keep all three, so it cannot be a pure projection like catalogModuleFactsOf.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-anchors.ts:494-514`: The goalPlans cache lives inside a single resolveNoteAnchors call. Line 501 always calls readAnchorGoalFacts(deps.records, ...); nothing in NoteAnchorFactsDeps (45-64) can carry a plan window.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-anchors.ts:752-760`: Task branch: current === null or task missing gives notFound (so primaryAnchorRetiredNonFile reports retired); a cancelled/superseded task sets anchorEnded. Both are pure functions of the plan snapshot, so feeding the same window cannot change them.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-service.ts:1056-1085`: primaryAnchorRetiredNonFile. Stage targets already use planWindowOf(call) (1062) and map a not_found window to retired (1064). Task targets call resolveNoteAnchors per target (1079-1081) with { ...anchorFactsOf(call), skipCandidates: true }, which bypasses call.planWindows. Goal/project/file anchors return early (1058), so only task anchors pay.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-service.ts:989-997, 1004-1013`: The precedent: anchorFactsOf(call) wires catalogModuleFacts over a per-call catalog window. planWindowOf memoizes the Goal→Plan window promise per call, keyed projectId+goalId.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-service.ts:1089, 1122-1123`: writeNote also uses anchorFactsOf(call). Wiring the hook there changes the 4A write path's reads (Goal, Goal, PR, PR becomes Goal, PR, PR).
- `D:/cxt/s4c2b-measure/tests/work-graph/S4C-write-read-bounds.test.ts:77-85, 169-181`: Frozen counts that assert the old write path: RW-12a readMany 12 with 'anchor facts 5 (Goal, Goal, PlanRevision, PlanRevision, architecture)', and RW-12b readMany 17. A hook in anchorFactsOf turns both red on memory and sqlite (12→11, 17→16). Wiring at the 1081 call site leaves them green.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-service.ts:917-931, 962-968`: userReasonFacts seeds call.planWindows with the caller's windows under the same key planWindowOf uses. planWindows are per call and deliberately not shared across the queue attempt (962), unlike catalog windows (951-958).
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-service.ts:1539, 1612; 1702-1704`: dispose and applyNoteDecision each start a fresh newNoteCall() with empty planWindows. With the hook, the window is read lazily once per goal during the decision, still before the commit, so the guard's freshness is unchanged.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-service.ts:704-774, 1444-1495`: No Goal or PlanRevision guard exists in finishDisposition or the write commit (guards are note heads, versions and pointer only). Sharing one window per call weakens no CAS.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-decision-source.ts:83-87, 117-123, 144-159`: Card pins are head + pointer only. readNoteDecisions and readNoteDecision always seed the head's goal window (status 'ready') into userReasonFacts, so a same-goal task target would read nothing; today it pays 3.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-scribe-todos.ts:128-129`: Today's heartbeat takes the check path, not primaryAnchorRetiredNonFile, so its +135 appears only after fix 1. The shared reader's rows carry goal + plan without readThrough (note-update-due.ts:154-168, 201), which is enough for the hook.
- `D:/cxt/s4c2b-measure/src/core/work-graph/tasks/plan-readers.ts:969-989`: readGoalPlanWindow returns readGoal's not_found unchanged (973-974), plus not_found for a dangling plan (977-978) and for a plan of another goal (979-981). A window not_found is therefore ambiguous and needs the readGoal fallback.
- `D:/cxt/s4c2b-measure/src/core/work-graph/architecture/catalog-service.ts:810-833`: readCatalogModuleFacts = checks + readCurrentCatalogWindow + pure catalogModuleFactsOf. It is count-neutral on the write path and has no not_found ambiguity, so it is not the same shape as the goal case.
- `D:/cxt/s4c2b-measure/docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:907, 914, 915, 977-979`: The rules the fix enforces: C(k) plan window 2–3 per goal with 单次调用里每个目标只读一次 (each goal read once per call); the card source reads each goal's plan and catalog once (单次调用缓存, single-call cache); §12.7 一次调用里，一个目标的计划窗口只读一次 (one plan window per goal per call) with caches living for one call only; and the write row stays the 4A 写入路径 (4A write path, unchanged).
- `~/dsh-work/measure-4c2/probe/verify-goalwindow/verify-goalwindow.mjs (output out.json):-`: In-memory emulation of the narrowed fix (call-site hook, window-first readAnchorGoalFacts with readGoal on not_found). Heartbeat: base 2254 / fix1 762 (Goal 191, PR 146) / fix1+fix2 627 (Goal 101, PR 101); result digest b8bdfa3e... in all three; facts digest 90b9b7f9... identical. Targets: 244, of which 45 are task-anchored on 38 goals; 16 are stage-anchored on 15 goals; 8 goals have both; 0 task targets are retired. emptyWindows 182→107 (Goal 105→45), seededWindows 152→17, otherWorkspace forbidden in both modes (3→2), missingGoalProject 61→91 with 45 disambiguations, equal facts. Ledger stayed at 66409 events.
- `D:/cxt/s4c2b-measure/src/core/work-graph/views/note-views.ts:681-687`: Pre-existing difference not caused by claim 2: the 4B check treats a task anchor in a goal with no active plan as live, while the service's task branch treats it as retired (note-anchors.ts:755 → note-service.ts:1083). Fix 1 moves the heartbeat to the service semantics.

### Fix

Smallest correct version, about 18 lines in three files. The default path of readAnchorGoalFacts stays byte-identical in reads, so the write path, the read model's anchorExistsNow and RW-12a/b are untouched.

1) src/core/work-graph/notes/note-anchor-facts.ts:53-67. Add a last optional parameter `windowOf?: () => Promise<GoalPlanWindow>` (import type GoalPlanWindow from '../tasks/plan-readers.js') and replace lines 63-67 with:
```ts
let window: GoalPlanWindow;
if (windowOf === undefined) {
  const goalRead = await readGoal(records, goalRef);
  if (goalRead.status !== 'ready') return goalRead.code === 'not_found' ? { status: 'not_found' } : goalRead;
  window = await readGoalPlanWindow(records, goalRef);
} else {
  window = await windowOf();
  // A shared window's not_found may be a dangling plan; only a missing Goal is not_found.
  if (window.status !== 'ready' && window.code === 'not_found') {
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return goalRead.code === 'not_found' ? { status: 'not_found' } : goalRead;
  }
}
```
Keep 68-96 unchanged: the unavailable mapping, the project and workspace forbidden checks, and the bound-plan read.

2) src/core/work-graph/notes/note-anchors.ts:45-64. Add to NoteAnchorFactsDeps:
`goalPlanWindow?: (ctx: CoreCallContext, goalId: string) => Promise<GoalPlanWindow>;`
with a comment saying it is set only on the reason-facts path, like skipCandidates, and that absent keeps the fresh reads. At :501 pass:
`deps.goalPlanWindow === undefined ? undefined : () => deps.goalPlanWindow!(ctx, goalId)`.

3) src/core/work-graph/notes/note-service.ts:1081. Change it to:
`{ ...anchorFactsOf(call), skipCandidates: true, goalPlanWindow: (windowCtx, windowGoalId) => planWindowOf(call, windowCtx, windowGoalId) }`
and update the comment at 1050-1054: a task still uses the narrow reader, now over the call's one plan window.

Do NOT wire it in anchorFactsOf (989-997). Name it after what it carries (the window), not goalFacts: readAnchorGoalFacts remains the one decision function. Reuse planWindowOf (1004-1013) and the existing seeding in userReasonFacts (925-927) and the card source (note-decision-source.ts:158-159, 198); no new cache.

### Tests

All tests go through public entries, run it.each(['memory','sqlite']), and use expected values computed by hand. Each must be RED on the current B tree first.

T1 (tests/work-graph/S4C2-read-counts.test.ts, the 'rework 2/3 item 1' queue pattern). Add a `goal` counter for readMany calls whose keys contain '"aggregateType":"Goal"', bracketed to the note source's readPage.
- Setup: host notes on task t1 and task t2 of s4a-goal. Then an agent note (Run on t1) anchored on goal s4a-goal, with extraAnchors task t1 and task t2 and replaces [both], so the card carries user_note_replaced. Read through platform.decisions.queryDecisionQueue.
- Expected for g1: goal 1, plan 1 (the readNoteDecisions window; both task targets reuse it).
- Current code: goal 5 (1 + 2×2), plan 3 (1 + 2).

T2 (tests/work-graph/S4C-write-read-bounds.test.ts, RW-12c pattern). A scribe reviewNote accept with resolution 'supersede'.
- Setup: a pending note anchored on stage s1 with extraAnchors task t1 and task t2. It contradicts three accepted agent notes anchored on stage s1, task t1 and task t2.
- Expected: readMany 11 = runFacts 3 + subject head 1 + scope facts once 3 + relationAnchorsOf 1 + userReasonTargetsOf 1 + ONE window 2 (shared by the stage branch and both task targets); lookupOrdered 1; lookup 4.
- RED: readMany 17 (+3 per task target). The old−new difference must be exactly 6. If the scope facts for task anchors differ from RW-12c's 3, re-derive that term only.

T3 (tests/work-graph/S4C-per-call-cache.test.ts, a task variant of PC-plan; this covers behaviour, not counts). Reuse the same ctx object for two scribe accepts of a note contradicting an agent note on task t2.
- Before: accept without resolution gives resolution_required.
- Then a public proposePlan/applyPlanChange sets t2 to disposition 'cancelled'.
- After: accept with resolution 'supersede' gives resolution_not_applicable, because the target is now retired for a non-file reason. This proves the hooked branch reads the window and the cache does not survive across calls.

T4 (tests/work-graph/S4C2-D-rows.test.ts style). A user-written note on task t2 contradicted by a pending agent note shows a card. After cancelling t2 through the public plan revision, the queue no longer shows it and readNoteDecision gives closedReason 'source_resolved'. This covers the seeded-window path with a retired task, which the 20k data never exercises.

No test for the dangling-plan fallback: it can only be triggered by tampering, so per AGENTS rule 4 / §13.4 it is kept untested. RW-12a and RW-12b must stay green unchanged, which shows the write path is untouched.

### Risks

- If the hook is put in anchorFactsOf(call), next to catalogModuleFacts as the claim says, the write path changes too. RW-12a and RW-12b (both backends) then fail. Even though that change is semantically safe (the write commit has no plan guard), §11.7 keeps the 4A write path unchanged, so the counts would need re-deriving and re-freezing by the lead.
- Without the readGoal fallback on a not_found window, a dangling or foreign active plan would turn a task target into anchor_not_found, then retired=true, then a silently dropped user reason. That breaks note-anchor-facts.ts:13-14 ('never as absence') and §11.6 (an unreadable fact means the whole call is unavailable). The state can only be reached by tampering, so per AGENTS rule 4 / §13.4 keep the fallback but do not test it.
- The disambiguating readGoal runs once per target, not per goal: in the missing-goal case the hook reads more (61→91 in the probe). Such a goal cannot occur for stored notes, so this only matters if someone later relies on that path.
- Snapshot timing: on the card source, task facts now come from the window read before the target heads, exactly as stage targets already do (rework 2 item 1). Plans are guarded neither before nor after the fix, and apply recomputes from a fresh call.
- The 20k dataset has 0 retired task targets, so the equivalence of the retired=true branch rests on the code (same plan snapshot gives the same disposition), not on data. A business-flow test is needed.
- The heartbeat saving (−135) exists only together with fix 1. On current B code the hook saves reads only in the card source and the disposition/apply guards.

### Open

- Lead decision: should the write path also take the window? It is safe to do (no plan CAS) and saves one Goal read per write. It would mean re-deriving RW-12a to readMany 11 and RW-12b to 17→16, and re-reading §11.7's write row.
- Fix 1 has a side effect claim 2 does not cover: switching the heartbeat to userReasonFacts adopts the service's 'goal with no active plan = task retired' rule instead of the 4B check's 'live' rule (note-views.ts:681-687 vs note-anchors.ts:755). This is consistent with §11.6's one-function rule, but the 20k data never exercises it; worth one line in the fix-1 record.
- The stage branch (note-service.ts:1064) maps any not_found window, a dangling plan included, to retired, while the task branch maps a dangling plan to unavailable. This inconsistency predates the fix and is left unchanged; only tampering can reach it, so no action is needed unless the lead wants the two branches aligned.

## Fix 3 — share the project anchor set (lens: consistency and paging) — confirmed

Claim 3 and its fix hold under the consistency-and-paging lens, and the probe now measures what the report only inferred. Every path tried saves exactly 7 calls with an identical result digest, and the ledger stayed at 66409 events.

The four parts of the lens:
- **(a) Same set:** the entry that readHeadsForKeys or the unscoped-anchor find stores is the same `headsByAnchorKey(deps.records, ctx.projectId, key)` result that selectProjectHeader reads: the same function, all 5 slots, deduplicated by noteId, unfiltered and stored under the same key. Every consumer is independent of order: the header filters and sorts a copy with a total order, conflictingOf returns a boolean and overQuotaOf a count. The fix must store the unfiltered set (not `main`), and only on success.
- **(b) Staleness and paging:** these read calls never write. The ledger cursor is read before any of these reads, and the page-to-page guard compares ledger cursors. Sharing therefore turns two snapshots of one call into one, which is an improvement: today a concurrent write between the reads could split a norm into two versions and break PU-04's "checked once". Page 2 never calls selectProjectHeader because of the `firstPage` gate, so its counts and output are unchanged. PU-04's page-2 assertion is untouched.
- **(c) Paths:** the per-call map exists on every caller.
  - Segmented find: map created at 1471.
  - Unsegmented find: map created at 2642 and passed through finishFind to buildFindPage.
  - readMemoryMaterial: map created at 1975. The work and query assemblies both reach it from the host context-extension path. The only change needed is to declare the map before the selectProjectHeader call at 1966.
- **(d) Arithmetic:** in the ⌈n/200⌉ notation, with "empty bucket = 1", an anchor set is Σ over the 5 slots of max(1, ⌈n_s/200⌉) = ⌈456/200⌉ + 4 = 3 + 4 = 7. Both stores look one record ahead, so an exact multiple of 200 costs no extra call. Seven is the minimum whenever a header norm or understanding is checked, because conflictingOf walks all 5 slots of each item. A slot-0-only header read would total 3 + 7 = 10.

**Re-measured with the emulated fix** (`__probeShareProject`), base → fixed, all with the same digest:

| Path | Base | Fixed |
|---|---|---|
| Host unsegmented find | 209 | 202 |
| Host find with `anchor=project` | 16 | 9 |
| Executor segmented find | 222 | 215 |
| Segmented find, no terms | 48 | 41 |
| Segmented find, page 2 | 229 | 229 |
| Goal card, work (material bracket) | 43 | 36 |
| Goal card, query (material bracket) | 30 | 23 |

The segmented-find row had been "inferred" in the report; it is now measured.

**One test asserts the old behaviour:** S4C-find-read-bounds RW-12(i) and RW-12(ii) count a separate 5-lookup header read. It is not a spec rule, and the spec's §11.7 find line already says "第一段的注记头已在锚点集合里". After the fix their expected lookups drop from 25 to 20 and from 37 to 32.

### Evidence

- `src/core/work-graph/notes/note-read-model.ts:1336-1340`: selectProjectHeader always calls headsByAnchorKey(deps.records, projectId, 'project'), which reads all 5 slots. It then filters `main` = anchorKey0 === 'project' in memory. It has no anchorSets parameter.
- `src/core/work-graph/notes/note-read-model.ts:1340, 1356-1359`: The header only filters and sorts copies, using createdAt and then noteId as a total order. It never mutates the shared array, and the result does not depend on the order the set was read in.
- `src/core/work-graph/notes/note-read-model.ts:224-236`: headsByAnchorKey reads S4_NOTE_BY_ANCHOR_LOOKUPS (5 slots) and deduplicates by noteId. readHeadsForKeys (exact keys), the unscoped anchored find, the check's cache and selectProjectHeader all use this same function.
- `src/core/work-graph/notes/note-read-model.ts:144-155`: readAllRecords pages with limit 200 until next === null, so one bucket costs ceil(n/200) calls and an empty bucket costs 1.
- `src/core/record-store/sqlite-sql-literals.ts:29-37`: The SQLite LIMIT is rounded up to a power of two that is at least limit+1 (lookahead). sqlite-record-store.ts:580-591 and in-memory-record-store.ts:496-506 set next only when there are more than `limit` rows. So exactly 400 rows cost 2 calls, not 3: ceil(n/200) is exact.
- `src/core/work-graph/notes/note-read-model.ts:261-269, 297-325`: conflictingOf walks all 5 slot keys of each checked item through cachedHeadsByAnchorKey, keyed `${projectId}\u0000${anchorKey}`. Any project-anchored norm or understanding therefore needs the full 5-slot project set, which makes 7 the minimum in this dataset.
- `src/core/work-graph/views/note-views.ts:1284-1289, 1109-1123`: checkHeads seeds caches.heads.anchors from input.anchorSets ('seed exactly the sets the read model already read ... never from a filtered set'). checkItem's conflictingOf and overQuotaOf use that cache.
- `src/core/work-graph/notes/note-read-model.ts:1270-1301`: readHeadsForKeys reads exact keys with headsByAnchorKey and stores each one at anchorSets `${ctx.projectId}\u0000${key}` (1287). That is the same content and key the header would need.
- `src/core/work-graph/notes/note-related-scope.ts:143, 154`: taskRelatedKeys and moduleRelatedKeys push 'project', so the segmented find's related read already holds the project anchor set.
- `src/core/work-graph/notes/note-read-model.ts:1394-1413`: buildFindPage calls selectProjectHeader(ctx, ctx.projectId) without the map (1399), then passes anchorSets to checkedPage (1413). The firstPage gate at 1398 means page 2 never calls selectProjectHeader.
- `src/core/work-graph/notes/note-read-model.ts:1471-1479, 2619-2627, 2642-2647, 2784-2787`: Per-call maps: the segmented find creates its map at 1471 and the unscoped find at 2642. Both reach buildFindPage through finishFind via plan.anchorSets. When the unscoped find has an anchor, it stores the unfiltered set (2647).
- `src/core/work-graph/notes/note-read-model.ts:1966-1975, 1984, 1992, 2009`: readMemoryMaterial calls selectProjectHeader at 1966 and only declares anchorSets afterwards (1975). The general keys exclude 'project' (1984), so nothing seeds the project set. checkedPage (2009) gets a map without project, and the check reads the set again.
- `src/core/work-graph/views/context-extensions.ts:255-267`: The host context-assembly path sends both work (includeInputs true) and query (includeInputs false) through the same readMemoryMaterial, so one fix covers both.
- `src/composition/create-platform.ts:1388-1390, 1451-1452`: The check and the read model are built over the same backend.records, so a seeded set equals what the check would read itself.
- `src/core/work-graph/notes/note-read-model.ts:784-792, 377-392`: The no-check construction (deps.check undefined) derives in itemOfHead with a fresh HeadCache that anchorSets does not seed, so it gets no saving. It is not production: create-platform always wires a check. This is harmless.
- `src/core/work-graph/notes/note-read-model.ts:2589-2595`: The find reads the ledger cursor before any other read, and page N>1 rejects with revision_conflict if the ledger moved. Within one call nothing writes, so a shared set cannot be staler than the re-read in any way a rule can observe.
- `tests/work-graph/S4C-find-read-bounds.test.ts:127-145, 159-174`: This test asserts the old behaviour, for both backends. RW-12(i) expects lookup 25 including '5: the first-page project-anchor set (selectProjectHeader's own headsByAnchorKey('project'), separate from the related read)', and RW-12(ii) expects 37. After the fix: 20 and 32 (the seed has no project notes, so the header hits the related read's entry).
- `tests/work-graph/S4C-related-scope.test.ts:553-591`: PU-04: page 1 has `project` and checks the shared norm once (checkedItems 2); page 2 has `project` undefined. The fix does not touch the firstPage gate, and the probe's page-2 row is unchanged.
- `tests/work-graph/S4C2-read-counts.test.ts:41-49, 114`: Counts readMany kinds only (plan window, pointer, pointed head). The project set is read with `lookup`, so this test is unaffected.
- `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:907, 910, 912, 833`: 907 defines the notation: an index scan costs ceil(n/200) calls, an empty bucket counts as 1, and an anchor set is 5 slot scans. 912's Goal-card line says '项目锚点一次扫描', which is 3 calls here, but the code reads 7 and the check reads 7 more. 910's find line already says the first segment's heads are in the anchor sets, so the fix agrees with the spec. 833 is a selection rule (anchorKey0 = project), filtered in memory, and needs no change.
- `~/dsh-work/measure-4c2/probe/verify-consistency/share.out.json:rows.*['exp:__probeShareProject']`: Emulation of the real fix through a loader-hook copy (make-probe.mjs builds share-probe.mjs). selectProjectHeader uses or stores the anchorSets entry; buildFindPage passes its map; readMemoryMaterial declares its map before the call. Base → fixed, all with the same digest: unsegmented find 209→202, find anchor=project 16→9, segmented find 222→215, segmented find with no terms 48→41, segmented page 2 229→229, Goal card work 43→36 inside the material, Goal card query 30→23. Per slot, slot 0 drops by 3 and slots 1–4 by 1 each. Ledger 66409→66409. The dataset has no project understanding (understanding:false).

### Fix

Smallest correct version, about 10 production lines in src/core/work-graph/notes/note-read-model.ts:

1. selectProjectHeader (1336-1340): add a parameter `anchorSets: Map<string, NoteHeadSnapshot[]>` before `preRead` and replace line 1338-1339 with:
```ts
const setKey = `${projectId}\u0000project`;
let projectSet = anchorSets.get(setKey);
if (projectSet === undefined) {
  const read = await headsByAnchorKey(deps.records, projectId, 'project');
  if (!read.ok) return read;
  projectSet = read.value;
  anchorSets.set(setKey, projectSet); // the unfiltered 5-slot set (S2.3: never a filtered set), success only
}
const main = projectSet.filter(head => head.anchorKey0 === 'project');
```
Reuse headsByAnchorKey and the key format of cachedHeadsByAnchorKey (:263) and readHeadsForKeys (:1287). Do not store `main`.

2. buildFindPage (1399): `selectProjectHeader(ctx, ctx.projectId, anchorSets)`. The map is already a mutable `Map` (1395), coming from 1471 or 2642 through finishFind.

3. readMemoryMaterial: move `const anchorSets = new Map<string, NoteHeadSnapshot[]>();` from 1975 to just before 1966, and call `selectProjectHeader(ctx, ctx.projectId, anchorSets, { pointer: projectPreRead.pointer, head: projectPreRead.head })`. Leave the general-key filter at 1984 and readHeadsForKeys at 1992 as they are; general keys never include 'project', so nothing overwrites the entry.

4. Update the comments at 1324-1329 ('the project anchor set is still read') and 1916-1922 to say the set is read once per call and shared with the check.

5. Spec §11.7. Line 912 becomes: 'Goal 卡的项目部分：1 次批量读三个指针、1 次批量读指向的注记头、项目锚点的一组锚点集合（和核对共用，核对不再读）、C(1 + 10)'. Line 910's '第一页的项目部分' needs the per-path split:
   - segmented find: the project anchor set is already in the related set, so the project part adds only 1 project-pointer read;
   - unsegmented find: it adds 1 project-pointer read plus one shared project anchor set.

   Arithmetic: anchor set = Σ_{s=0..4} max(1, ⌈n_s/200⌉) = ⌈456/200⌉ + 4 = 7 in this dataset. The Goal-card budget goes from 28 to 32. The measured 36 after the fix is 32 plus the 4 unchanged 4B overQuota buckets (§12.7).

### Tests

Through public entries, both backends (it.each(['memory','sqlite'])), expected values hand-computed. The counting wrapper is the style of S4C-find-read-bounds.test.ts:39-67 and S4C2-read-counts.test.ts:51-106 (bracket readMemoryMaterial). It counts `records.lookup` calls whose request.index starts with 's4-note-by-anchor-' and whose request.values deep-equal [PROJECT, 'project'], and the rest of the lookups as a separate total. It reads requests only, never record contents.

Seed: one project convention, reviewed by the scribe (so it is a norm and the check runs conflictingOf on a project-anchored item), plus a project understanding written by the scribe. Slot 0 then has 2 heads and slots 1–4 none, so one project anchor set = 5 calls.

1. **Update RW-12(i)/(ii)** in S4C-find-read-bounds.test.ts: lookup 25→20 and 37→32. Remove the '5: the first-page project-anchor set' term from the comments; the 15 already includes the project set from the related read.
2. **Goal card, work** (`graphContext.readContextFacts(..., includeInputs: true)`, bracketed around readMemoryMaterial): project-key lookups = 5 (today 10). Also assert the material's projectUnderstanding row (noteId, version) and norms (one row with the literal header) are unchanged.
3. **Goal card, query** (includeInputs: false): project-key lookups = 5 (today 10).
4. **Unsegmented host find, first page** (`memoryFind` with terms, no related/anchor/pathPrefix): project-key lookups = 5 (today 10). Assert `project` deep-equals the literal header ({understanding:{noteId, version:1, pointerRevision:1, ...}, norms:[{noteId, version:2, header:'约定(项目)：...'}], omitted:0}).
5. **Segmented find** (`related: task t1`):
   - page 1: project-key lookups = 5 (the related read only; today 10);
   - page 2 (cursor from page 1): project-key lookups = 5 (the related read on every page, no header read), and `project` is undefined (PU-04 shape).
6. **Optional:** extend the SP-note-reuse.test.ts refusal fixture (a second identical s4-note-by-anchor lookup → unavailable) with the find first page and the Goal-card material, expecting 'ready'. Today they would get 'unavailable'. First confirm that no other duplicate anchor lookup exists in those calls.

No test asserts the check's second read as a rule. The only old-behaviour assertions are the RW-12 counts.

### Risks

- S4C-find-read-bounds.test.ts RW-12(i) and RW-12(ii) (memory and SQLite) fail until updated: lookup 25→20 and 37→32. Their comments also need to drop the 'separate from the related read' term.
- The shared array is passed by reference to both the header and the check, which is the existing S2.3 pattern. It stays safe only while no consumer mutates it in place (today :1340 and :1356-1359 work on copies). A future in-place sort would leak into the check.
- The project understanding branch (main.find by pointer noteId) is not exercised by the 20k dataset (understanding:false). Equivalence there rests on reading the code, which uses the same `main`, so a test with an understanding is needed.
- The no-check construction (deps.check undefined) still reads the project set twice, because checkedPage's local HeadCache (:784) is not seeded from anchorSets. It is not production, and it is not a regression.
- When the header is empty and nothing checked touches project, reading all 5 slots costs 4 calls more than a slot-0-only scan. That is today's behaviour, unchanged by the fix. The '7 minimum' applies when the check needs the project set (any header norm or understanding).

### Open

- Spec wording for line 910 (find) versus 912 (Goal card): the find reads the project pointer through pointerOf (1 readMany) and finds the head in `main`, while the Goal card reads one batched pointer read plus one batched head read. The lead should decide whether one shared line covers both or each row states its own project part.
- The understanding branch is not in the 20k dataset (understanding:false). It is settled by new test 2/4 with a project understanding, which asserts the literal pointerRevision and version.
- This lens did not check whether the find first page or the Goal-card material has any other duplicate anchor lookup. Running optional test 6 (SP-note-reuse style) would show it.
- Probe files created: ~/dsh-work/measure-4c2/probe/verify-consistency/make-probe.mjs, share-probe.mjs and share.out.json. They change only the loader-hook copy; the repo is untouched.

## Item 4 — the find ruler (lens: attribution and what the spec requires) — partly

The read counts are right: they reproduce, every call is attributed, and the fix gives the same results. Five parts of the claim need correcting.

(1) Spec line 918 sets the ruler for the SEGMENTED find first page, not the host unsegmented one. The segmented row is the executor default: 222 calls, 140–149 ms under load 7–8.

(2) §11.3 explains only the 44 goal status-bucket calls. conflictingOf reads every anchor set of an item whatever the item's state (note-read-model.ts:305-323), so the 110 anchor-set calls were also paid for the superseded items in the speed-1 run. The 41 ms vs ~126 ms comparison is between different pages and is inferred.

(3) The report says "neither 4C-2 session touches note-read-model.ts/note-views.ts". That is wrong: e15ba172 changed them by +464 and +177 lines. It adds no reads on these pages, though: the updateDue branch only runs for goal or stage understanding items, and none are checked.

(4) The dataset numbers are exact: the project anchor has 456 heads, all in slot 0. 130 are current general notes (112 agent, 18 user), 317 are retired, 9 are pending. But the state is reachable by legitimate writes, not caused by seeding. Every one of the 112 agent notes went write:agent -> pending_review[quota_full...] -> accept:user. Spec :135/:198/:551 allow the user, or the scribe when quota_full is the only reason, to accept past L7. No disposition path checks the quota.

(5) The fix holds, but it breaks two frozen 4C-1 expectations: S4C-find-read-bounds RW-12(i) 25 -> 20 and RW-12(ii) 37 -> 32.

What I verified with the real shared-set fix (not the earlier seed hack), all with identical result digests:
- host unsegmented find: 209 -> 202 calls
- executor segmented find: 222 -> 215 calls (measured; the report only inferred this)
- find with anchor=project: 16 -> 9 calls
- Goal card: 1226 -> 1219 calls; material 43 -> 36

Interleaved timing at load about 1 (n = 30, two runs):
- segmented find: 136-147 ms -> 119-130 ms
- unsegmented find: 126-134 ms -> 114-119 ms
- unsegmented, with the project part dropped as well: 97-101 ms
So the page stays over 100 ms even at low load.

Inside 4C-2 scope, one change is still required. Spec :912 says "项目锚点一次扫描" for the Goal card, and :910 points the find page's project part at that line. The measured cost is 7 + 7 project-anchor calls. The shared set brings it to 7. That is the minimum, because conflictingOf needs all five slots, so the lead needs to reword the line.

After the fix no read on these pages is repeated: each anchor set, bucket, plan window and Run is read once per call. Decision-70 round 2 ("fewer repeated reads") can only batch the 20 hint reads, saving about 3-5 ms. So the proposed acceptance wording is inaccurate. The rest is 4A/4B derivation reads that L22 requires on every item, plus file observations. Getting under the ruler needs read-shape changes, which are a separate speed item.

### Evidence

- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-read-model.ts:224-236`: headsByAnchorKey: 5 lookups, one per slot index, each paged to the end; no state filter. Blame: 4A 753bf5ab.
- `D:/cxt/s4c2b-measure/src/core/work-graph/persistence/note-record-codecs.ts:703-707`: The anchor index paths are ['ref.projectId','anchorKeyN'] with no state, so retired heads are always read. The review-status index is (projectId, goalId, state).
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-read-model.ts:297-325`: conflictingOf loops over ALL of the item's anchor keys whatever the item's own state. Only the 'other' heads are filtered (:316) and the topic rule is gated (:318). So the anchor-set reads are not caused by §11.3. Blame of :295-352: 49 lines 4A 753bf5ab, 9 lines 4B 0776b9b6.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-read-model.ts:327-350, 238-247`: overQuotaOf is the only state-dependent derivation. The anchor quota applies only to current general notes (:331). The goal branch (:342-348) reads 4 status buckets per goal and decodes every head, only to compare a length with 200.
- `D:/cxt/s4c2b-measure/src/core/work-graph/views/note-views.ts:1109-1126`: Derivations run for every checked item. Per-call memo from speed-1 269a9748; 4C-1 36602e53 only added the supplied-conflicting bypass (:1112-1120).
- `D:/cxt/s4c2b-measure/src/core/work-graph/views/note-views.ts:820-846, 869-912, 1192`: Class-5 hints on every read: one readMany for the Run and one for its bound PlanRevision, per distinct agent Run with file anchors (4B 0776b9b6, per-Run cache 269a9748). Here 10 Runs = 20 calls.
- `D:/cxt/s4c2b-measure/docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:258, 470`: L22 makes conflicting/overQuota/currentEligible and the class-5 hints per-item check fields on every one of the six reads. They are required, not leftover post-write work.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-read-model.ts:630-641, 662-665`: §11.3 visibility (4C-1): the host sees accepted, reviewed AND pending_review, not only accepted/reviewed.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-read-model.ts:1324-1340, 1399, 2642, 1479`: selectProjectHeader (4C-1 36602e53; session A e15ba172 added preRead) reads the full 5-slot project set and never stores it. The comment at :1324-1329 documents the double read as intended. The unsegmented find hands the check an empty anchorSets (:2642), so the check re-reads project (+7). In the segmented find the related set already holds project (:1479; note-related-scope.ts:143/:154), and selectProjectHeader reads it again (+7).
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-read-model.ts:1966-1975`: readMemoryMaterial (session A) calls selectProjectHeader before it creates anchorSets, so the check re-reads the project set. This is the Goal-card +7 inside 4C-2 scope.
- `D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6 (git):git show --stat e15ba172`: Session A changed note-read-model.ts (+464) and note-views.ts (+177), which refutes 'neither session touches'. Its new check reads, updateDue at note-views.ts:1227-1237, run only for accepted/reviewed goal or stage understanding items. None are on these pages: no currentTriggers or understandingOfAnchorKey in the timers.
- `~/dsh-work/measure-4c2/probe/verify-attribution/project-anchor-stats.mjs:output`: Read-only SQLite results. Project anchor: 456 heads, all in slot 0, per-slot scan calls [3,1,1,1,1]. States: superseded 307, reviewed 107, accepted 23, pending 9, withdrawn 7, rejected 3. 130 current general: agent 112, user 18; all confirmedByUser; all carry a goalId. 59 norm-eligible.
- `~/dsh-work/measure-4c2/probe/verify-attribution/project-anchor-stats.mjs:version paths`: All 112 agent current notes followed write:agent->pending_review[...quota_full] -> accept:user->accepted, and 89 of them then review:agent->reviewed. The 18 user notes were write:user->accepted. This is a legal service path, not tampering.
- `D:/cxt/s4c2b-measure/src/core/work-graph/state/note-machine.ts:59-77, 354-373`: An agent write on a full anchor goes to pending_review with quota_full. The review/accept transitions have no quota gate.
- `D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-service.ts:1355-1360, 1534-1650`: anchorFull is projected only at write time. dispose (scribe or user accept/review) never checks the quota.
- `D:/cxt/s4c2b-measure/docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:135, 198, 551, 833`: The user, or the scribe when only quota_full remains, may accept, and the note stays accepted, reported as overQuota. Line 833's 'L7 是软配额、用户写入可以超' understates this, and so does the report's 'only user writes'.
- `D:/cxt/s4c2b-measure/docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:906, 910, 912, 918, 983`: :918 sets the ruler for the SEGMENTED find first page and asks only for an explanation when it is exceeded. :910 refers the find's project part to :912 ('项目锚点一次扫描'), which is unreachable while conflictingOf needs all five slots. :906 makes unchanged reads count 'as measured after round 1'. :983 (§12.7) speaks only of lookup.
- `D:/cxt/s4c2b-measure/tests/work-graph/S4C-find-read-bounds.test.ts:127-145, 159-174`: Frozen RW-12(i) expects lookup 25 and RW-12(ii) expects 37, and both comment lines count selectProjectHeader's separate 5 project lookups. With the fix they become 20 and 32 on both backends.
- `D:/cxt/s4c2b-measure/tests/work-graph/SP-note-reuse.test.ts:89-129`: SP-19, the speed-1 'never re-read its sets' rule, covers lookup/conflicts/neighbors/stale/history/readNote/listByAnchor but not find or the Goal card. That is why the double read went unnoticed.
- `D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/docs/refactor/reviews/evidence/orchestration-note-speed-1-2026-10-16/design/read-model.draft.md:44-46`: The speed-1 rule (b)1/S2.3: the read model hands every anchor set it already read to the check. selectProjectHeader breaks it.
- `D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/docs/refactor/reviews/evidence/orchestration-note-speed-1-2026-10-16/checks/measure-s4f.out.json:reads[9], reads[11]`: Speed-1 find with one term: 41 ms host and 37.7 ms executor. 20 items: 14 superseded, 5 reviewed, 1 accepted. filesRead 8. Unsegmented, no project part. So it is a different page from today's.
- `~/dsh-work/measure-4c2/probe/verify-attribution/verify-shared-set.out.json:rows`: Real fix (selectProjectHeader takes and fills anchorSets; both callers pass theirs): host find 209->202, executor segmented 222->215, find anchor=project 16->9, Goal card 1226->1219 (material 43->36). Digests identical. Ledger stayed at 66409 events.
- `~/dsh-work/measure-4c2/probe/verify-attribution/verify-interleave.out.json, verify-interleave2.out.json:interleave rows`: Load about 1, n = 30, interleaved. Host: base 126/134, fix 114/119, fix without header 97/101, fix plus count-only goal buckets 116 ms (paired savings 5–12 ms). Segmented: base 136/147, fix 119/130, count-only 123 ms. Paired base-minus-fix 13-16 ms. Same-mode warm p50s in the non-interleaved run ranged 129-184 ms, so only the paired figures are reliable.
- `D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/docs/refactor/HANDOFF.md:461-470`: Decision 70: round 2 is about 'the same request reading the same data two or three times'. The note part of the cleanup audit is deferred to after 4C merges (item 4 of the decided list).

### Fix

Smallest correct fix: share the project anchor set. About 10 lines, all in D:/cxt/s4c2b-measure/src/core/work-graph/notes/note-read-model.ts.

1. selectProjectHeader (:1336-1340): add a parameter `anchorSets: Map<string, NoteHeadSnapshot[]>` before `preRead`, and replace the read at :1338 with:
```ts
const setKey = `${projectId}\u0000project`;
let projectHeads = anchorSets.get(setKey);
if (projectHeads === undefined) {
  const read = await headsByAnchorKey(deps.records, projectId, 'project');
  if (!read.ok) return read;
  projectHeads = read.value;
  anchorSets.set(setKey, projectHeads);
}
const main = projectHeads.filter(head => head.anchorKey0 === 'project');
```
2. buildFindPage :1399 becomes `selectProjectHeader(ctx, ctx.projectId, anchorSets)`.
3. readMemoryMaterial: move `const anchorSets = new Map<string, NoteHeadSnapshot[]>()` from :1975 to before :1966, and pass it as the third argument.
4. Update the comment at :1324-1329.

What it reuses: headsByAnchorKey, the S2.5 key `${projectId}\0${anchorKey}`, and checkHeads' anchorSets seeding (note-views.ts:1285-1289). Do not read only slot 0: the check needs all five slots for the norms' conflicting/overQuota. The probe confirmed this version gives identical output (see evidence).

Doc edits for the lead: reword spec :912 to "项目锚点集合一次（5 个槽，和核对、有联系的集合共用）". Fix :833 to cover the user's acceptance and the scribe's acceptance when only quota_full remains.

Draft acceptance paragraph (Chinese):

“找”第一页超过 100 毫秒的尺子（§11.7 第 918 行）。在 2 万条注记的数据上（负载 7–8，热的中位数），带分段的第一页（执行 Run，一个词，每页 20 条，另核 10 条项目规范）读存储 222 次、140–149 毫秒；主机不分段的同一个词 209 次、143–158 毫秒。这次把项目锚点集合改成和核对共用（结果逐字相同），分别降到 215 次和 202 次；负载 1 左右交替各测 30 次，分段的约 120–130 毫秒，不分段的约 115–120 毫秒，仍然超。不分段的页把项目部分整个去掉也要约 100 毫秒，所以超出的不在 4C 新加的读法上。
- 读次数：分段那一页 215 次里，本节的读法 46 次（建有联系的集合 26、账本 1、第二段的文本 4、项目指针 1、核对的计划窗口 10、目录 3、事实 1）；另外 169 次是 4A/4B 原有的核对推导，§11.7 算“没改的读法”：每一项算 conflicting、overQuota 要读它每个锚点的整组注记（21 个锚点 × 5 个槽 = 105 次），每个涉及的目标读 4 个状态桶只为数个数（11 个目标 44 次，解码 649 条注记头）；第 5 类提示读的时候也要算（L22），10 个 Run 各读一次 Run 和它的计划（20 次）。这些字段每一项都要有。
- 时间：核对约占四分之三；核对里这些推导约一半，20 个文件的观察约三成。
- 数据：项目锚点上 456 条注记头，130 条现行的一般注记（112 条是 agent 在满了的锚点上写、进了待审、再由你收下的），317 条已退役。L7 是软上限，你写的、你收下的、书记收下只因超配额待审的都可以超，所以这是合法状态，只是书记没整理；锚点索引不带状态，退役的 317 条每次也一起读出来解码。
- 和提速第一轮的 41 毫秒不是同一页：那时“找”不分段，20 项里 14 项是已取代的；§11.3 以后默认只给现行和待审的，现在 20 项都是现行的，每项都要按目标数配额，核对的文件从 8 个变成 20 个（含项目规范的依据文件）。这一条是推断，没在第一轮代码上重测。
剩下的不是重复读：共用项目集合以后，同一次调用里每组锚点、每个状态桶、每个计划窗口、每个 Run 都只读一次。决定 70 第二轮（减少同一次请求里的重复读取）只能把写后提示的 20 次并成 2 次，省 3–5 毫秒。要降到 100 毫秒以下得改读法的形状：数目标配额不解码（模拟过，省约 5–12 毫秒）、给推导一个只含现行注记的锚点索引、文件观察并行。这些改 4A/4B 的读法和存储接口，4C-2 里不做，放到 4C 合入后补审注记部分时（决定 70“定的”第 4 条）一起定。

Cleanup and speed candidates, with file:line and expected savings:
- C1 (do it in 4C-2): the fix above. note-read-model.ts:1336-1340, :1399, :1966/:1975. Saves 7 calls on every first find page and every Goal card. Measured −13 to −16 ms paired on the find; Goal-card material 64 -> 35 ms per the report.
- C2 (read shape, not a repeat; lead rules on failure semantics): count goal-quota buckets without decoding. note-read-model.ts:238-247 and :342-348; optionally a count-only lookup on RecordLookupPort in both backends. 649 decodes per page. Emulated: −5 to −12 ms, identical output.
- C3 (separate speed item; new index plus migration): current-only anchor reads for conflictingOf, overQuotaOf and selectProjectHeader. note-read-model.ts:224-236, :305-323, :331-340, :1338; index at note-record-codecs.ts:703-705. All three use only accepted/reviewed heads. On project: 456 -> 130 rows, about −10 ms (estimate), plus the retired share on every other anchor.
- C4 (decision-70 round 2, mechanical): batch the hint reads. note-views.ts:820-846, called from :900-901. Prefetch the page's agent Runs in one readMany and their bound plans in one, reusing caches.plans when a Run's plan is the active one. 20 -> 2 calls, about −3 to −5 ms.
- C5 (low value): 5 slot lookups per key in headsByAnchorKey (:224-236). About 80 lookups per page return nothing; slots 1-4 total about 4-5 ms counted.
- C6 (not a read-count item): sequential file observations at note-views.ts:318, 20 files ≈ 30% of the check. Only bounded concurrency with a deterministic budget order would help.

### Tests

All through public entries, on memory and SQLite, with the counting wrapper pattern of S4C2-read-counts.test.ts / S4C-find-read-bounds.test.ts.

1. Re-freeze S4C-find-read-bounds.test.ts:
- RW-12(i) at :145: lookup 25 -> 20. Drop the comment line at :133-134 ('5: the first-page project-anchor set …'). The project set is now the one inside the 15 related lookups.
- RW-12(ii) at :174: lookup 37 -> 32.
- searchText, lookupOrdered and readMany stay unchanged.

2. New test S4C2-project-set-shared (or a new case in S4C2-read-counts.test.ts). The wrapper counts `records.lookup` calls whose `index` starts with 's4-note-by-anchor-' and whose `values[1] === 'project'`.

Seed:
- one user-written convention on {kind:'project'}, conclusion containing 'alpha'. It lands accepted and confirmedByUser, so it is norm-eligible.
- one module-anchored pitfall containing 'alpha'.

Hand-computed counts: each bucket holds 200 heads or fewer, so one call per slot, i.e. 5 for a full set.
- (a) host `platform.notes.memoryFind(f.ctx(), {v:1, op:'find', terms:['alpha'], limit:20, cursor:null})` (unsegmented): expect 5 project lookups; today 10. Also assert `value.project.norms` has the convention and `omitted` is 0.
- (b) the same request from a work Run of the fixture (default segmented): expect 5; today 10.
- (c) `platform.graphContext.readContextFacts(f.ctx(), {goalRef, planRef, focusTaskIds:['t1'], includeInputs:true})`, bracketing readMemoryMaterial exactly as S4C2-read-counts does at :93-103: expect 5; today 10.
- (d) the second find page (cursor from (a)): expect 0 project lookups, because the header is first-page only.

3. Optional regression guard: add the three calls from step 2 to SP-19's call list in SP-note-reuse.test.ts:116-129. Its wrapper refuses a second identical anchor lookup, so today find and the Goal card come back 'unavailable'; after the fix they are 'ready'.

No other existing test asserts the old count: the grep found lookup-count asserts only in S4C-find-read-bounds, S4C-write-read-bounds (write paths, unaffected), S4C-related-scope (no count asserts) and S3/R4c (unrelated).

### Risks

- Re-freezing RW-12(i)/(ii) (S4C-find-read-bounds.test.ts:145 25->20, :174 37->32) changes lead-frozen 4C-1 tests. The lead has to rule on it. The new values match the §11.7 line better: 20 is within the literal line (15+1+1+4=21), while the frozen 25 is above it.
- The fix contradicts the session-A comment at note-read-model.ts:1324-1329 ('the project anchor set is still read'), so the comment must change together with the code.
- Spec :912 ('项目锚点一次扫描') cannot be met as written. A slot-0-only header read plus the check's 5-slot read would cost 10 calls, not 3. The lead should reword it to a shared 5-slot set (7 calls at this size).
- Spec :833 and the report both say only user writes exceed L7. User acceptance, and scribe acceptance when only quota_full remains, also exceed it (:135/:551). If the acceptance text keeps 'seeded data is the cause', a reviewer can refute it from the version history.
- WSL timing noise is large: one configuration's warm p50 moved between 129 and 184 ms inside a single run. Only interleaved paired deltas and call counts should go into the acceptance.
- Counting goal buckets without decoding (candidate C2) means an undecodable head in a goal bucket would no longer make the page unavailable. That is a failure-semantics change and needs the lead's ruling, even though only a tampered database can produce such a head.
- The ruler row in :918 is the SEGMENTED find. An acceptance written around the host unsegmented 126 ms reports the wrong row.

### Open

- The 41 ms vs ~115-130 ms comparison with speed-1 is inferred. To settle it, run measure-probe's counting against a 269a9748 build on the same data and term, then compare calls per chain and distinct anchor keys. Superseded items paid the anchor-set reads then too; only goal buckets, file count and segmentation are certain to differ.
- Savings for C2 (count-only) are emulated at load about 1 with a wide paired spread (4.7-11.6 ms). C3 (current-only index), C4 (batched hints) and C5 (slot lookups) are estimates. A per-candidate emulation probe would settle them before anyone decides on a speed round.
- Whether a damaged head in a goal bucket may stop making the page unavailable (needed for C2's count without decode) is a lead ruling.
- Whether to land the find-side half of the fix (4C-1 code, RW-12 re-freeze) inside the 4C-2 rework, or only the Goal-card half (readMemoryMaterial), is the lead's call. One shared function argues for doing both.
- The time split (check about three quarters; within it derivations about half and file observations about 30%) is scaled from counted timers that carry the probe's stack-capture overhead. It is a proportion, not a measured warm value.
- The ruler row (segmented) and the busiest-module related find (206-261 ms, 358 calls) were not re-attributed under this lens beyond the call breakdown.
