| Kind | Phase | Proposed action | New | Known |
|---|---|---|---:|---:|
| Duplication | next phase | merge | 11 | 2 |
| Dead code | wrap-up | delete | 3 | 5 |
| Dead code | wrap-up | keep | 0 | 3 |
| Placement | wrap-up | keep | 0 | 2 |
| Placement | next phase | move | 4 | 0 |
| Oversized | next phase | split | 17 | 0 |
| Oversized | next phase | keep | 2 | 0 |
| Docs versus code | wrap-up | fix-doc | 7 | 2 |
| **Total** | | | **44** | **14** |

Counts are **finding IDs**, including explicit keep decisions, rather than individual declarations or comparison sites. Zero combinations are omitted. Findings about the same code under different audit criteria are counted separately.

The split is meaningful as a dependency structure: static inspection supports the declared submodule DAG and finds no value-reference cycle. It has not resolved all duplicated decisions or made the largest services smaller. The immediate deletion list consists of five known leftovers and three new findings; broader consolidation belongs in the next phase.

Audited HEAD: `a57edc1e`. No files were changed; the working tree remained clean. Node, TypeScript and Vitest were not run. Reference searches used `git grep` because `rg` was unavailable. Accordingly, this is not a certification that the TypeScript production-reach analysis would report zero additional findings.

Below, `WG/` means `src/core/work-graph/`; `RT/` means `src/core/agent-runtime/`. Locations use the audited commit.

**Duplication**

**DUP-1 — Known: 15 named canonical-JSON equality implementations outside state**

The count in [STATUS](D:/cxt/wrapup-review/docs/refactor/STATUS.md:126) is correct for **named, `sameJson`-equivalent equality implementations**. “Private” is slightly inaccurate: two are exported.

| Location | Declaration | Semantics relative to `contracts/fingerprint.ts:51` |
|---|---|---|
| `src/app/collaboration-driver.ts:157` | `sameCanonical` | Equivalent; its nullable encoder result is explicitly checked |
| `src/business/workflow/consultation.ts:38` | `sameCanonical` | Equivalent |
| `src/business/workflow/workflow.ts:77` | `sameCanonical` | Equivalent |
| `src/composition/create-platform.ts:149` | `sameJson` | Equivalent |
| `RT/execution-control.ts:137` | `sameRef` | Equivalent |
| `RT/execution-driver.ts:176` | `sameRef` | Equivalent |
| `RT/execution-observation.ts:146` | `sameRef` | Equivalent |
| `RT/query-execution.ts:55` | `sameRef` | Equivalent |
| `RT/run-reconcile.ts:73` | `sameRef` | Equivalent |
| `WG/persistence/rework-codecs.ts:41` | exported `sameJson` | Equivalent |
| `WG/queries/query-execution.ts:91` | `sameRef` | Equivalent |
| `WG/tasks/claim-service.ts:123` | `sameRef` | Equivalent; uses canonical ref-key encoding |
| `WG/tasks/execution-entry-service.ts:131` | exported `sameRef` | Equivalent |
| `WG/tasks/execution-history-service.ts:96` | `sameRef` | Equivalent |
| `WG/tasks/reconcile-intents.ts:86` | `sameRef` | Equivalent |

Minimal evidence for the repeated rule:

```ts
try {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
} catch {
  return false;
}
```

For all 15, object key ordering, `undefined`, `null`, dense-array ordering, finite numbers, non-finite numbers and `-0` behave like [the shared `sameJson`](D:/cxt/wrapup-review/src/contracts/fingerprint.ts:51). None requires a behavior change to replace.

**Action:** merge into the contracts helper. **Phase:** next phase. **Confidence:** high for equivalence by inspection; import/export compatibility needs TypeScript verification.

**DUP-2 — New: state comparisons and additional comparison families require explicit failure semantics**

The following comparisons inside `state/` repeat canonical equality:

| Location | Comparison | Difference from `sameJson` |
|---|---|---|
| `WG/state/plan-machine.ts:720` | `sameRef` | Encoding failure throws |
| `WG/state/task-machine.ts:940` | `sameRoundRef` | Encoding failure throws |
| `WG/state/task-machine.ts:758` | `sameProjection`’s cause comparison | Encoding failure throws |
| `WG/state/goal-machine.ts:973` | Requeue-covering ref comparison | Encoding failure throws |

**Action:** merge canonical equality ownership into contracts while retaining the existing throwing behavior at these callers. Direct substitution with today’s catch-and-false `sameJson` is insufficient. **Phase:** next phase. **Confidence:** high that the equality rule repeats; medium for the consolidation seam because malformed-input behavior must be preserved and checked.

The broader comparison inventory also contains forms that must retain their distinct semantics:

