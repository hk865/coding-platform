## FILES CHANGED

`N` (21):
```
N src/contracts/graph-context.ts
N src/contracts/platform-duty.ts
N src/core/agent-runtime/context-assembler.ts
N src/core/agent-runtime/graph-tools.ts
N src/core/agent-runtime/role-profiles.ts
N src/core/work-graph/model/context-input-contracts.ts
N src/core/work-graph/model/graph-context-contracts.ts
N src/core/work-graph/state/context-input.ts
N src/core/work-graph/tasks/context-input-service.ts
N src/core/work-graph/views/graph-context-reader.ts
N tests/state/context-input.test.ts
N tests/work-graph/S3-context-inputs.test.ts
N tests/work-graph/S3-graph-context.test.ts
N tests/work-graph/S3-prepared-context-admission.test.ts
N tests/work-graph/S3-role-profiles.test.ts
N tests/runtime/S3-context-assembler.test.ts
N tests/runtime/S3-graph-tools.test.ts
N tests/app/S3-attention-context.test.ts
N tests/app/S3-graph-routes.test.ts
N tests/scenarios/S3-context-and-inputs.test.ts
N tests/scenarios/S3-query-graph.test.ts
```
`C` (21):
```
C src/app/attention-observer.ts
C src/app/core-http-types.ts
C src/app/core-routes.ts
C src/app/host.ts
C src/app/runtime-configuration.ts
C src/composition/create-platform.ts
C src/contracts/core/prepared-execution.ts
C src/contracts/role-spec.ts
C src/contracts/validation/role.ts
C src/core/agent-runtime/execution-contracts.ts
C src/core/agent-runtime/execution-driver.ts
C src/core/agent-runtime/execution-preparation.ts
C src/core/agent-runtime/ports.ts
C src/core/agent-runtime/query-execution.ts
C src/core/agent-runtime/query-preparation.ts
C src/core/agent-runtime/runtime.ts
C src/core/agent-runtime/session-discovery-tools.ts
C src/core/agent-runtime/whiteboard-tools.ts
C src/core/work-graph/queries/query-execution.ts
C src/core/work-graph/tasks/execution-entry-service.ts
C src/ui/api/routes.ts
```
Allowlist entries removed: **none**. `tests/architecture/production-reach.test.ts` passes 4/4 with the allowlist unchanged, so its stale-entry assertion found no reached `kept-for` entry to remove; rule 13 forbids adding entries, so `tests/architecture/production-reach-allowlist.json` is unmodified (final `git status --short` = 42 files, 21 new + 21 modified).

## CHECKS

- `npm run typecheck` — baseline exit 0; part 1 exit 0; **part 2 exit 0**.
- `npm run check:architecture` — baseline exit 0; part 1 exit 0; **part 2 exit 0** (`next source boundaries: OK`).
- `npm run build` — **exit 0** (`workbench build: published …/dist/app/public/workbench`).
- `git grep -n "not implemented: " -- src` — **prints nothing**.
- `npx vitest run <the 11 files>` — part‑1 correction: `Test Files 10 failed | 1 passed (11)`, `Tests 141 failed | 27 passed (168)`; **part 2: `Test Files 1 failed | 10 passed (11)`, `Tests 2 failed | 166 passed (168)`**; per file (runs/failed/passed): `context-input` 15/0/15; `S3-context-inputs` 38/0/38; `S3-graph-context` 38/0/38; `S3-prepared-context-admission` 16/0/16; `S3-role-profiles` 12/0/12; `S3-context-assembler` 15/0/15; `S3-graph-tools` 14/2/12; `S3-attention-context` 12/0/12; `S3-graph-routes` 6/0/6; `S3-context-and-inputs` 1/0/1; `S3-query-graph` 1/0/1. Still failing (rule 15): `GT10` `AssertionError: expected undefined to be 'success' // Object.is equality`; `GT12` `AssertionError: expected 'error' to be 'success' // Object.is equality`.
- Regression command (50 files) — part‑1 baseline `Test Files 19 failed | 31 passed (50)`, `Tests 63 failed | 1028 passed | 29 skipped (1120)`; **part 2 identical** `Test Files 19 failed | 31 passed (50)`, `Tests 63 failed | 1028 passed | 29 skipped (1120)`; per‑file diff against the baseline is empty, and `tests/architecture/production-reach.test.ts` passes (4 tests, ≈30 s). The 63 baseline failures are the known `/usr/bin/bwrap`-missing failures (`tests/state/invariants.test.ts` skipped, `tests/state/invariants-fuzz.test.ts`, and the AG2b/scenario tests listed in DSH-BASELINE.md).
- `sha256sum` of the 11 frozen tests — all equal the list. `sha256sum src/contracts/platform-duty.ts` — `6adfb57e…a9e39`. `git diff -- tests/architecture/production-reach-allowlist.json` — empty.

