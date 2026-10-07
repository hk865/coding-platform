# Lead calls on design round 34 (2026-10-07 ~01:40)

Read: FINAL, QUESTIONS (all), STATE (all), D-PLACEMENT (all). Spot-checked at HEAD 42604b3: attention-observer.ts:504 (`edge.requires` concatenated → [object Object]) ✓; session-availability.ts:621-634 (archive → dependency_blocked on open responsible link) ✓; host.ts:1074-1086 (failed notify delivery retried every cycle) ✓; plan-service.ts:1704 readTaskInput, :1763 `usage: 'current'` ✓; materials/applicability.ts:35-36 host vs run admission, :100-116 grant branch ✓.

## Fixes I made to the deliverables
- Q15: the canvas v14 board draws option 乙 (composer "发给：秘书（主对话）· 记在‘<选中目标>’的对话里", Goals.dc.html:245; Main.dc.html:3251-3262 routes by `st.goal || 'g1'`; no project-level line). Recommendation changed 甲 → 乙 (follow the approved prototype). STRUCTURE-DRAFT line 430 aligned. Count stays 23.

## Calls that are mine (not user questions) — apply in the simplification batch
1. **#8 variant accepted.** The handoff action is one primitive in AgentRuntime (AG6: actions in lifecycle/Runtime); Workflow owns only follow-ups.
2. **Exact-input read path (readTaskInput, plan-service.ts:1704-1763; execution-entry-service.ts:640-664; execution-preparation.ts:413-433): DELETE in simplification** as a grant-only read branch. It binds the version at planning time, which decision 6 removed from planning and decision 11 replaces with a consume-time check; without grants it can never succeed. Keep `dependsOn.requires {kind,label}` (plan.ts:171-180) and the prepared-execution manifest field — slice 3 (SD §1.6) rebuilds the check on them. Record the deletion and the slice-3 replacement in the spec/STATUS when deleting.
3. **materials/applicability.ts: keep hostAdmission (40-86) and the own-material path (93-98); delete only the grant branch (100-128)** with the grant writer.
4. **Keep `UserDecisionV1` (goal-change.ts:153-196) and the plan-machine branch that references it** until the user has seen "「需要你决定」用消息表示" in QUESTIONS "按已定推出" without objecting.
5. Deletion candidates the design does not use — let the usefulness audit confirm reachability, then delete: `HandoffPacketRef` (contracts/handoff.ts:5-11), `ExecutionNoteRef`, `ContinuationRecordRef` (contracts/context-continuity.ts:12-25), the never-executed consumed-reply branch (execution-preparation.ts:440-443). `apply_future_plan` tool: audit decides (not granted in production, host.ts:509).
6. Keep (design will use): role specs; architecture catalog revision / compare / impact ports; reviewer contracts; the "memory" input-source kind; query "focus tasks" field; requeue historySource; consultation derivation on messages.
7. Not in task D: WorkGraph public entry file (after D); new orchestration rules go to Workflow, not Host drivers.

## For the user (morning)
Lead with Q1, Q7, Q20; Q15 now follows the prototype. Ask them only to name the recommendations they disagree with. After their answers: put the design into repo docs (decision 35+), then slices.