| Location | Existing behavior that a blind replacement would change |
|---|---|
| `RT/execution-preparation.ts:55` | Uses `JSON.stringify`. Key insertion order matters; two top-level `undefined` values compare equal; nested `undefined` is omitted; non-finite numbers and undefined array elements become `null`; `toJSON` is honored |
| `WG/tasks/plan-validation.ts:299` | Top-level `undefined` compares by identity, then a JSON round-trip precedes canonical encoding. It therefore removes nested undefined properties and converts non-finite numbers/undefined array elements |
| `WG/state/session-availability.ts:737` | Recursive structural equality accepts undefined values and non-finite numbers; arrays use length and recursive element checks |
| `WG/state/verification-machine.ts:1668,1673` | Typed round identity and subject identity are separate relations; subject identity deliberately excludes `roundId` |
| `WG/communication/mailbox-service.ts:109,233` | `canonicalOf` returns a null sentinel on failure; comparisons can treat two encoding failures as equal |
| `WG/sessions/message-body-envelope.ts:23,44,52,71` | Same null-sentinel behavior |
| `WG/sessions/message-record-codecs.ts:136,421` | Same null-sentinel behavior |
| `WG/sessions/session-directory.ts:102,631,863` | Same null-sentinel behavior in identity checks |
| `WG/sessions/session-lifecycle.ts:86,404,407,625` | Same null-sentinel behavior |
| `WG/sessions/session-record-codecs.ts:133,572` | Same null-sentinel behavior |
| `WG/persistence/evidence-record-codecs.ts:147,488` | Same null-sentinel behavior |
| `src/app/collaboration-driver.ts:348` | Direct comparison of two nullable canonical keys, unlike its guarded named helper |

Direct canonical comparisons also occur in `RT/source-capture-access.ts:409,434`, `src/app/host.ts:969`, `src/app/workbench-tools.ts:292`, and architecture codecs/services. These retain throwing behavior rather than the catch-and-false policy.

For arrays, the distinctions above apply particularly to undefined elements and sparse arrays. The actual canonical encoder uses `map`/`join`; it does not separately validate sparse-array shape. These variants are inventory observations, not additional counted duplicates or proposed behavior changes.

**DUP-3 — Known: graph-facing projections and context assembly have multiple paths**

This is a consolidation seam; it does **not** mean every reader below duplicates the same policy.

| Entry/path | What reaches the agent | Facts read and present selection |
|---|---|---|
| `RT/whiteboard-tools.ts:262` → `WG/tasks/plan-service.ts:1521` `queryTaskGraph` | Full `ReadResult<TaskGraph…>` | Accepted or explicitly selected historical Plan, task definitions, canonical Run/Lease/Reduction/round/requeue facts. All Plan tasks remain, including future intent; Plan ordering is retained |
| `RT/whiteboard-tools.ts:276` → `WG/tasks/plan-service.ts:1613` `queryReadyTasks` | Full paged read result with candidate diagnostics | Same task rows and eligibility facts; work-task, role and blocked filtering; candidate status does not authorize execution |
| `RT/whiteboard-tools.ts:291,299` | Full proposal/adoption `WriteResult` | Plan service’s proposal/adoption facts and state-machine decisions. These write results also expose graph records |
| `RT/execution-preparation.ts:104,287` | Work input string plus persisted manifest | Execution record, accepted assignment, Role resolution, workspace/configuration pins and permissions. Includes Role responsibility/material/output/exit sections; ordinary input lacks Goal objective and graph obligations. `selectedTaskInputs` is empty at `:429` |
| `RT/query-preparation.ts:220,258` → `RT/query-execution.ts:286` | Query input and pinned manifest | Query/Session/Goal/Workspace facts; includes Goal objective, question, Role label/purpose and tools. `focusPlan` is recorded as a pin/source ref at `:343,381`, without task rows |
| `RT/execution-preparation.ts:158` → `WG/tasks/run-state-service.ts:691` → `RT/continuation-brief-assembly.ts:299` → `src/contracts/continuation-brief.ts:264` | Bounded continuation brief, rendered in Chinese | Previous Run/fact chain, round/requeue facts, original message bodies, Kernel history, accepted inputs/control intents and workspace checkpoints. Preserves limits and uncertainty |
| `RT/session-discovery-tools.ts:157,182` → `WG/sessions/session-directory.ts:1187,1422` | Full SessionCard/directory read result | Session record, links and state-derived availability. Discovery binds the workspace, sets `includeArchived:false`, and uses currently open links; direct card reading can expose authorized historical/archived records |
| `RT/communication-tools.ts:258` → `WG/communication/mailbox-service.ts:1513,1538,1596` | Message/body/inbox values on successful reads | Original SessionMessage metadata/body; exact Session identity, scope, status filter and stable pagination. Successful output omits the `ReadResult` envelope |
| `RT/execution-inputs.ts:63` | Original message/reply text delivered at `before_model` | Saved consumed-wait response, Session outbox responses, inbox messages, then control inputs. Excludes already accepted sources and inquiry messages from ordinary message delivery; preserves stable source identity |
| `src/business/workflow/consultation.ts:322,406` | Query question, or instruction referencing original delivered input | Original message body, recipient/session provenance and consultation derivation. Uses the same Query preparation/execution path |
| `src/app/attention-observer.ts:466,497,523` → `:423` `attentionSignalToJson` | Mechanical change notification | Task graph rows, architecture catalog nodes and mailbox feedback. Sorts graph stamps and emits changes rather than a full context |

