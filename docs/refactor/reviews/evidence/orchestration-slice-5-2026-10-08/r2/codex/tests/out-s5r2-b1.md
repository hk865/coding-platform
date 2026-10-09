**FILES**

- [tests/business/S5R2-automation-cards.test.ts](D:/cxt/s5r2-b1/tests/business/S5R2-automation-cards.test.ts)
- [tests/helpers/S5R2-b-support.ts](D:/cxt/s5r2-b1/tests/helpers/S5R2-b-support.ts)

Only these files were created. Node, npm, tests, and typechecking were not run, per `RULES.md`. Outcomes below are expected from static inspection.

**PER ROW**

- **R2B01 — GREEN:** Real entered RA → `recordRunResult(crashed)`; settings → every_step; Workflow emits confirmation. Assert committed answer, pending-application card, counts −1/+1, and unchanged TaskRequeue records.
- **R2B02 — GREEN:** Same setup, then operator Goal pause. Assert the same writable card, committed answer, pending-application state, and Goal remaining paused.
- **R2B03 — RED:** Real Run completion, disposition-only plan adoption, and evidence open/finalize produce a GV-10 gate head. Assert the emitted card before pause. Expected failure: `waitingCard(afterPause, …)` finds zero matches because `src/core/work-graph/state/decision-policy.ts:196` returns null for paused gates.
- **R2B04 — RED:** Same gate setup and pause; answer uses the emitted source with the actual pause receipt’s Goal pin. Expected failure: the `resolveDecision` result assertion expects ready/committed but receives `not_found` from `src/core/work-graph/communication/decision-source-facts.ts:318`.
- **R2B05 — GREEN:** Real crash and Workflow requeue commit under default autonomy; change to every_step and replay the captured perform input. Assert original receipt value/cursor/ref, `replayed:true`, no confirmation cause, identical store snapshot, and unchanged allocation/runtime counters.

**UNDETERMINED**

- **R2B03/B04:** Gate `select_work` currently returns a perform step (`src/business/workflow/workflow.ts:968–969`). Tests follow that exact step to obtain confirmation before pausing; the table describes selection returning waiting directly.
- **R2B03/B04:** The frozen fixture requires kind `test` (`tests/helpers/S5-decision-fixture.ts:393`), while registered checks support static/dynamic (`src/contracts/verification.ts:43`). Setup uses a real uncovered-requirement `INCONCLUSIVE` round, without executing checks.
- **R2B01:** Uniqueness is asserted for the emitted cause key. The reader also includes display causes (`src/core/work-graph/tasks/goal-decision-reader.ts:426`), so the test does not require the entire queue to contain only one goal-cause card.

**RISKS**

- Lead should first verify gate plan adoption and evidence setup at `tests/helpers/S5R2-b-support.ts:248`, `:257`, and `:267`.
- Real isolated-source capture and owner assembly at `tests/helpers/S5R2-b-support.ts:84` remain unexecuted.