## UNSPECIFIED

Frozen tests that contradict the spec (rule 15; both left failing, tests and spec untouched):
- **GT10** `tests/runtime/S3-graph-tools.test.ts:505,507`: reads `run.requests[1]` for both `gt10-find` and `gt10-look`, but the scripted Query replies put find and look in separate replies (`:494-497`) and the Kernel sends one provider request per reply, so `gt10-look` first exists in `run.requests[2]`. Spec §5.8 GT10 (`slice-3-SPEC.md:764`) says the request after find→look carries both real tool results, i.e. the request after both calls. Counter-example: with the fixture as written, no implementation can place the look result in `requests[1]`.
- **GT12** `tests/runtime/S3-graph-tools.test.ts:552-554`: asserts `look_graph {mode:'node', target: GT_TASK_NODE}` succeeds, but `GT_TASK_NODE` is a task under `ag2b-goal` (`:856-858`) while the Query's canonical QueryJob Goal is `gt-query-goal` (`:855`, `:992`). Spec §4.4 (`slice-3-SPEC.md:551`) requires validating the model-supplied node against the trusted ctx/goal and §4.6 (`:615`) binds the tools to the canonical QueryJob Goal; the correct result is `forbidden`. Counter-example: bind a Query to Goal A and look at a task of Goal B.

Spec/implementation gaps met:
- CA11 vs CA14: §4.3 (`slice-3-SPEC.md:508`) wants the `注记索引尚未接入`/`异常锚点投影尚未接入` wording whenever the extension availability is `not_implemented`, but CA11 asserts the whole input contains no `未接入` while its fixture has not-implemented extensions. Resolved by emitting those two reminder rows only when `deps.graphContext` is undefined (both frozen tests pass; weaker than the spec line).
- `attentionSignalToJson` (`src/app/attention-observer.ts`) is now referenced only in the Host `requestId` hash (`src/app/host.ts:1107`) so that production-reach can reach it without an allowlist addition; the notification text is `renderAttentionChanges`.
- C4: `decisionApplications` returning `null` or `[]` both map to `missing/decision_not_applied`; the frozen IN14 fixture uses `[]`.
- C1 says “43 files (21 new + 22 modified)”, but with no reached `kept-for` entry the allowlist is unchanged, so the final set is 42 files (21 new + 21 modified).

Not-found claims: `git grep -n "not implemented: " -- src` found nothing.

## NOTES

- Work Run chain: `WorkflowPort.advanceWork` (`src/business/workflow/workflow.ts:1236`) → `RuntimeExecutionPort.prepareExecution` (`src/core/agent-runtime/execution-preparation.ts:createExecutionPreparation.prepare`) → Role facts + Host config → `ContextAssembler.assembleTask` (`src/core/agent-runtime/context-assembler.ts`) → `bodies.put`; then `workflow.ts:1245` → `execution-driver.ts:createExecutionDriver.start` → `execution-entry-service.ts:authorizeRuntimeEntry` (G‑CTX/G‑INPUT) → `observed-model-run.ts:runObservedModel` → first provider request.
- Query chain: `queries.claimQuery` → `RuntimeExecutionPort.prepareQuery` (`query-preparation.ts:createQueryPreparation.prepare`) → `assembleQuery` → `query-execution.ts (work-graph):bindPreparedQuery`; then `runtime.startQuery` (`src/core/agent-runtime/query-execution.ts:start`) → `beginQueryEntry` → `observed-model-run.ts:runObservedModel` → first provider request.
- Blocked/undone: only GT10 and GT12 remain, both reported above under rule 15; the implementation deliberately keeps the spec-faithful goal pin rather than deriving the trusted goal from model input.
- `.dsh-scratch/` and every helper/log file were deleted; the tree shows exactly the 42 write-scope files (allowlist unmodified), and no commit/install/server/model call was made.