Supporting readers are also relevant:

- `WG/tasks/plan-readers.ts:1164` `readCanonicalTaskFacts` is already the shared owner of directed/whole-graph task facts.
- `WG/tasks/entry-plan-reader.ts:32` reads admission facts; it does not build a separate agent-facing graph.
- `WG/tasks/plan-service.ts:1715` builds Goal display joins. Its Run selection at `:1794` differs from the full task graph’s purpose.
- Workflow selection at `src/business/workflow/workflow.ts:1009,1208` and startup reconciliation consume graph reads internally; they do not independently serialize an agent context.
- `project_source` exposes workspace/source structure, not another formal WorkGraph projection. Source-authority reads used for authorization likewise do not themselves serialize graph context.

Actual repeated decisions include Role/pin context rendering in Work and Query builders and adapter-level status handling. Current outputs also differ in envelope visibility, archived-member discovery, ordering and status presentation.

Already shared decisions should remain shared: `readCanonicalTaskFacts`, `evaluateEligibility`, `projectTaskPhase`, `buildTaskFailureFacts` and Session availability derivation.

**Action:** merge joined graph projection ownership into the planned `views` layer and bounded agent-context assembly into one Runtime assembler, retaining audience-specific adapters. Query presently forbids all whiteboard/mailbox tool names at `RT/query-preparation.ts:139`; its execution driver constructs none of those tools. Preserve that current restriction during structural consolidation; exposing Query graph tools is planned slice-3 feature work. **Phase:** next phase. **Confidence:** medium; routes and calls were traced statically, without executing model/tool flows.

**DUP-4 — New: Query repeats the shared Kernel record/turn reader**

Locations:

- `RT/kernel-turn-facts.ts:27,38,52,61`
- `RT/query-observation.ts:77,88,98`
- `RT/execution-observation.ts:88,108,158`
- `RT/query-observation.ts:74,109,119`

Query repeats original-record decoding, position/record/Session identity checking, fixed-turn selection and event reduction. Work, reconciliation and continuation already consume `kernel-turn-facts`.

The observers also independently decide that settled tool calls are `completed|failed|cancelled`, and repeat:

```ts
entry.kind === 'tool_result'
  && entry.result.status === 'error'
  && entry.result.error.code === 'outcome_unknown'
```

**Action:** merge Kernel decoding/reduction and shared tool-completion facts into `kernel-turn-facts`. Retain Work/Query outcome mapping: Work supports yielded continuation, while Query’s answer/timeout classification differs. **Phase:** next phase. **Confidence:** high for repeated rules; Kernel binding type compatibility needs TypeScript verification.

**DUP-5 — New: persistent deadline calculation has two owners**

Locations: `RT/run-limits.ts:31`; `RT/model-budget.ts:29`.

Both parse trusted `now()`, reject non-finite timestamps and return:

```ts
Math.max(0, deadlineMs - currentMs)
```

Their missing-clock and error-message handling differs.

**Action:** merge the pure calculation, preserving caller-specific errors and every fresh deadline checkpoint. **Phase:** next phase. **Confidence:** high; no runtime timing verification.

**DUP-6 — New: platform-tool result classification is repeated**

Locations: `RT/whiteboard-tools.ts:116,125`; `RT/session-discovery-tools.ts:70`; `RT/communication-tools.ts:108,114`.

Each independently maps ready/committed, not-found, not-ready, cancellation and rejection into Kernel `ToolResult`.

**Action:** merge classification at the Runtime adapter layer, with explicit success projection and message parameters. Preserve mailbox’s successful `value` output and whiteboard/discovery’s full result output. **Phase:** next phase. **Confidence:** high; tool-schema/type compatibility unverified.

**DUP-7 — New: capture comparison eligibility is checked twice**

Locations: `src/core/workspace/capture.ts:278`; `src/core/workspace/workspace-read.ts:144`.

Both decide that captures must share provider, index version and canonical content scope, with the same rejection text:

```ts
'captures use different providers'
'captures use different index versions'
'captures declare different content scopes'
```

