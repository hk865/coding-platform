**Project-level current understanding (decision 67 item 3): addendum input for 4C**

## 1. FACTS

**Spec**
- L4 step 2 (§0.3) says "当前理解只能挂目标或阶段（O35）". L2a class 3 refuses an understanding on any other anchor with `invalid`. N-02 tests the task-anchor refusal.
- L8 says the CurrentPointer key is (project, anchorKey) and "只有目标、阶段锚点". MODEL O34 and DESIGN §3.6 (the "上限" row) say "目标、阶段各 1 条当前理解".
- L5: the note's goal is the writer's Run goal. A user's write with a null goal may use project, module, interface and file anchors.
- L9: an `accepted` note counts as a current conclusion only in its own goal or when the user confirmed it. Other goals see it only once it is `reviewed` or user-confirmed.
- L20: the Goal card holds only the `understanding` part, at most 2 rows (pointer, version, conclusion, availability). The project norms do not appear. A Query also gets only the understanding.
- L16: the updateDue count covers goal and stage anchors. §10 P3 moved updateDue to 4C, and the lead names the trigger sources.
- Slice-7 L2: every "请动手" (dispatch) is checked against `pointerRevision`, which is the goal's own pointer.

**Code**
- O35 is enforced in exactly one place on the write side: `note-service.ts:649-653`. `admitNoteWrite` (`note-machine.ts:52-71`) has no anchor rule.
- The pointer codec accepts any non-empty anchorKey (`note-record-codecs.ts:427-436`). The project key is `'project'` (`note-anchors.ts:391`). So no record or codec change is needed.
- The write path's pointer check (expectedPointerRevision) is already keyed on the main anchor key and works for any anchor (`note-service.ts:784-797`). The same holds for accept, which moves the pointer (`:1045`).
- The read side is limited to goal and stage in four places:
  - `pointerOf` (`note-read-model.ts:404`)
  - `understandingOf` (`:1027`)
  - the P9 comment (`note-contracts.ts:145`)
  - `plan_changed` (`note-views.ts:547`)
- Goal handling:
  - The stored `goalId` is `caller.goalId` (`note-service.ts:887`).
  - The goal quota counts every kind, understanding included (`:834-847`). The anchor quota counts general kinds only (`:825`).
  - An accepted note is current only when `head.goalId === callerGoalId` or the user confirmed it (`note-views.ts:972-976`).
  - `isCrossGoal` (`note-read-model.ts:483`) treats `goalId: null` as cross-goal for every work Run.
  - Consequence: under today's rules, an accepted project understanding is not current for any other goal.
- Scribe scope:
  - A project scribe is a scribe with no open responsible module link (`scribe-scope.ts:218`).
  - A project anchor always resolves to the project scope (`:229`).
  - A project scribe may use every anchor (`:358`). A region scribe is refused non-module anchors (`:360`).
  - `manages(ctx, session, {kind:'project'})` exists (`:369-374`).
  - The root-prefix `'.'` case (`:81`, deferred to 8A by §9) has no effect here, because the project anchor is not path-based.
  - `resolveResponsibleLine` does not exist in code; 7D adds it.
- Callers: `query_run` callers cannot write (`note-service.ts:115`). The only goal-less writer is the user.
- Basis: with `goalId: null`, `basisPlanRevision` is null (`note-anchors.ts:519-524`).
- Assembly:
  - Notes are `notImplemented` (`context-extensions.ts:312`).
  - The Goal card is a required section outside the budget (`context-assembler.ts:218-221`). Only the optional sections are budgeted (`:172-201`), sorted by key within a section (`:173`), with a default of 4096 bytes (`:822`).
  - The Query context reuses `goalPayload` (`:1047`).
- `memoryFind` has no project prefix and no default state filter (`note-read-model.ts:1434-1561`).
- `lookup` checks every head on the page and only then filters by state (`:1155-1166`). This is "b11", deferred to 4C by the speed-round book S2.9.

