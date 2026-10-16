**Topic: decision 67 item 1 — `find` returns related notes first, then the rest of the project**

## 1. FACTS

**What `find` does today**
- It returns one stream and has no idea of a "requesting node". The request fields are bound into the cursor (note-read-model.ts:1454-1456).
- Candidates come from one of four places:
  - an anchor (:1476-1486);
  - a `pathPrefix`, through `headsOnPathPrefix` (:509-532);
  - terms: `'all'` at :1490-1503, `'any'` at :1505-1517;
  - otherwise, the review-status index read for every goal and all 7 states (:1524-1535, `ALL_STATES` :446).
- `find` applies no default-state filter and no cross-goal filter. `lookup` does have a cross-goal filter (:1158-1165).
- With no terms, results are ordered by `createdAt`, then `noteId` (:1536).

**Cursor and size limit**
- The cursor is `{v, op, id, rule, request, after, cursor}` (:561-590), with `RULE_VERSION = 1` (:444).
- The record cursor is the ledger's `readThrough` (:451-455). Any commit between pages gives `revision_conflict` (:1462-1464). That already pins every graph fact a "related" set depends on, because plans, catalog and RunActivity are all records.
- The 48 KiB trim drops items from the end and rebuilds the cursor from the last kept item (:638-666; §10 R12).

**Speed round 1 (s4f-impl §4)**
- S2.1: an anchor or `pathPrefix` find with terms reads only the scoped heads and makes no port call.
- S2.2: an unscoped `'any'` find uses one port stream.
- S2.3: the check gets one head cache per call, seeded from the anchor sets the read model already read.
- Decision 66 already plans a related-first pass, then a project pass that "skips what was already returned".

**Where each graph edge can be read**
- **Requester.** A `work_run` caller's principal holds only `runRef` (note-read-model.ts:466-476). The tool freezes that context (graph-tools.ts:240-258). The task and bound plan are on `RunSnapshot.task` and `.planRef` (dispatch.ts:203-219).
  - Notes reaches the Run only through the injected `NoteRunFactResolver` (note-service.ts:59-60). Its implementation does 3 `readMany` calls: Run, outbox, Session (create-platform.ts:1231-1260). It returns no `taskId`.
  - The read model has no resolver at all (deps at :47-61).
- **Task → stage.** The field is `RuntimeTask.stageId?` (plan.ts:37). The stage anchor key embeds the plan revision (note-anchors.ts:389). §10 R5 treats one stageId across revisions as the same stage only while it stays present in every revision.
- **Task → module.** `TaskScope {kind:'module', moduleRef}` (plan.ts:9-17), so at most one module per task.
- **Task → interfaces.** Tasks declare no interfaces anywhere in `RuntimeTask` (plan.ts:33-60).
- **Module → interfaces and paths.** `ModuleDefinition.paths` and `.interfaces[].id` (architecture-catalog.ts:18-24), read through `deps.architecture` (note-read-model.ts:50).
- **Files the task changed.**
  - `RunActivity.facts.changedFiles` has `definite` and `possible` lists (run-activity.ts:35-37, :61-68), capped at 500 per run (:13).
  - It is written only when a run ends (:64-65), so the current run's files are not there yet.
  - Per task, the reads are the `r4c-run-by-task` index (plan-readers.ts:89, :310) plus one RunActivity per run (key at run-activity.ts:31).
  - The goal-wide `readGoalExecutedFiles` reads all of the goal's runs and activities (goal-executed-files-reader.ts:80-200). Node detail filters that by the task's runs (node-detail-reader.ts:1124-1127).
- **File → owning module.** `moduleOfAnchor` uses the longest prefix; root `"."` owns nothing (scribe-scope.ts:79-102). It is not exported.
- **Child modules.** Containment (architecture-catalog.ts:32-34; graph-context-reader.ts:1081-1087). Excluded until 8B.
- **Indexes.** Five equality indexes and five ordered indexes on `anchorKey0..4` (note-record-codecs.ts:653-664). So a key-prefix range such as `stage:<g>/` can be scanned the same way `headsOnPathPrefix` scans files.

**Readers that cannot be reused**
- `graph-context-reader` is in views, and notes may not import views (F17).
- Its `loadUniverse` reads every Session, Run and round (:725-795).
- Node detail is also in views.

**Spec**
- L20 already lists the same edges for assembly ("本任务、阶段、目标，再到任务涉及的模块、接口、文件").
- L12 maps module files by longest prefix.
- L7 caps each anchor key at 5 current general notes, so the `project` key holds about 5.

## 2. GAPS

- G1. How the requester is named, and what the default is for each kind of caller.
- G2. What happens when `anchor` or `pathPrefix` is also given.
- G3. Which stage plan revisions count.
- G4. "The interfaces it declares": no such declaration exists.
- G5. Which changed files count (`definite` and/or `possible`), the cap, and the fact that the current run has no files yet.
- G6. What "project-level norms" means.
- G7. Whether "files under the module's path" means plain prefix or longest owner.
- G8. Order inside each segment, and whether `'any'` ranking and the 1,000 cap work per segment or across both.
- G9. Cursor format, how the boundary is marked, how the byte trim behaves.
- G10. What happens when an edge read fails.
- G11. Adding new fields could break 4B's existing equality assertions.
- G12. Whether this shares code with L20.