**Action:** merge the pure pair-compatibility predicate; retain fresh authorization, reader lifetime and capacity checks at their current boundaries. **Phase:** next phase. **Confidence:** high.

**DUP-8 — New: acceptance-obligation semantics are independently projected**

Locations: `WG/tasks/plan-task-basis.ts:77`; `WG/tasks/plan-validation.ts:289`.

Both define semantic obligation identity by removing carriers:

```ts
const { taskIds: _carriers, ...semantics } = obligation;
return semantics;
```

**Action:** merge into the existing plan-basis helper and use it from future-plan validation. **Phase:** next phase. **Confidence:** high; validation already consumes plan-basis helpers.

**DUP-9 — New: candidate eligibility repeats state-machine claim classifications**

Locations:

- `WG/tasks/eligibility.ts:34,44,48,69,78`
- `WG/state/task-machine.ts:826,855`
- `WG/state/run-machine.ts:519`
- `WG/tasks/claim-service.ts:859`

Goal activity, work-task kind, active disposition, dispatchable phases `pending|ready`, and held lease are independently classified in eligibility and claim guards. Sharing `evaluateEligibility` between query and claim does not remove its overlap with the state machine.

**Action:** merge the underlying classifications into state-owned predicates. Preserve all-diagnostics candidate output versus ordered first-refusal admission, including codes and messages. **Phase:** next phase. **Confidence:** high for duplicated classifications; medium for the refactoring seam.

**DUP-10 — New: trusted context snapshot policy is copied nine times**

Locations:

- `RT/execution-driver.ts:216`
- `RT/execution-observation.ts:91`
- `RT/execution-preparation.ts:61`
- `RT/query-execution.ts:61`
- `RT/query-observation.ts:57`
- `RT/query-preparation.ts:155`
- `RT/graph-execution-history.ts:98`
- `RT/observation-recovery.ts:112`
- `WG/queries/query-execution.ts:120`

All retain project/signal, clone principal/material reader, conditionally retain a string workspace ID, and return null on cloning failure.

**Action:** merge this ownership/snapshot rule into a shared call-context helper. Keep each caller’s authorization checks and cancellation checkpoints. **Phase:** next phase. **Confidence:** high for the copies; common-helper typing unverified.

**DUP-11 — New: failed domain-read mapping is repeatedly decided**

Locations:

- `RT/execution-driver.ts:203`, `RT/execution-observation.ts:102`
- `RT/query-execution.ts:72`, `RT/query-observation.ts:68`, `RT/query-preparation.ts:166`
- `RT/execution-preparation.ts:72`
- `WG/queries/query-execution.ts:108,114`
- `WG/tasks/claim-service.ts:158`
- `WG/tasks/execution-entry-service.ts:168`
- `WG/evidence/evidence-service.ts:183`

Repeated policy: missing → `not_found`, insufficient watermark → `incomplete`, existing rejection → retained rejection. Runtime helpers additionally reject unexpected success.

**Action:** merge equivalent mapping families with caller text and rejection projection preserved. In particular, retain the distinction between reconstructing a rejection and returning the original object. **Phase:** next phase. **Confidence:** high for equivalent families; do not generalize this mapping to ordinary read APIs.

**DUP-12 — New: equivalent Store failure maps and current-pin decoding are repeated**

Locations:

- `WG/sessions/session-directory.ts:136`
- `WG/sessions/session-lifecycle.ts:99`
- `WG/communication/mailbox-service.ts:131`
- `WG/tasks/execution-entry-service.ts:154`
- `WG/tasks/execution-history-service.ts:118`
- Current-pin readers: `WG/tasks/claim-service.ts:126`, `execution-entry-service.ts:143`, `execution-history-service.ts:107`, `WG/queries/query-execution.ts:136`, `query-job-service.ts:584`

Directory/lifecycle/mailbox share one failure policy; entry/history share another. Pin readers repeatedly discard null revisions/unparseable or non-object keys and decode remaining JSON keys into `VersionPin`.

**Action:** merge equivalent families into persistence helpers. Preserve distinct policies elsewhere: unique conflicts become `busy`, `revision_conflict` or `unavailable` depending on operation; unsupported/corruption handling also differs. **Phase:** next phase. **Confidence:** high for the cited equivalent families; consolidated signatures need TypeScript checking.

**DUP-13 — New: exact Host actor-match authorization predicate has three copies**

Locations: `WG/tasks/claim-service.ts:116`; `execution-entry-service.ts:217`; `execution-history-service.ts:144`.

Each checks object shape, equal `kind/id`, and `kind === 'human' || kind === 'system'`.

**Action:** merge this exact predicate into a shared contract-level identity helper. Broader actor comparisons, including agent causation or automation actor recognition, retain their separate semantics. **Phase:** next phase. **Confidence:** high.