## 2. GAPS
1. Which writers may write the project understanding, and in what state it lands.
2. Its goalId. A writer's goal would count it against that goal's quota and hide it from other goals.
3. Whether all other goals may use it while it is only `accepted`.
4. The size cap, and whether every context gets the whole body or one row.
5. What "项目级的已审规范" (project-level reviewed norms) means: which kinds, which states, main anchor only or not, and how many.
6. How `find` "brings it first": a header, or extra items; every page or only the first.
7. updateDue triggers for the project, and which scribe gets the reminder.
8. Whether the project pointer joins the dispatch check.
9. Extra anchors on a project understanding.
10. Where the person sees and edits it. `GraphNodeRefV1` has no project node (F4).
11. The project anchor keeps every replaced project understanding as a head. Anchor-set reads grow with that history.

## 3. PROPOSAL

**R1 Anchor and pointer (lead).**
- Allow `kind:'understanding'` on `{kind:'project'}`. The pointer is `CurrentPointerRef{projectId, anchorKey:'project'}`. It uses the same L8 check and conflict reply.
- Amend L4.2, L2a class 3 and L8 to "目标、阶段或项目".
- `pointerOf` and `understandingOf` accept project. `lookup` on the project anchor returns `UnderstandingStatusV1{anchorKey:'project'}`.
- No extra anchors on a project understanding (`invalid`, `project_understanding_extra_anchors`). This keeps it out of module lookups.

**R2 goalId is always null (lead).**
- Whoever writes it, the head has `goalId: null`, and `resolveNoteAnchors` gets `goalId: null`, so the basis plan is null.
- `plan_changed` does not apply. Freshness comes from basis files, facts and basis notes.
- It counts in no goal quota.

**R3 Who writes (product, for the user).**
- (a, recommended) The project scribe, meaning `scopes.manages(…, {kind:'project'})` is true, and the user through `notes/write`. Anyone else gets `forbidden`, `project_understanding_scribe_only`; they write project-anchored general notes instead, which the scribe gathers.
- (b) Any agent may write, but its write goes to pending review for the scribe. This adds review load, against decision 68.
- (c) The user only. Against decision 68.
- Withdraw stays as in L6.
- Follow-on choice: when the current version was written by the user, does a scribe rewrite (i) commit and send the user a "请知悉" notice (recommended), or (ii) wait for the user to accept it?
- Dependency: today the scribe can only write from inside some goal's Run (`note-service.ts:115`). Slice 6/7D's goal-less role calls must reuse this rule.

**R4 Usable everywhere (lead).**
- In `note-views.ts:973`, `ownGoalEligible` also holds for `kind==='understanding' && anchor.kind==='project'`. Its item carries `crossGoal: false`.
- The writer set is limited to the curator and the user, so no second review step is needed.
- Alternative: the scribe writes, then reviews. That is two commits, and the note is invisible in between.

**R5 Cap (product).**
- (a, recommended) `PROJECT_UNDERSTANDING_BODY_MAX_BYTES = 4096`, injectable, same five sections. It is smaller because the body goes into every context.
- (b) Keep 6,144.
- (c) Context gets one row only; the body is read with `look`.

**R6 Context assembly (product for body vs row; the rest lead).**
- `understanding` grows to at most 3 rows, in the order project, goal, stage.
- Under R5(a) the Goal card renders the project body in full (it is unbudgeted). Under R5(c) it renders one row.
- Project norms are defined as heads with main anchor `project` (anchorKey0) that are currentEligible, `reviewed` or user-confirmed, of kinds:
  - (recommended) `convention`, `decision`, `preference`;
  - or `convention` only.
- They go into the Goal card under the understanding, as `renderNoteHeader` lines, at most `PROJECT_NORMS_CONTEXT_MAX = 10`, with "另有 n 条，用‘看’读".
- The alternative of putting them first in the budgeted notes section needs keys that sort first, and they can be cut by the budget.
- Product sub-choice: the project anchor's general-note quota is `NOTE_ANCHOR_QUOTA = 5`. Is that enough for norms, or does the project anchor get its own quota?
- The budget area drops anything already in the Goal card.
- Query contexts get the same rows (L20). Slice 6 must add them to the secretary's context.