## 3. PROPOSAL

**Types** (in `model/note-contracts.ts`; every new field is optional, so 4B results and tests stay byte-identical):

```ts
type MemoryRelatedNodeV1 = { kind: 'task'; goalId: string; taskId: string }
  | { kind: 'module'; moduleId: string } | { kind: 'caller_task' };
MemoryFindRequest.related?: MemoryRelatedNodeV1;          // absent = no segments
NoteItemV1.segment?: 'related' | 'project';               // segmented find only
MemoryResultV1.related?: { node: MemoryRelatedNodeV1; filesOmitted: number };
MemoryResultV1.boundary?: { relatedEnded: boolean; projectStartsAt: number | null };
```

- **F67-1 Naming the requester.**
  - The `find_graph` memory schema accepts `related?: task | module | null`.
  - The adapter turns "absent" into `{kind:'caller_task'}` for work Runs. For query Runs and host callers, absent stays absent. `null` means no segments.
  - `caller_task` resolves only from `ctx.principal.runRef`, using the bound plan. Any other principal → `invalid` / `related_needs_run`.
  - An explicit task uses its goal's current plan, and the goal must be in the bound project and workspace.
  - A node that does not exist → `not_found` / `related_not_found`, with candidates, using the existing anchor check (`anchorExistsNow`, :417).
  - Relatedness only changes order. It never widens or narrows what a caller can see.
- **F67-2 When segments apply.** Only when there is no `anchor` and no `pathPrefix`. With either one, the find is already scoped (S2.1).
- **F67-3 Related set for a task T in goal g at plan revision p:**
  - `task:g/T` and `goal:g`;
  - `module:M` when T's scope is a module, plus `interface:M/<id>` for each of that module's current interfaces;
  - every `stage:g/<r>/<T.stageId>` with r ≤ p;
  - `file:<path>` for the first `FIND_RELATED_FILES_MAX = 32` distinct paths from T's ended runs: definite before possible, newest `runEndedAt` first, then path order, `"."` dropped (reported in `filesOmitted`);
  - `project`, counted only for the six general kinds.
- **F67-4 Related set for a module M:** `module:M`, its interfaces, file keys whose single longest catalog owner is M (export `moduleOfAnchor`), and `project` with general kinds only. Child modules are added at 8B.
- **F67-5 One shared predicate.** A note is related when any of its anchor slots matches F67-3 or F67-4.
  - Segment 1 is the scoped reads filtered by this predicate. Segment 2 is the existing unscoped path minus related notes.
  - This splits the results exactly in two: nothing appears twice, and nothing is dropped. A note that should have counted as related still shows up in segment 2.
  - Filters (kind, topic, state, and decision 67's default states) apply to both segments in the same way.
- **F67-6 Order inside a segment.**
  - No terms: `createdAt`, then `noteId`.
  - `'all'`: refKey byte order.
  - `'any'`: each segment is ranked as if it were its own find — its own U, df and 1,000 cap. The result's `ranking` is `'partial'` if either segment is partial.
- **F67-7 Paging.**
  - `RULE_VERSION` becomes 2.
  - The cursor gains `seg: 'related' | 'project'`. `after` keeps each path's current meaning (refKey for `'all'`, `noteId` otherwise).
  - The resolved `related` node is bound into the request.
  - One page can hold the end of segment 1 and the start of segment 2. Once segment 1 runs out, the next cursor is `{seg:'project', after:null}`.
  - The related set is recomputed on every page. The ledger cursor makes that safe.
- **F67-8 Byte trim.** The resume point comes from the last kept item's segment. `boundary` is recomputed over the kept items.
- **F67-9 Completeness.** `complete` is true only when there is no next page and both rankings are full.
- **F67-10 Read failures.** A failed edge read makes the whole find `unavailable` (§9). Smallest alternative: drop to one segment and add the warning `related_unavailable`.
- **F67-11 Reuse with L20.** L20 assembly calls the same pure related-set builder, feeding it facts from `readContextFacts` plus the same RunActivity read. That keeps one implementation.

**For the user** (these change what an agent sees):
1. **What "project-level norms" means.** I recommend all six general kinds on the `project` anchor: there are about 5 such notes, and segmenting only reorders. Alternatives: only `convention`/`preference`/`decision`, or only `convention`.
2. **The task's "interfaces".** Tasks declare none, so I recommend using the declared module's interfaces. Alternatives: no interfaces until tasks can declare them; or also include files under the declared module's path (decision 67's wording leaves those out).
3. **Default for agents in a work Run.** Their own task is used automatically, and they can opt out with `related: null`.

**For the lead** (technical):
- Per-segment ranking, or one ranking across both segments.
- Fail on an edge-read error, or degrade to one segment.
- Recompute the related set every page, or carry it in the cursor (unverifiable).
- Stage rule r ≤ p, or exact revision only.
- File cap of 32.
- Extend `NoteRunFactResolver` with `taskId` (3 reads), or add a one-read resolver.