**Dead code**

The following are deletion dispositions, not claims that their enclosing services are dead.

| ID | Location | Evidence | Proposed action / phase / confidence |
|---|---|---|---|
| **DEAD-1 — known** | `WG/model/execution-entry-contracts.ts:150`; `src/composition/create-platform.ts:534` | `materials: MaterialPort` is supplied, but searches for `deps.materials` in execution-entry consumers find no read | **delete**, wrap-up, **high**. Remove the dependency/property and unused import; retain the live material service |
| **DEAD-2 — known** | `RT/execution-preparation.ts:32` | The dependency `Pick` includes `claims`, `sessions`, `materials`; `git grep -n -E 'deps\.(claims\|sessions\|materials)' -- src/core/agent-runtime/execution-preparation.ts` returns no matches | **delete**, wrap-up, **high**. Remove these requirements from this preparation type; other Runtime components still use the broader dependencies |
| **DEAD-3 — known** | `src/core/workspace/candidate-workspace-reader.ts:24,42,52,67` | The only call is `candidateWorkspaceSnapshot(root, true)` | **delete**, wrap-up, **high**. Remove the parameter and false alternatives; retain unconditional Git-entry generation |
| **DEAD-4 — known** | `src/ui/main.ts:27` | `git grep -n '\brenderProjectRead\b' -- src` finds this unused import, the re-export, definition, and live call at `src/ui/views/conversation/project-render.ts:38` | **delete**, wrap-up, **high**. Delete only the unused import |
| **DEAD-5 — known** | `WG/evidence/evidence-service.ts:278,286,314` | All five `commitRoundWrite` callers are at `:1047,1206,1265,1350,1506`. They cannot emit `guard_round_unchanged`; its producer is the task-requeue transition | **delete**, wrap-up, **medium**. Remove this branch and local `roundGuard` plumbing after narrowing the helper’s effect contract. Keep the live consumer in `WG/tasks/requeue-service.ts:686`. Compiler integration remains unverified |
| **DEAD-6 — new** | `src/core/workspace/material-source-provider.ts:160`; `source-applicability.ts:16,64`; `src/contracts/material-access.ts:51,60`; allowlist `:383,731,821` | Search for `createMaterialSourceProvider`, `WorkspaceSourceApplicability`, `materialSourcePinIsCurrent`, `MaterialSourceCaptureResult`, `SourceApplicabilityPort` in `src scripts` finds only the provider pair and its two contract types. Tests are the external consumers. DESIGN `:524,1191` explicitly chooses historical/version-recorded reads and deletion of the pair | **delete**, wrap-up, **high**. Delete the two files, two exclusive contract types, provider-only test cases and their **22 allowlist entries**. Retain `MaterialSourcePinV1`/validation: execution-entry still reads it at `:461`. Retain R3b’s live material-applicability tests. The design schedules deletion in slice 3; this audit’s unplanned-code rule makes it eligible for wrap-up |
| **DEAD-7 — new** | `RT/execution-preparation.ts:391,393,396,399` | `contractSatisfied` uses `every(kind === 'contract')`; `unsourceable` uses the complementary filter. Nonempty `unsourceable` returns before `if (!contractSatisfied)` | **delete**, wrap-up, **high** for valid snapshot data. Remove the Boolean and unreachable incomplete rejection; retain the unsupported-material rejection |
| **DEAD-8 — new** | `src/contracts/runtime-budget.ts:29` | `_legacyContextOnlyTask` occurs only in its declaration. `git grep` finds three production calls, all with one argument: `src/app/runtime-configuration.ts:257,277`, `src/contracts/query-job.ts:269`; no test/script consumer supplies the legacy parameter | **delete**, wrap-up, **high**. Remove the unused parameter/default |

The allowlist’s remaining groups have reasons that still hold:

| ID | Locations and evidence | Proposed action / phase / confidence |
|---|---|---|
| **DEAD-9 — known** | **37 Role-related nodes**, including `WG/model/configuration-contracts.ts` operation members, `configuration/role-memory-service.ts`, Role contracts and `src/core/workspace/role-source-reader.ts`. No route/Workflow/script consumes the management operations; DESIGN `:908,1191` explicitly retains them for slice 3 | **keep**, wrap-up, **medium**. Planned consumer verified; full symbol reach requires TypeScript |
| **DEAD-10 — known** | **11 catalog-revision + 10 comparison/impact nodes**. `reviseArchitectureCatalog`, `compareArchitecture`, `queryImpact` are published by composition but have only test consumers. Allowlist `:521,606,612`; DESIGN slice 8 retains revision/comparison/impact work | **keep**, wrap-up, **medium** |
| **DEAD-11 — known** | **62 pre-batch nodes**: 60 HTTP request/response aliases in `src/app/core-http-types.ts`, two CLI configuration types in `src/app/main.ts:18,30`. They still exist; the reasons explicitly defer their disposition to the user/UI work and preserve the README configuration format | **keep**, wrap-up, **medium**. An explicit deferral is not an expired planning reason |

