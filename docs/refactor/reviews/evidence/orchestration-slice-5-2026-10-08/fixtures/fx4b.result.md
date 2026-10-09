FILES:

- [S5-goal-settings.test.ts](/D:/cxt/impl-s5-fx4b/tests/work-graph/S5-goal-settings.test.ts)
- [S5-goal-settings-support.ts](/D:/cxt/impl-s5-fx4b/tests/helpers/S5-goal-settings-support.ts)

PER CASE:

First stubs below assume the D9 source blocker described under RISKS is corrected.

| Case | Status | History / first stub |
|---|---|---|
| SS01 | KEPT | Real RA, set autonomy → `setGoalSettings` |
| SS02 | KEPT | Set, cancel, replay → `setGoalSettings` |
| SS03 | KEPT | Set, conflicting identity reuse → `setGoalSettings` |
| SS04 | KEPT | Read/answer conflict, accept risk, reorder → `queryGoalConflicts` |
| SS05 | KEPT | Incomplete order list → `reorderGoals` |
| SS06 | KEPT | Accept risk, reorder, read labels → `queryGoalConflicts` |
| SS07 | KEPT | Accept risk, real PA2 adoption → `queryGoalConflicts` |
| SS08 | REWRITTEN | Real PB2 adoption; free-task claim barrier; waiting wins → `setGoalSettings` |
| SS09 | REWRITTEN | Real PB2 adoption; wait, cancel predecessor, first claim → `setGoalSettings` |
| SS10 | KEPT | Save settings/risk, reopen SQLite → `queryGoalConflicts` |
| SS11 | KEPT | Real pause, conflict answer, resume, apply → `queryGoalConflicts` |
| SS12 | KEPT | Answer, resume, change autonomy, reject application → `queryGoalConflicts` |
| SS13 | REWRITTEN | Adopt two free tasks; claim one, set wait, refuse the other → `setGoalSettings` |
| SS14 | KEPT | Save settings, pause/resume, replay receipts → `queryGoalConflicts` |
| SS15 | KEPT | Answer paused, change/restore settings, resume/apply → `queryGoalConflicts` |
| SS16 | KEPT | Real unentered RB; wait then authorize → `setGoalSettings` |

FINDINGS:

- rv3 #3: DONE — genuinely free PB2 tasks; RA/RB preserved; Goal pins updated.
- rv3 #1: DONE — stored question/response sources exclude their own message pin.
- rv3 #2: DONE — ordinary answer uses `SessionMessageResponded`.

UNDETERMINED:

- None in the spec.

RISKS:

- **Confirmed source blocker:** [message-record-codecs.ts:837](/D:/cxt/impl-s5-fx4b/src/core/work-graph/sessions/message-record-codecs.ts:837) calls `checkResponseSender`, which rejects Host actors before D9’s later allowance. The corrected answer seed therefore currently fails before every case’s stub. Requires a lead-owned source fix; no `src/` edits made.
- New adoption/claim histories were checked statically, without execution.

All 16 case IDs and both backends remain. No Node, npm, npx, tests, or typecheck ran.