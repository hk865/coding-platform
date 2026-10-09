**FILES**

- [S5R2-settings-replay.test.ts](D:/cxt/s5r2-c1/tests/business/S5R2-settings-replay.test.ts)
- [S5R2-c-support.ts](D:/cxt/s5r2-c1/tests/helpers/S5R2-c-support.ts)

**PER ROW** — each runs under memory and SQLite.

- **R2C01:** Real conflict resolution → pause/resume A; asserts three exact replayed receipts and unchanged store/allocation counters.
- **R2C02:** First resolution succeeds; retry injects unavailable A task-graph reads. Expected RED at the action-receipt comparison, because [decision-actions.ts:176](D:/cxt/s5r2-c1/src/business/workflow/decision-actions.ts:176) reads before replay.
- **R2C03:** Real conflict reorder → change C’s autonomy; asserts all three original receipts replay without writes or allocations.
- **R2C04:** First reorder succeeds; retry injects unavailable C-settings reads. Expected RED at the action-receipt comparison, because [decision-actions.ts:155](D:/cxt/s5r2-c1/src/business/workflow/decision-actions.ts:155) reads before replay.
- **R2C05:** Pause A → answer → busy/awaiting_resume → resume → retry; asserts fresh application, B waiting for A, and proof retaining captured A@8.
- **R2C06:** Real answer ref with only workspace changed to W2; `reorderGoals` must return forbidden with zero writes.
- **R2C07:** Same ref construction; `resolveGoalConflict` must return forbidden with zero writes.
- **R2C08:** Real claim/entry/settlement, PASS rounds, task/Goal completion, then PA2 adoption; asserts PA1’s saved completion remains and both readers expose the same waiting conflict.

**UNDETERMINED:** None identified through source inspection.

**RISKS:** Tests and typechecking were not run, per RULES.md. Check R2C08’s new completion setup first: [verification](D:/cxt/s5r2-c1/tests/helpers/S5R2-c-support.ts:1014), [Goal completion](D:/cxt/s5r2-c1/tests/helpers/S5R2-c-support.ts:1041), and [PA2 adoption](D:/cxt/s5r2-c1/tests/helpers/S5R2-c-support.ts:1066). Its copied fixture uses supported `static` requirements before initial adoption.