All **142** allowlist files/names still exist by textual checks. The source-pin group’s retention reason has expired; I found no additional expired reason or newly established production consumer in the other groups.

Declaration/reference screening did not establish another unallowlisted test-only export. That result is limited: text search cannot reproduce alias resolution, assignability, returned service-member reach or all reflective access modeled by `production-reach.ts`.

**Placement**

These recommendations distinguish current rule compliance from semantic ownership. The four moves are next-phase design work, not reversals of the accepted pure move.

| ID | Location and evidence | Proposed action / phase / confidence |
|---|---|---|
| **PLACE-1 — known** | `docs/refactor/module-target.json:20`; `module-dag.md:122`; `WG/model/plan-contracts.ts:19`. Static imports use **40 of 41** permitted cross-submodule edges; the unused reserved edge is `tasks → architecture`. Ordinary imports/re-export inspection finds no value cycle. Type-only cycles are the three execution/communication model-contract files and `state/control-intent-machine.ts ↔ state/run-machine.ts` | **keep**, wrap-up, **high** for the inspected static graph. TypeScript resolution/checker execution unverified |
| **PLACE-2 — known** | `module-target.json:6`; `scripts/check-boundaries.mjs:145,199,234`; `module-dag.md:143` | **keep**, wrap-up, **high**. `pureDirectories` currently enforces the intended state purity. The accepted migration to submodule `pure:true` remains unfinished; the checker does not yet implement that field |
| **PLACE-3 — new** | `WG/tasks/plan-service.ts:596,788,1521,1613,1715`; `src/app/attention-observer.ts:497`. Joined read-model construction resides in task services/Host projection. DESIGN `:1131,1151` assigns joined read models to `views` | **move**, next phase, **medium**. Move read joins/presentation projection to `views`; keep canonical task facts and business state reducers below it. See DUP-3 and SIZE-19 |
| **PLACE-4 — new** | `WG/sessions/message-record-codecs.ts:21,31`; `message-body-envelope.ts:12,39`. These files own communication record/body formats, not Session lifecycle; queries, tasks and communication import them. Their pure shared codec role fits persistence | **move**, next phase, **medium**. Move shared message codecs/body decoding to persistence, including the small shared validators needed to avoid an upward `persistence → sessions` edge |
| **PLACE-5 — new** | `WG/materials/record-readers.ts:190,284,370`; `run-snapshot-decoder.ts:17,36`. General Run/QueryRun schemas depend on persistence codecs and are consumed by Sessions, Tasks, Queries and Communication | **move**, next phase, **medium**. Move the schema owner and shared decoder together to persistence; retain material-authority reading in materials. X1 correctly eliminated duplicate decoding, but its schema ownership is still material-specific in placement |
| **PLACE-6 — new** | `WG/tasks/eligibility.ts:34`; `WG/state/task-machine.ts:826,855`. The file is pure and decides claim-related business classifications, which state also decides | **move**, next phase, **high** for responsibility mismatch; **medium** for seam. Move the shared policy into state, leaving candidate DTO construction/adapters in tasks. Coordinate with DUP-9 |

No forbidden cross-submodule edge was established by this inspection. The semantic moves above would require updating declarations and architecture-test codec exemptions while preserving the DAG.

**Oversized files**

I counted **all 329 files under `src`**, including blank lines, with:

```powershell
@(Get-Content -LiteralPath $file.FullName -Encoding UTF8).Count
```

Exactly **19** exceed 1,000 lines. Each row is a new oversized-file disposition. Counts have **high confidence**; split boundaries have **medium confidence** and require design/type checking. All actions are **next phase**. Estimates include redistributed types/helpers and are approximate, not line-saving targets.

