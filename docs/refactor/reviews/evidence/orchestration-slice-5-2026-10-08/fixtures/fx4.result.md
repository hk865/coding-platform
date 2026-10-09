**FILES**

- Rewritten [S5-goal-settings.test.ts](D:/cxt/impl-s5-fx4/tests/work-graph/S5-goal-settings.test.ts).
- Created [S5-goal-settings-support.ts](D:/cxt/impl-s5-fx4/tests/helpers/S5-goal-settings-support.ts).

Only these files changed. No Node, npm, npx, typecheck, or tests ran.

**PER CASE**

All first-stub predictions are from static inspection.

| Case | Status and history | First part-1 stub |
|---|---|---|
| SS01 | REWRITTEN: settings owner; persisted event and unchanged RA | `GoalSettingsPort.setGoalSettings` |
| SS02 | REWRITTEN: settings → cancel → full replay and allocation checks | `GoalSettingsPort.setGoalSettings` |
| SS03 | REWRITTEN: settings → conflicting retry; store snapshot comparison | `GoalSettingsPort.setGoalSettings` |
| SS04 | REWRITTEN: conflict answer → risk acceptance → reorder; persisted A1/B0/C2 | `DecisionReadPort.queryGoalConflicts` |
| SS05 | REWRITTEN: incomplete reorder; store snapshot comparison | `GoalSettingsPort.reorderGoals` |
| SS06 | REWRITTEN: canonical conflict answer → acceptance → reorder; both labels | `DecisionReadPort.queryGoalConflicts` |
| SS07 | REWRITTEN: accepted risk → real PA2 propose/apply → new conflict identity | `DecisionReadPort.queryGoalConflicts` |
| SS08 | REWRITTEN: P/W claim held at commit → settings wins → CAS refusal | `GoalSettingsPort.setGoalSettings` |
| SS09 | REWRITTEN: wait → predecessor cancellation → real successful claim | `GoalSettingsPort.setGoalSettings` |
| SS10 | REWRITTEN: nondefault settings → same-file SQLite reopen → exact readback | `DecisionReadPort.queryGoalConflicts` |
| SS11 | REWRITTEN: real pause at B@7 → conflict answer → resume → rebase proof | `DecisionReadPort.queryGoalConflicts` |
| SS12 | REWRITTEN: paused conflict answer → resume → autonomy change → refusal | `DecisionReadPort.queryGoalConflicts` |
| SS13 | REWRITTEN: committed RB preserved → wait → free-task claim refused | `GoalSettingsPort.setGoalSettings` |
| SS14 | REWRITTEN: risk/settings/order → pause/resume → complete receipt replays | `DecisionReadPort.queryGoalConflicts` |
| SS15 | REWRITTEN: paused answer → change/restore settings → resume → exact rebase | `DecisionReadPort.queryGoalConflicts` |
| SS16 | REWRITTEN: wait → real S5 preparation/authorization → unchanged unbound RB | `GoalSettingsPort.setGoalSettings` |

**FINDINGS**

- Defect 8 — DONE: canonical A/B conflict answered through `answerDecision`.
- Defect 9 — DONE: persisted order corrected; rebase bases captured before changes.
- Defect 10 — DONE: P/W Sessions and controlled claim race; lease/Run preservation checked.
- Defect 11 — DONE: actual store snapshots replace commit counters.
- Defect 13 — DONE: complete replay value/cursor and unchanged allocation counters.
- Defect 14 — DONE: SS03/SS05 observe the actual store.
- SS01/SS16 — DONE: retained S5 reads and preparation/entry.
- Remaining flagged locations — DONE: rechecked and replaced their defective setups.

**UNDETERMINED**

None.

**RISKS**

- Execution remains unverified: catalog/adoption/pause bootstrap at helper lines 269, 296, 494; PA2 adoption at test line 170; claim barrier at line 449; reopen at helper line 756.
- Current `nextGoalDesiredState` drops settings. The helper avoids a setup TypeError; assertions still require part 2 to preserve them.