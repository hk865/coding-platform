# RAT-00 multi-agent fixtures v1

This is a local, self-authored collaboration acceptance set for RAT-08. It is not a public benchmark or a product test result. All 42 registered model trials are NOT_RUN.

## Contents and boundaries

- `base/`: shared runnable Taskboard baseline, browser UI + HTTP API + JSON data layer + public smoke tests. No package installation or network dependency is needed.
- `public/MA-01` … `public/MA-08`: model-visible task text.
- `private/evaluator/`: hidden executable code and normalized-trace evaluators and selfchecks.
- `private/oracles/`, `private/near-miss/`, `private/labels.json`: hidden reference fixes, defective controls and labels.
- `private/injections/`: deterministic test-input plans and directive selector. These are never discoveries from a model.
- `manifest.json`, `trials.json`, `role-templates.json`, `budgets.json`: evaluator/control-plane metadata; do not copy them into the model workspace.

Use `node materialize.mjs MA-01 /absolute/fresh/workspace` to copy only the shared base and one TASK.md. The destination must not exist and visible files must have no symlinks. Copying is not an OS sandbox. Before real execution, verify the actual runtime cannot read sibling assets, hidden evaluators, other trials or credentials. RAT-00 does not establish that runtime isolation through this helper.

## Scoring and evidence layers

The functional evaluator runs candidate code through an actual local HTTP listener and the candidate's frontend controller/render function. A bounded DOM port exercises actual mounted event handlers, and reconstructing the controller with shared storage checks persisted filters. This is NOT a browser engine: actual browser loading, rendering, storage and GUI interaction remain NOT_PREPARED here and belong to the later browser/GUI acceptance stage.

The normalized-trace evaluator checks concrete timing, versions, accepted artifact consumption, lease intervals, side-effect records and control outcomes. Its known controls are synthetic observations labeled `constructed-evaluator-selftest-only`. A platform export adapter, independent authentication against raw events/artifacts, and real process-fault injection are NOT_PREPARED. Passing synthetic controls proves only that the evaluator accepts/rejects its known inputs. It never proves platform behavior. The injection selector only chooses a directive once its declared trigger has appeared; actual privileged operations must be bound to the product adapter later.

The single-Agent ablation uses the same task, baseline, public tools and total trial budget. Distinct-Run collaboration metrics are NOT_APPLICABLE for that group. Serial and parallel groups share the same role assignments; only Reader concurrency changes. All final candidates receive the same independent external functional scoring. MA-04 … MA-08 have separate fault metrics and are not averaged with single-Agent results.

## Repeatable local selfchecks

From the fixture directory, with an absolute EVIDENCE path outside the model workspace:

```text
node private/evaluator/functional-selftest.mjs EVIDENCE/functional
node private/evaluator/control-selftest.mjs EVIDENCE/control
node private/evaluator/injection-selftest.mjs EVIDENCE/injections
```

Direct scoring commands:

```text
node private/evaluator/functional.mjs /absolute/candidate filter
node private/evaluator/functional.mjs /absolute/candidate pagination
node private/evaluator/functional.mjs /absolute/candidate case-sensitive
node private/evaluator/control.mjs /absolute/normalized-trace.json
```

Functional controls retain all base/oracle/repeat/near-miss outcomes. Control selfchecks retain all positive and negative observations. No model, API key, provider or product server is used by these selfchecks. Reference corrections are evaluator-owned test assets, not agent-produced fixes.

## Frozen limits and execution gates

`budgets.json` is the only resource-limit authority in this asset set. This small project uses a total across all roles of 1,000,000 input tokens, 64,000 output tokens and 900 seconds per trial. Each applicable configuration has three registered repeats. The separate future large-module role policy is referenced from the parent budget-policy.json and does not apply to this fixture. Provider/model and a USD cost ceiling remain unbound for RAT-01; no real trial may begin until binding, enforcement, isolation and evidence collection are ready.

Code versions, task text, assertions and thresholds must remain fixed before real model outcomes. A real run must preserve all trials, failed checks, repeated attempts, session/tool timestamps, accepted artifact revisions and consumption refs, messages/correlation, lease changes, injection records, candidate digests and provider usage. The minimum gate requires all applicable mandatory assertions across the registered repeats, zero unauthorized writes, zero duplicate side effects and zero completion from stale evidence. Efficiency is reported separately without a required multi-agent speedup.