| ID | File:line; count | Evidence and natural seam | Action |
|---|---|---|---|
| **SIZE-1** | `src/app/host.ts:218`; **1,155** | Settings/configuration projection (`:475–680`, ~240); workspace registration/opening (`:681`, ~220); input/mail delivery (`:946`, ~250); startup, wiring and lifetime (~445). Seam: injected registries/services with one Host lifetime owner | **split** |
| **SIZE-2** | `src/business/workflow/workflow.ts:545`; **1,373** | Request/operation builders (~450); work/rework selection (`:894,995`, ~450); perform dispatch (`:1181`, ~250); facade/shared bindings (~220). Seam: explicit proposed operation and receipt, retaining one idempotency policy | **split** |
| **SIZE-3** | `src/composition/create-platform.ts:350`; **1,021** | A single assembly/lifetime factory owns raw versus tracked services and coordinated close. Policy-helper merges can reduce its size without fragmenting assembly | **keep** |
| **SIZE-4** | `RT/session-operations.ts:375`; **1,022** | Bounded history/identity validation (~500); real Session creation (`:516`, ~310); history-cursor/probe owner (`:867`, ~210). Seam: shared verified history window | **split** |
| **SIZE-5** | `WG/communication/mailbox-service.ts:613`; **2,233** | Request/ref/cursor helpers (~515); trusted Work/Query identity and admission (~485); body/replay/commit (`:1104`, ~285); read views (`:1513,1596,1737`, ~350); commands (`:1393,1862`, ~490). Seam: admitted message event plus one commit translator | **split** |
| **SIZE-6** | `WG/configuration/project-bootstrap-service.ts:544`; **1,161** | Shared admission/replay helpers (~460); Project/Workspace writes and reads (~250); CompletionPolicy install/activate/read (`:715,828`, ~350); facade/imports (~100). Seam: common scope/admission and commit recovery | **split** |
| **SIZE-7** | `WG/evidence/evidence-service.ts:727`; **1,905** | Shared commit/read/replay (~600); opening/finalization (~470); check operations (~300); reverify (`:1678`, ~420); imports (~120). Seam: state-machine effects and exact read sets | **split** |
| **SIZE-8** | `WG/queries/query-execution.ts:721`; **1,676** | Exact record/manifest/admission helpers (~600); claim/prepared/entry (`:739,886,994`, ~400); metering/observation (~300); recovery (`:1450`, ~300); facade (~75). Seam: Query entry identity and recovery effects | **split** |
| **SIZE-9** | `WG/sessions/session-directory.ts:586`; **1,606** | Reference/schema/cursor helpers (~480); creation/registration (~500); links/cards/directory queries (`:1075,1187,1422`, ~530); facade/imports (~100). Seam: persisted Session identity and canonical card facts | **split** |
| **SIZE-10** | `WG/state/goal-machine.ts:546`; **1,150** | Goal transitions (~570); fan-out/resume/run-stop projection (`:567,633,725`, ~220); display facts/reduction (`:787,1057`, ~360). Pure common facts remain below the dispatcher | **split** |
| **SIZE-11** | `WG/state/plan-machine.ts:691`; **1,398** | Proposal/types/basic projections (~300); trace/carrier fences (`:434,593`, ~250); admission and transitions (`:818,1381`, ~850). Seam: explicit guard facts/effects | **split** |
| **SIZE-12** | `WG/state/run-machine.ts:1214`; **2,334** | Shared types/classifiers/guards (~800); entry/terminal transitions and record builders (~650); control transitions (`:1639`, ~300); reconciliation (`:1898`, ~580); dispatcher (~30). Shared facts must not import the dispatcher | **split** |
| **SIZE-13** | `WG/state/task-failure.ts:642`; **1,276** | Failure/rework classification (~550); automation verdicts (~250); failure read projection (`:859`, ~300); refusal records (`:1111`, ~175). Seam: one classified failure fact | **split** |
| **SIZE-14** | `WG/state/task-machine.ts:772`; **1,351** | Phase projection (~450); immutable reduction/requeue builders (~300); transition guards/effects (~600). Seam: projected Task facts versus transition application | **split** |
| **SIZE-15** | `WG/state/verification-machine.ts:1350`; **1,681** | Shared types/builders (~350); round chain/reverify (~450); fold/verdict admission (`:738`, ~400); Round/Check transitions (~480). Seam: one round-chain head and typed effects | **split** |
| **SIZE-16** | `WG/tasks/claim-service.ts:748`; **1,002** | One public claim transaction, with ordered reads/admission/CAS for first, continuation and requeue claims. Two excess lines do not justify an artificial split; shared-policy merges address real duplication | **keep** |
| **SIZE-17** | `WG/tasks/execution-entry-service.ts:1120`; **1,821** | Manifest load/validation (~430); live admission/fresh facts (~350); effect/guard persistence translation (~330); authorize/begin/entered operations (~430); result recording (`:1525`, ~280). Seam: admitted entry facts and machine effects | **split** |
| **SIZE-18** | `WG/tasks/plan-readers.ts:1164`; **1,643** | Exact decoding/loading (~500); pinned Plan/policy/read windows (~350); canonical Task/Run/round fold (~600); future/basis/origin adapters (`:1474,1560,1620`, ~200). Keep one canonical fact-window owner | **split** |
| **SIZE-19** | `WG/tasks/plan-service.ts:1521`; **2,702** | Proposal/adoption admission and writers (~900); graph/ready/Goal read joins (~600); future/version compilation (~700); shared scope/evidence authority (~500). Read joins fit planned `views`; write authority remains tasks/state | **split** |