## 4. COST (per call, i.e. per page)

**Building the related set for `caller_task`:**
- resolver: 3 `readMany` (1 if a narrow resolver is chosen);
- bound plan: 1 `readMany`;
- catalog: 1 read;
- task runs: ⌈runs/200⌉ index lookups;
- RunActivity: 1 batched `readMany`;
- heads: 5 equality lookups per key, plus 5 ordered scans for the stage prefix.
- With K = 4 + I + files: worst case is I = 8 and 32 files, about 232 store calls; a typical case (I = 2, 5 files) is about 67.

**Other requesters:**
- An explicit task replaces the resolver with `readGoalPlanWindow`, which is 2–4 reads.
- A module requester costs 1 + 5(2 + I) + 5 × (number of module paths) ordered scans.

**After the set is built:**
- Each head is decoded once per call (S2.7).
- Seeding the check's head cache with these anchor sets (S2.3) means the conflict and over-quota checks for related items add no reads.
- Segment 2's cost is today's unscoped cost, and only on pages that reach it.
- How long one lookup takes after round 2 is unknown and needs measuring.

**New source:** about 380 lines, budget 400:
- new `notes/note-related-scope.ts`, about 200 (fact reads, pure builder, predicate);
- `memoryFind` changes, about 130;
- types, about 25;
- schema field, resolver and composition wiring, about 25.

**Reused:**
- `headsByAnchorKey` (:187);
- `headsOnPathPrefix`, generalised to any key prefix (:509);
- `headInScope`, `sliceByCursor`, `fitToByteBound`, `rankMatches` and the cursor encode/parse functions (:561-790);
- `anchorExistsNow`;
- `readPlan` / `readGoalPlanWindow` (plan-readers.ts:438, :967);
- `RUN_BY_TASK_INDEX`;
- `decodeRunActivitySnapshot`;
- `moduleOfAnchor`;
- `NoteRunFactResolver`.

**Not reused:** `graph-context-reader` and `node-detail-reader` (both in views, and both read too widely).

## 5. TESTS (public `NoteMemoryReadPort` on both backends, plus `find_graph` under NE4)

**Fixture.** Modules M (`src/m`, interfaces I1 and I2), M1 (`src/m/one`) and N (`src/n`). Task t1 is in stage s1, scoped to M, and has an ended run that changed `src/n/z.ts`. Task t2 is scoped to N. Notes, all `accepted` and created in this order:

| Note | Anchor |
| --- | --- |
| n01 | t1 |
| n02 | s1 |
| n03 | g1 |
| n04 | M |
| n05 | M/I1 |
| n06 | `src/n/z.ts` |
| n07 | project, kind `convention` |
| n08 | t2 |
| n09 | N |
| n10 | `src/m/x.ts` |
| n11 | `src/m/one/y.ts` |

**Rows:**
- **F-01: task requester t1, no terms, `limit: 4`.**
  - Page 1: n01–n04, all related.
  - Page 2: n05, n06, n07 related, then n08 project; `projectStartsAt: 2`, `relatedEnded: true`.
  - Page 3: n09, n10, n11; `complete: true`.
- **F-02: module requester M.** Related: n04, n05, n07, n10. n11 is project, because M1 owns it. A `"."` module owns no files.
- **F-03: `'any'`, terms `[jwt, token]`, requester t1.** Related r1 has `jwt` in its topic and `token` in its body. Related r2 has `token` in its conclusion. Project p1 has `token` in its topic.
  - Segment 1, U = 2: r1 = 3·ln3 + ln2 = 3.9890; r2 = 2·ln2 = 1.3863.
  - Segment 2, U = 1: p1 = 3·ln2 = 2.0794.
  - Expected order: r1, r2, p1 (p1 scores higher than r2 but comes after it).
  - Under the one-ranking alternative, r1 would be 4.8520.
- **F-04: filters across segments.** `kind: 'general'` filters both segments. A `project` understanding is not in the related set.
- **F-05: cursor and trim.**
  - A small injected byte bound trims a mixed page; the next page starts at the project segment and `boundary` is recomputed.
  - A rule-1 cursor → `cursor_mismatch`.
  - Reusing a cursor with a changed `related` → `cursor_mismatch`.
  - A new RunActivity between pages → `revision_conflict`.
- **F-06: the tool path (NE4).**
  - A work Run that omits `related` gets segments for its own task.
  - `related: null` gives no `segment` fields and no `boundary`.
  - With an `anchor`, there are no segments.
  - A query Run gets no segments.
  - A task that does not exist → `not_found` / `related_not_found`.
  - G-02's strict union now includes `related`.
- **F-07: files.** With the cap injected as 2, `filesOmitted` is 1. A run still in progress adds no files.
- **F-08: cost.** A counting wrapper on the public store ports (needs a §7 exception) shows that a page staying inside segment 1 makes no text-port calls and stays within the call budget above.

**Regression.** T-07, T-09 and M-09 run unchanged, because a find without `related` has no segments.