**R7 find (product for the shape).**
- When `cursor === null`, `MemoryResultV1` gains `project: { understanding: {noteId, version, revision, conclusion, currentEligible} | null; norms: {noteId, version, label}[]; complete: boolean }`. Later pages omit it.
- The header and the page items share one `checkHeads` call (S2.5).
- Items keep their meaning: a matching norm still appears in the ranked items.
- Alternatives: a header on every page, or the full body in the header.

**R8 updateDue and reminder (lead).**
- (a, smallest) Project `updateDue: null` in 4C.
- (b) Due when, since the last text version, a project-anchored note became reviewed, confirmed or withdrawn, or a new catalog revision was adopted. Whether a cursor exists for goal terminal states is unknown.
- The reminder goes to `resolveResponsibleLine({kind:'project'}, 'scribe')`, which is the opening scribe today.

**R9 Dispatch (lead).** The project pointer is not part of slice-7 L2's pins. Otherwise every project edit would conflict with every goal's dispatch.

**R10 b11 (lead).** `lookup` filters by the decision-67 default states before slicing and checking. Otherwise replaced project understandings take page slots.

**UI (product, E3).** Where the person sees and edits it, for example a "项目" entry in the goal bar.

## 4. COST
- **Per context assembly, project part:**
  - one `readMany` for all three pointers (project, goal, stage);
  - one `readMany` for the pointed heads;
  - `ceil(H/200)` lookups on index `anchorKey0=project` for norms, where H is every head ever written on the project main anchor;
  - one `checkHeads` (S2.5) for at most 1 + 10 items. Its reads per item are 16 facts and 32 files, which come out of the per-page file budget.
- **find:** the same additions on the first page only; zero on later pages.
- **write:** today's understanding path plus one `manages` (`deriveFacts`: sessions are paged at 200, plus one catalog read).
- **Acceptance rows:** these counts, measured with a call-counting store wrapper. A scale row: the 20,000-note set with H = 200.
- **New source lines:** roughly 170–230; R8(b) adds about 40.
  - note-service ~25
  - note-read-model ~70
  - note-views ~10
  - note-contracts ~15
  - context-extensions ~50 (inside L20's work)
  - context-assembler ~20
  - skill text excluded
- **Reuses:** the CurrentPointer records and check, `resolveNoteAnchors`, `ScribeScope.manages`, `headsByAnchorKey` (anchorKey0 only), `checkHeads`, the per-call head cache (S2.3, seeded with the project anchor set), `renderNoteHeader`, and `renderUnderstandingBody`.

## 5. TESTS
New rows with hand-computed expectations, through public interfaces only:
- **PU-01 (NE1/NE7)**
  - The project scribe writes with `expectedPointerRevision: null`: accepted, goalId null, pointer revision 1.
  - A second write with revision null: `revision_conflict` with the pointer.
  - An executor in g1: `forbidden`, `project_understanding_scribe_only`.
  - Region scribe SA (N-10 fixture): `anchor_out_of_scope`.
  - The user through `notes/write`: accepted, `confirmedByUser`.
  - Body boundary 4,096 accepted, 4,097 refused.
  - With extra anchors: `invalid`.
  - N-02 still refuses a task anchor.
- **PU-02 (NE3)**
  - A work Run in g2 runs `lookup {kind:'project'}`: the understanding's pointer is returned, the item is `currentEligible: true`, `crossGoal: false`.
  - It does not appear in g1's goal count.
- **PU-03 (NE5)**
  - The Goal card shows project, goal and stage understandings in that order.
  - Two reviewed project conventions appear; an accepted-only convention from another goal and a reviewed project `pitfall` do not.
  - With `contextResidentBytes: 0` the norms still appear.
  - The budget area does not repeat them.
- **PU-04 (NE4)**
  - `find_graph memory.find` with terms that hit nothing on the project anchor: page 1 carries `project` with the understanding and norms; page 2 does not.
  - A matching norm also appears in the items.
- **PU-05 (NE6, if R8(b))** A project-anchored note is reviewed: the reminder goes to S0, deduplicated by `(project, cursor, S0)`.
- **PU-06 (cost)** The store-read counts from §4 on both backends.