**Docs versus code**

All proposed actions below are **fix-doc**, **wrap-up**. These findings correct descriptions; they do not propose changing production behavior.

| ID | Location | Evidence and correction | Confidence |
|---|---|---|---|
| **DOC-1 — new** | `docs/refactor/IMPLEMENTED-CAPABILITIES.md:152` | WG9 labels the Role surface “connected / internally used” while listing install/read/activate/resolve operations. Those four public operations are allowlisted and have no production route/Workflow/script consumer. Describe them as implemented backend operations awaiting slice 3; distinguish the live internal `resolveRoleBindingFacts` consumer | **high** for call-site evidence; full reach analysis unrun |
| **DOC-2 — new** | `IMPLEMENTED-CAPABILITIES.md:153`; `docs/refactor/modules/core/work-graph.md:161` | WG10’s connected subset lists `compareArchitecture/queryImpact` alongside connected capture/query operations. Comparison/impact are test-only, explicitly kept for slice 8. Mark each operation’s wiring status, as WG14 already does for catalog revision | **high** |
| **DOC-3 — new** | `IMPLEMENTED-CAPABILITIES.md:7,118,169,216`; `docs/refactor/STATUS.md:161`; module source-provider retention notes; allowlist `:386,392,734` | Retention text says source-pin consumers “may need” the provider. [DESIGN `:524`](D:/cxt/wrapup-review/docs/refactor/design/orchestration-2026-10/DESIGN.md:524) settles the decision: historical/version-recorded reads, no verified-current-source consumer, delete the pair. WG18 therefore has no remaining planned MVP consumer for this code. Record the settled disposition and pending deletion, preserving dated history | **high** |
| **DOC-4 — new** | `IMPLEMENTED-CAPABILITIES.md:232` | RT9 says platform tools return complete domain `Read/WriteResult`. `RT/communication-tools.ts:114` returns `result.value` on successful reads; whiteboard/discovery return the whole read result. Document the actual per-family shapes; writes and failures retain their envelopes | **high** |
| **DOC-5 — new** | `docs/refactor/modules/core/workspace.md:5,368` | Unqualified progress text lists `readWorkspace/compareWorkspace` and Git history as future work. `src/core/workspace/workspace-tools.ts:53,54` publishes live operations; capability rows WS3/WS7 document implemented text/Git subsets. Add current subset boundaries while retaining unsupported provider/mixed-version operations | **high** |
| **DOC-6 — new** | `docs/refactor/modules/core/record-store.md:214,237` | Ownership prose says WorkGraph retains grant/current-source applicability and checks formal grants before body reads. Current `WG/materials/applicability.ts:34,82` admits scoped Host historical reads and owner Run reads; grant read/write branches are gone and current Host reads are rejected. Add the current owner/historical policy and mark the grant description historical | **high** |
| **DOC-7 — new** | `docs/refactor/modules/core/work-graph.md:149` | This paragraph describes current communication through AgentInstance/WorkParticipation/AgentPrincipal and coordination grants. Searching those names finds no such production communication chain. `WG/communication/mailbox-service.ts:183,679` uses Host/WorkRun plus SessionMessage identity; the module’s own `:624,628` says the older participation scheme is historical. Mark `:149` accordingly | **high** |
| **DOC-8 — known** | `WG/state/verification-machine.ts:3,1598`; `RT/check-execution.ts:102` | Comments still include VR-06 in active row ranges/recovery wording. `verification-machine.ts:29` already explains that VR-06 has no row. Correct the comments to the existing mechanism | **high** |
| **DOC-9 — known** | `docs/refactor/CORE-DATA-OPERATIONS.md:292,295` | The table has the added Goal-control row but omits unknown-Run resolution, reverify, traced disposition changes and Host automation settings; the requeue row still lacks the current input/basis description. Current examples: `WG/model/claim-contracts.ts:53`, `WG/tasks/run-reconcile-service.ts:513`, `WG/evidence/evidence-service.ts:1678`, `src/app/host-settings-types.ts:42` | **high** for omissions; complete behavioral alignment needs the referenced specifications |

WG9 and WG10 correspond to planned MVP behaviors, so their unwired implementations should remain. WG18’s retained source-pin producer is the capability-index entry whose proposed future consumer has explicitly disappeared. Already marked deleted historical entries, and interfaces explicitly labeled target drafts, are not additional contradictions.

The known testing limitations also remain: text search found no `A8-1d`, `A8-3j` or `A8-3k` named cases; the GAP-46 match is the owner-admission comment in `tests/work-graph/R3e-reverify.test.ts:658`. That confirms the naming/coverage uncertainty recorded in STATUS, not absence of behavioral coverage. Resolving it requires test inspection/execution beyond what this host could verify.