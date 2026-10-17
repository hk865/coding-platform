# Decision 72 reuse review: lead rulings (2026-10-16 night)

Inputs: codex2/reuse-a.out.md (6/7/8 among themselves), codex2/reuse-b.out.md (K3 g3-4 + 4C vs 6/7/8); two Claude
subagent verifications (A: all code cites hold, 3 owner slices wrong, 2 "contradictions" already settled; B: 4 confirmed,
6 partly, none wrong). No product question needs the user: the three flagged "product choices" are settled by existing
decisions (below). Product scope unchanged.

## Into books now

### 4C-1 (running; fold into the 4C-1 rework round after Codex impl review)
- **U1 record_note commandId.** The tool's `commandId` is derived deterministically from `requestIdForCall`
  (`execution-driver.ts:464`), never random; extract the pure arguments -> write-request builder so the owner lookup can
  rebuild the same request. Owner `lookupToolCommit` and the K3 L3 platform-tool row are wired at the second of the
  K3/4C merges (K3 spec :167 already says so). (B7)
- **U2 one path-ownership function.** One pure function (directory boundary, longest prefix, ties reported) in
  `work-graph/notes/` or `architecture/` (notes may not import views, slice-4 :234/:804). Callers: scribe-scope
  (`moduleOfAnchor`, :79-101, template-literal `startsWith`), 4C-1 `find` (graph-context-reader, C1.1/G-04),
  `node-detail-reader.ts:728` (also accepts `\`), `goal-conflicts.ts:470/492`. No `.` root semantics now
  (`architecture-source.ts:34` rejects `.`); 8A changes only this function (slice-8 :113). Post-note slice-4 §11.7 reuse
  item (:916, "export moduleOfAnchor" -> the shared function). (A11, B8)

### K3 group 3 book
- (U3 moved to "K3 g4 / 4C-2" below: L19 is the card application step, group 4; corrected e7abcc90.)
- **U4 Workflow task-gate result.** Workflow UR rows: a finite gate result {pass | skip(blocker source) |
  perform review step}; one function for goal-level selection and named-task selection; owner commit guards stay.
  Do NOT change `automationConfirmation`'s goal-wide early return (`workflow.ts:1363`) - that is 7B L46. (B6)
- **U5 read-only command capability.** `reviewCapability` probes with the same options as the real tool; share the
  registration/tool construction duplicated at `execution-driver.ts:840-863` and `query-execution.ts:361-384`.
  K3-internal dedupe; the 6A secretary Query keeps the existing Query registration. (B9)

### K3 group 4 book and 4C-2 book (whichever is written first builds; the other adds a row)
- **U3 proof-event decoder table.** K3 L19 adds `UnknownCallReviewChanged` (K3 :442); 4C-2 adds the note-card proof
  (slice-4 :225). Make `decision-application.ts` proof decoding a table keyed by event type (owner registers decoder +
  check); existing GoalSettingsChanged/PlanRevisionAccepted become rows. 6C (ArchitectureCatalogAdopted,
  ProjectCompletionPolicyActivated), 7A (message application, S7 :684 "new validator" -> reuse the common receipt
  core) and 8C add rows. (A4, B1)
- **U6 application dispatch.** `resolveDecision` steps 2-3 dispatch by source kind to an adapter
  {apply(answer) -> commit, proof(answer) -> lookup, replay}; manual retry, Workflow and start-up re-apply all call one
  advance function; "approval recorded, effect not yet applied" is a legal state (8C, S7 :328). K3 g4 (K3 :1555) and
  4C-2 (slice-4 :225) both add branches -> same shape in both books; the second merge adapts. Splitting
  `listUnappliedAnswers` is NOT required (K3's index is goal-keyed and UCR is always goal-keyed). (B1)
- **U7 card-source paging adapter.** One "assemble once per attempt -> page" adapter; a source supplies collection read,
  stable key, projection, closed check; single card by key read directly (K3 L24 :645-647). Replace the hand-kept
  `sourceNeedsGoal` (`decision-read-model.ts:1248-1250`) with a per-source registration property. The three existing
  hand-rolled sources (automatic-rework-notices :185, undelivered-reply-notices :185, planning-question-reader :141/213)
  migrate in cleanup C1 (decision 70). Gate rules stay per source (slice-4 :916). (B2)

### 4C-2 book only
- **U8 memory material function.** Shape: project + optional goal/stage/task -> {project understanding, norms, local
  understanding, general index, reminders}; one read window per assembly; caller picks parts. Design the optional goal
  in the type now; the null-goal branch is built and tested in 6A (no user before; plan-judged :43). (B3)
- **U9 notice summary projection.** Pure function: raw items + grouping strategy -> counts, member identities, display
  positions; 4C's "user-related listed separately, rest folded per goal" is one strategy; 6A main conversation and the
  queue share it; 7D2 adds the time-window strategy (S7 :308, no stored summary). Seen positions only advance on
  members actually shown (DESIGN :230). (B4)
- **U10 reminder delivery shell.** New code for scribe reminders (slice-4 :877 forbids changing attention in 4C):
  scope facts once -> to-dos -> recipient resolver -> idempotent delivery; the project-scribe fallback (slice-4 :870)
  lives in one resolver that 7D replaces; 7C's attention work adopts the shell (S7 :686). (B5)

## Spec post-notes before 6A (lead writes; one docs commit)
- **S6 L3-L5 (A1):** one request-round entry over the Query stage driver ("same Job, old Run abandoned, new Run");
  7B supplies reply/expiry inputs only; 7D2 exploration reuses the lower driver. The unassigned-queue index shape is
  still to be ruled in the 6A plan (plan-judged :126-128), not already ruled.
- **S6 L4 (A2):** one role-line creation entry over Runtime two-stage create (identity, fixed duty, scope, creator,
  reason, reservation step); 6B successor, 7C members, 7D2 role lines call it; S7 §1 reservations fill the step.
  The 6A cap-stall risk (plan-judged :57-59) is ruled in the 6A plan.
- **S6 L10 + S7 L18 + H-01 (A6, contradiction 4):** one handoff primitive built in 6B with the general identity: a
  `handoff` SessionOperation (source, assignments, stages); creating the successor is a child operation of it; the
  secretary handoff is one assignment to a new line plus the routing step. Stage order everywhere: understanding check
  -> fence -> old writer stopped -> create or select successor(s) -> transfer -> (secretary) routing -> archive ->
  notice. S7 L18 already says the tool's handoff runs after the run ends, so H-01's t1/t2 swap; crash points unchanged.
- **S6 L15 + S7 L38 (A6, contradiction 3):** one idle clock for secretaries, advisers and scribes: one full day from the
  last activity (model round end, a message to handle arriving, the user's action on it, line creation; notices do not
  count) - the reading of decision 60-8 "闲满一天" both specs claim. Keep: the most recently used usable line per duty.
- **S7 L38 (A3, contradiction 2):** "每种职责的项目范围由一条线负责" applies to advisers and scribes; secretary project
  scope is a filter (S7 :176, decision 60-3), several project secretaries allowed.
- **S7 L23-L25 (A3):** `planReanchor` stays in 7D1 (no goal/project links exist before 7D1/7D2; S6 :394).
- **S6 L11/§6/§7, S7 §6 :688 (A8, contradiction 1):** the goal-less initialization binding read path (plans/propose,
  plans/apply, plan read from `InitializationBindingV1`; `plan-service.ts:1147`, `initial-plan.ts`) moves to 6B, where
  the binding is written; 7D2 cold start and 6C reuse it; R-14's propose/apply part is accepted in 6B. If the 6B book
  finds a blocker, it reports and the lead rules.
- **Notice/card subject (A10, B2 option B):** 4C keeps its frozen deferral (slice-4 :837/:896). The first post-4C need
  is 6B's handoff notice for a project-scope secretary (S6 :137): the goal|project subject base for notices and cards
  (without 7D1's cross-workspace answer identity) moves to 6B, designed for 4C's two deferred uses and slice 7's;
  7D1 adds the cross-workspace identity. Fix slice-4 wording "第 7 片 D2" to name where the base lands.
- **S6 L16 (A5):** 6A builds on cleanup C1's merged activity classifier (VW-3), no second dedupe.
- **S6 L5 + S7 L12 (A7):** 6A extracts the minimal commit-wake + bounded drain + start-up rebuild loop; 7B adds
  derived waits and expiry inputs; 7D2 registers its queue drain. Queue orderings stay separate.
- **S8 §2 + L6 (A9):** catalog pin type moves to 8A (used at S8 :107/:131); 8C is the single revision writer; S7's
  structural batch text is a reference to 8C's definition.
- **S8 L7 :113:** the root `.` sweep is one function (U2); list the scribe template-literal and node-detail-reader.
- **Stale text:** S6 :183 ("秘书的查询不计数") and S7 :335 (changed files decide "too long") corrected to the bodies
  (S6 :168/:178; S7 :205).
- **6A plan:** R-05 cannot be fixtured in 6A (goalAttribution written only by 6B) - already noted plan-judged :25.

## Replace-later register (keep in STATUS gaps or the specs)
project subject (4C -> 6B base -> 7D1 identity); scribe recipient fallback (4C -> 7D); Query memory seam
(`note-service.ts:115` refuses all query runs -> 6B/7D2 secretary and exploration writes); root `.` (8A, one function).
