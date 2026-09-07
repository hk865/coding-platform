# Agent Platform Domain Context

```yaml
status: draft
updated: 2026-09-04
scope: Agent 和开发者进入本目录时使用的最小领域词汇与不变量地图
authoritative_details:
  - ./dev_docs/product/产品定义.md
  - ./dev_docs/design/总体架构.md
  - ./dev_docs/design/任务图与完成判定.md
```

## Core model

```text
Project
  ├─ Workspace → WorkspaceSnapshot
  └─ Goal → PlanRevision → Task → TaskAttempt → AgentRun → ContextWindow

ArchitectureBaseline(effective revision) + CodeGraphSnapshot
  → ArchitectureDelta(raw) ─┐
Runtime / semantic Evidence ─┴→ ArchitectureFinding
  → RemediationTask | ArchitectureChangeProposal
  + ExecutionDAG + EvidenceGraph
  → Task State
  → PlanMatrix / TodoView / ModuleView / StageView / GoalView
```

## Terms that must not be collapsed

- Goal is the user outcome; PlanRevision is one versioned proposal for achieving it.
- Task is a schedulable obligation; TaskAttempt is one execution try.
- AgentInstance is a logical executor identity; AgentRun is one runtime execution.
- ContextWindow is bounded model input; it is not durable project state.
- ArchitectureBaseline describes intended module structure; each revision is immutable. A Project's active ref advances only through a CAS-guarded BaselineActivation that consumes a matching accepted Decision and migration Gate; running Plans keep their pinned effective revision until an explicit PlanRebase/new PlanRevision.
- CodeGraphSnapshot observes actual code structure. A mismatch with the baseline must be classified; it does not by itself prove whether the code or the baseline is wrong.
- Module is the spatial responsibility boundary; Stage is planned delivery maturity; TaskHierarchy stores parent_of; ExecutionDAG stores only true prerequisites; Task.phase is current runtime state. None can replace another.
- AcceptanceObligation states what must be true; a Gate is an explicit Module, Stage, or Goal verification barrier.
- CompletionClaim is a Worker assertion; Evidence is an immutable observation or verdict with a revision-bound EvidenceBinding. STALE is derived applicability, not a mutation of Evidence.
- Reviewer produces semantic Evidence; Controller alone advances canonical Task State.
- TodoView and PlanMatrix are read models; neither accepts direct state writes.
- Artifact stores large content; HandoffPacket is a bounded, sourced continuation view.

## Completion dimensions

```text
requirementLevel = required | optional
disposition      = active | deferred | cancelled | superseded
phase            = pending | ready | running | verifying |
                   blocked | satisfied | failed
```

These dimensions are independent. In particular, optional is not a phase, and deferred or cancelled does not mean completed.

## Concrete completion scenario

For two modules that depend on one shared contract:

```text
ContractTask
  ├─→ Module A Task ─┐
  └─→ Module B Task ─┼─→ IntegrationTask / GoalGate
                     ┘
```

A and B can run in parallel after the contract GateTask is satisfied. Each Worker submits a CompletionClaim. Static structure checks and applicable tests run first; a Reviewer receives a compact ReviewPacket only if semantic risk remains. The Controller marks a Task satisfied only when the current VerificationPlan's EffectiveEvidenceSet meets the inherited CompletionPolicy.

Goal completion is derived from the current PlanRevision's required executable work Tasks, required AcceptanceObligations and required GateTasks. Historical failures remain facts; changing scope requires a new Decision and PlanRevision.

Architecture is governed by comparing each Plan/Workspace's effective ArchitectureBaseline revision with incremental CodeGraphSnapshot updates. ArchitectureDelta is the raw mechanical structural difference; ArchitectureFinding carries policy/reviewer interpretation and may also originate directly from runtime or semantic Evidence. Only allowlisted deterministic drift can enter the normal Controller/Scheduler/Writer remediation path. A material or ambiguous Finding becomes an ArchitectureChangeProposal and, if accepted and migrated, a new baseline activation. Activation only changes the default for new Plans; explicit PlanRebase/new PlanRevision is required to migrate existing Plans and recalculate EvidenceBinding applicability. Old Evidence is never rewritten from FAIL to PASS.
