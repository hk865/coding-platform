# Group B, second run: fix the gate setup of R2B03/R2B04 (only that)

Read RULES.md first. This checkout already contains your earlier files `tests/business/S5R2-automation-cards.test.ts` and
`tests/helpers/S5R2-b-support.ts` (unchanged since your first run) and the other groups' files (do not touch those).
You may change ONLY these two files.

The lead ran your tests with Node (real bwrap, memory):
- R2B01: fails at `S5R2-automation-cards.test.ts:104` — `readDecisionCard` with the Workflow's emitted
  `decisionCause.source` returns the card as `waiting_answer` (answer null) after the answer, while the queue's source
  returns `answered_pending_application`. The lead verified this is a REAL production defect (the Workflow's emitted
  source has no `goalBases`, §2.8 "每个用于答复的新source包含canonical goalBases", and the read model derives the
  Workspace for the answer lookup from `goalBases[0]`, `views/decision-read-model.ts:1202–1212`). **Do not change R2B01.**
- R2B02, R2B05: pass. Do not change them.
- **R2B03 and R2B04 fail at SETUP** — a test error that must be fixed: `gateHead` (`S5R2-b-support.ts:247`) proposes a
  plan that cancels every work Task; the plan validator refuses it:
  `{ code: 'missing_required_executable_task', message: 'at least one required executable task (required+work+active) is required', path: 'tasks' }`.

What to do: build the GV-9/GV-10 gate head WITHOUT leaving a "fix in progress" (GV-5: a required, active work Task in the
gate's SCOPE that is not yet satisfied, `src/core/work-graph/state/task-failure.ts` ~666–667 and where the gate view's
`fixInProgress` is computed — find it) and with a plan the validator accepts (at least one required + work + active
Task). Read the validator (`plan-validation.ts` or wherever `missing_required_executable_task` is raised) and the
gate-scope rule before you choose. Possible legal shapes (pick one that the code really accepts; do not forge state):
the required active work Task is OUTSIDE the gate's scope (e.g. the gate is stage-scoped and the work Task lives in
another stage — check that stage/module scopes are legal for a gate and that the gate still carries the required
obligation), or the work Task in the gate's scope is really satisfied through the production verification path. Then
keep the rest of R2B03/R2B04 as they are: assert the Workflow's emitted `auto_reverify` cause and the queue card before
the pause; the decisive assertions stay the queue after the pause (R2B03) and the answer result (R2B04).

Your final answer: as in RULES.md (FILES, PER ROW for R2B03/R2B04 only, UNDETERMINED, RISKS).
