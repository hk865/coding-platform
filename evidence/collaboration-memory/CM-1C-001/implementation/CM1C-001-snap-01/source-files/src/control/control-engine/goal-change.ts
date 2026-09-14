/**
 * P1-11 Control entry: goal-change engine (records + CAS apply).
 *
 * Frozen semantics (IMPLEMENTATION-HANDOFF.md "P1-11 契约与存储语义（冻结）"):
 *   - recordPlanChangeProposal / recordUserDecision register immutable
 *     proposal/decision aggregates (CAS@0) with FULL ledger idempotency;
 *   - applyPlanChange re-runs the frozen guard chain (all zero-write until
 *     pass), then applies the accepted decision atomically: new PlanRevision +
 *     GoalRevision + Goal CAS in ONE commit (plan-change-apply fold), creating
 *     ONLY the goal-change-apply commit (no outbox / TaskAttempt / Run).
 *
 * Replay semantics: the frozen guard chain includes source_stale, which a
 * re-submitted ALREADY-COMMITTED command no longer satisfies; idempotent
 * replay is therefore recognised up front by correlating the command's
 * causationId against the committed event log (a read; zero write) and
 * returning the ORIGINAL receipt (replayed=true).
 *
 * ADR 0003 D1（2026-09-10）: 计划变更允许**任务集增量**——返工任务落在新的
 * PlanRevision 内，而不是计划外的新聚合。任务集因此不再硬绑 sourcePlan.tasks：
 *   1. 增量只允许新增／取代／取消，且只能改「谁承担义务」；
 *   2. 守卫 f 的一致性检查把新任务集与义务承担者扩展为「源 revision + 增量」的
 *      确定性推导结果逐项比对（任一不匹配 -> draft_mismatch）；
 *   3. 守卫 h 的 P1-02 守卫在组装后的**新任务集**上原样复跑，增量不是绕过它的旁路；
 *   4. 原子提交写新 PlanRevision（含新任务集）并保留旧 revision 与旧证据。
 */
import type {
  ApplyPlanChangeCommand,
  ApplyPlanChangeReceipt,
  GoalRevisionRecordedEvent,
  GoalRevisionSnapshot,
  PlanProposalSnapshot,
  RecordPlanChangeProposalCommand,
  RecordPlanChangeProposalReceipt,
  RecordUserDecisionCommand,
  RecordUserDecisionReceipt,
  UserDecisionSnapshot,
  UserDecisionV1,
  PlanPatchV1,
} from "../../contracts/goal-change.js";
import { PLAN_CHANGE_MAX_TASK_DELTAS, decisionTargetFor } from "../../contracts/goal-change.js";
import { checkTaskSetDelta, draftAdmissionRejectionCode, draftConsistencyIssues, deriveObligationSet, deriveTaskAssignments, deriveTaskSet } from "./policies/goal-change-consistency.js";
import type {
  PlanRevisionAcceptedEvent,
  PlanRevisionDraft,
  PlanRevisionRef,
  PlanRevisionSnapshot,
  PlanStage,
  PlanTaskAssignment,
  RuntimeExecutionDAG,
  RuntimeTask,
  TaskHierarchy,
} from "../../contracts/plan.js";
import type {
  GoalRef,
  GoalSnapshot,
  LedgerCommitReceipt,
  SnapshotResult,
} from "../../contracts/ledger.js";
import { seqOfCommitCursor } from "../../contracts/ledger.js";
import { resolveProjectArchitectureBaseline, resolveProjectCompletionPolicy } from "../../data/state-ledger/governance-records.js";
import { applyPlanGuardIssues } from "./plan-acceptance.js";
import { buildGoalChangeApplyCommit, buildPlanChangeProposalRecordCommit, buildUserDecisionRecordCommit } from "./records/goal-change.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import type { ControlEngineDeps } from "./control-engine.js";

type NewPlanDraft = NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>;

type CompletedNewPlanDraft = NewPlanDraft & {
  stages: PlanStage[];
  /** The DRAFT's new task set (source revision + accepted increment). */
  tasks: RuntimeTask[];
  /** RW-07: the DRAFT's assignment set (source revision + accepted increment). */
  assignments: PlanTaskAssignment[];
  taskHierarchy: TaskHierarchy;
  executionDag: RuntimeExecutionDAG;
};

export class GoalChangeEngineImpl {
  private readonly deps: ControlEngineDeps;
  constructor(deps: ControlEngineDeps) { this.deps = deps; }

  // --------------------------------------------------------------------- //
  // recordPlanChangeProposal — one immutable PlanProposal (CAS@0)          //
  // --------------------------------------------------------------------- //

  async recordPlanChangeProposal(command: RecordPlanChangeProposalCommand): Promise<RecordPlanChangeProposalReceipt> {
    if (!this.proposalShapeValid(command)) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const proposal = command.payload.proposal;
    // Referential anchor: the proposal binds a source Goal that lives in a real
    // workspace scope. Minimal entity check (no Project / extra entity reads).
    const goalResult = await this.deps.ledger.load(proposal.sourceGoalRef);
    if (goalResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    if ((await this.deps.ledger.load((goalResult.snapshot as GoalSnapshot).workspaceRef)).status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }

    const batch = buildPlanChangeProposalRecordCommit(command, {
      eventId: this.deps.eventId(),
      occurredAt: this.deps.now(),
    });
    const receipt = await this.deps.ledger.commit(batch);
    return this.mapProposalReceipt(receipt, command, proposal.proposalId, proposal.workspaceId);
  }

  // --------------------------------------------------------------------- //
  // recordUserDecision — one immutable decision (CAS@0)                    //
  // --------------------------------------------------------------------- //

  async recordUserDecision(command: RecordUserDecisionCommand): Promise<RecordUserDecisionReceipt> {
    if (!this.decisionShapeValid(command)) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const decision = command.payload.decision;
    // Referential guards (zero write): the decision's subject goal must exist
    // (-> not_found) and the proposal it decides must be recorded (-> proposal_not_found).
    const goalResult = await this.deps.ledger.load(decision.subject.goalRef);
    if (goalResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    if ((await this.deps.ledger.load(decision.proposalRef)).status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "proposal_not_found" };
    }

    const batch = buildUserDecisionRecordCommit(command, {
      eventId: this.deps.eventId(),
      occurredAt: this.deps.now(),
    });
    const receipt = await this.deps.ledger.commit(batch);
    return this.mapDecisionReceipt(receipt, command, decision.decisionId, decision.workspaceId);
  }

  // --------------------------------------------------------------------- //
  // applyPlanChange — accepted decision -> new PlanRevision (atomic)       //
  // --------------------------------------------------------------------- //

  async applyPlanChange(command: ApplyPlanChangeCommand): Promise<ApplyPlanChangeReceipt> {
    // Guard a: command shape / fingerprint surface.
    if (!this.applyShapeValid(command)) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
    const proposalRef = command.payload.proposalRef;
    const decisionRef = command.payload.decisionRef;

    // Guard b: proposal recorded.
    const proposalResult = await this.deps.ledger.load(proposalRef);
    if (proposalResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "proposal_not_found" };
    }
    const proposal = (proposalResult.snapshot as PlanProposalSnapshot).proposal;

    // Guard c: decision recorded.
    const decisionResult = await this.deps.ledger.load(decisionRef);
    if (decisionResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "decision_not_found" };
    }
    const decision = (decisionResult.snapshot as UserDecisionSnapshot).decision;

    // Guard d: only an ACCEPTED decision may apply.
    if (decision.outcome !== "accept") {
      return { status: "rejected", commandId: command.commandId, code: "decision_not_accepted" };
    }

    // Guard e: exact subject/target match + authority legality.
    const subjectMatches =
      canonicalJson(decision.subject.goalRef) === canonicalJson(proposal.sourceGoalRef) &&
      canonicalJson(decision.subject.sourcePlanRef) === canonicalJson(proposal.sourcePlanRef) &&
      decision.subject.sourcePlanRevision === proposal.sourcePlanRevision;
    const proposalRefMatches = canonicalJson(decision.proposalRef) === canonicalJson(proposalRef);
    const targetMatches =
      canonicalJson(decision.authorizedTarget) === canonicalJson(decisionTargetFor(proposal));
    if (!subjectMatches || !proposalRefMatches || !this.authorityLegal(decision.authority) || !targetMatches) {
      return { status: "rejected", commandId: command.commandId, code: "decision_target_mismatch" };
    }

    // Source plan (the proposal's source revision) is required for the draft
    // consistency check and the fold.
    const sourcePlanResult = await this.deps.ledger.load(proposal.sourcePlanRef);
    if (sourcePlanResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    const sourcePlan = sourcePlanResult.snapshot as PlanRevisionSnapshot;

    // Guard f1 (ADR 0003 D1): the task set delta itself must be well-formed and
    // referentially valid against the SOURCE revision (a task that exists, is
    // active and is not chained). A malformed delta is rejected here with its
    // own code so "the increment is wrong" stays distinguishable from "the
    // draft is not the mechanical consequence of the increment".
    const taskSetDelta = proposal.patch.patchDraft.taskSetDelta ?? null;
    const deltaCheck = checkTaskSetDelta(taskSetDelta, sourcePlan);
    if (!deltaCheck.ok) {
      return { status: "rejected", commandId: command.commandId, code: "task_set_delta_invalid", issues: deltaCheck.issues };
    }

    // Guard f2: draft-consistency (the new plan draft must be the deterministic
    // consequence of the patch — task set AND obligation carriers included).
    const draft: NewPlanDraft = command.payload.newPlanDraft as NewPlanDraft;
    const draftIssues = draftConsistencyIssues(proposal, decision, draft, sourcePlan);
    // 「用增量改写义务正文或验收语义」不是普通草稿笔误，而是越过人的决定边界的请求：
    // 只要一致性检查里出现这类 issue，就用专用码拒绝，便于上层区分处置。码的归因只有
    // 一个实现（draftAdmissionRejectionCode），返工自动受理入口的落账前预检读同一处，
    // 因此两边不可能对同一份 issue 给出不同的码。
    const draftCode = draftAdmissionRejectionCode(draftIssues);
    if (draftCode !== null) {
      return { status: "rejected", commandId: command.commandId, code: draftCode, issues: draftIssues };
    }

    // Guard g: goal exists + source_stale (proposal source must be the CURRENT active plan).
    const goalRef: GoalRef = proposal.sourceGoalRef;
    const goalResult: SnapshotResult = await this.deps.ledger.load(goalRef);
    if (goalResult.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    const loadedGoal = goalResult.snapshot as GoalSnapshot;
    if (canonicalJson(loadedGoal.activePlanRevision) !== canonicalJson(proposal.sourcePlanRef)) {
      // A proposal whose source no longer matches the goal's active plan is either
      // a stale fresh submission OR an idempotent replay of an already-applied
      // command. Distinguish by correlating the command's causationId.
      const replay = await this.replayedApply(command);
      if (replay !== null) return replay;
      return { status: "rejected", commandId: command.commandId, code: "source_stale" };
    }

    // Guard h: governance resolution (no default/fallback) + P1-02 guard re-run.
    const policyResolution = await resolveProjectCompletionPolicy(this.deps.ledger, proposalRef.projectId);
    if (policyResolution.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    }
    const baselineResolution = await resolveProjectArchitectureBaseline(this.deps.ledger, proposalRef.projectId);
    if (baselineResolution.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    }
    // The NEW task set is derived from the source revision + the accepted
    // increment (guard f2 just proved the draft carries exactly this set), and
    // the P1-02 guards below run on THAT set — the increment is not a bypass.
    const completedDraft: CompletedNewPlanDraft = this.inheritFromSource(sourcePlan, draft, taskSetDelta);
    const assembled: PlanRevisionDraft = {
      schemaVersion: 1,
      planId: completedDraft.planId,
      ...(sourcePlan.reviewAdmissionProtocol ? {reviewAdmissionProtocol:sourcePlan.reviewAdmissionProtocol} : {}),
      planRevision: completedDraft.planRevision,
      goalId: goalRef.goalId,
      stages: completedDraft.stages,
      tasks: completedDraft.tasks,
      // RW-07：指派随新 revision 一起提交。草稿自带时用它（守卫 f2 已证明它等于
      // 「源指派 + 增量的 assignment」），否则沿用源 revision 的指派。
      assignments: completedDraft.assignments,
      obligations: completedDraft.obligations,
      taskHierarchy: completedDraft.taskHierarchy,
      executionDag: completedDraft.executionDag,
    };
    // The obligation carriers (and the rest of the obligation body) are folded from
    // the SAME deterministic derivation guard f2 compared the draft against, so the
    // ledger never receives a carrier set that merely happens to equal it.
    assembled.obligations = deriveObligationSet(sourcePlan, taskSetDelta, deriveTaskSet(sourcePlan, taskSetDelta).replacedBy, proposal.patch.patchDraft.obligationDeltas);
    const guardIssues = applyPlanGuardIssues(assembled, policyResolution.snapshot.content);
    if (guardIssues.length > 0) {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "guards_failed",
        issues: guardIssues.map((i) => `${i.code}: ${i.message}`),
      };
    }

    // Guard i: deterministic fold (fold-equality with the shared fixture builder)
    // -> atomic commit (goal-change-apply) -> receipt mapping.
    const eventId = this.deps.eventId();
    const occurredAt = this.deps.now();
    const changedAt = this.deps.now();
    const baseGoal: GoalSnapshot = { ...loadedGoal, revision: command.expectedRevision };
    const batch = buildGoalChangeApplyCommit(command, {
      eventId,
      occurredAt,
      changedAt,
      pins: {
        completionPolicy: policyResolution.pin,
        architectureBaseline: baselineResolution.pin,
      },
      sourcePlan,
      newPlanDraft: completedDraft,
      baseGoal,
    });
    const receipt = await this.deps.ledger.commit(batch);
    return this.mapApplyReceipt(receipt, command, loadedGoal, completedDraft);
  }

  // --------------------------------------------------------------------- //
  // Shape validation helpers                                                //
  // --------------------------------------------------------------------- //

  private proposalShapeValid(command: RecordPlanChangeProposalCommand): boolean {
    const p = command.payload.proposal;
    if (command.schemaVersion !== 1 || command.commandType !== "RecordPlanChangeProposal") return false;
    if (command.expectedRevision !== 0) return false;
    if (!p) return false;
    if (p.schemaVersion !== 1 || !p.proposalId) return false;
    if (command.aggregateId !== p.proposalId) return false;
    if (command.identity.projectId !== p.projectId) return false;
    if (!p.workspaceId) return false;
    if (!p.sourceGoalRef || p.sourceGoalRef.aggregateType !== "Goal") return false;
    if (!p.sourcePlanRef || p.sourcePlanRef.aggregateType !== "PlanRevision") return false;
    if (!p.patch || p.patch.schemaVersion !== 1) return false;
    // 任务集增量的语义合法性（任务是否存在、是否 active、是否链式取代）依赖源 revision，
    // 在 applyPlanChange 的守卫 f 用推导逐项判定；这里只做记录期就能判定的有界形状检查。
    if (!this.taskSetDeltaShapeValid(p.patch.patchDraft.taskSetDelta)) return false;
    if (!p.impact || p.impact.schemaVersion !== 1) return false;
    return true;
  }

  private decisionShapeValid(command: RecordUserDecisionCommand): boolean {
    const d = command.payload.decision;
    if (command.schemaVersion !== 1 || command.commandType !== "RecordUserDecision") return false;
    if (command.expectedRevision !== 0) return false;
    if (!d) return false;
    if (d.schemaVersion !== 1 || !d.decisionId) return false;
    if (command.aggregateId !== d.decisionId) return false;
    if (command.identity.projectId !== d.projectId) return false;
    if (!d.workspaceId) return false;
    if (d.outcome !== "accept" && d.outcome !== "reject" && d.outcome !== "defer") return false;
    if (!d.subject || !d.subject.goalRef || !d.subject.sourcePlanRef) return false;
    if (!d.proposalRef || d.proposalRef.aggregateType !== "PlanProposal") return false;
    if (!d.authority) return false;
    if (!this.authorityLegal(d.authority)) return false;
    return true;
  }

  private applyShapeValid(command: ApplyPlanChangeCommand): boolean {
    if (command.schemaVersion !== 1 || command.commandType !== "ApplyPlanChange") return false;
    if (!command.payload || !command.payload.proposalRef || !command.payload.decisionRef) return false;
    if (command.payload.proposalRef.aggregateType !== "PlanProposal") return false;
    if (command.payload.decisionRef.aggregateType !== "UserDecision") return false;
    if (command.aggregateId !== command.payload.proposalRef.proposalId) return false;
    if (command.payload.newPlanDraft === null || command.payload.newPlanDraft === undefined) return false;
    if (!command.payload.changeReason) return false;
    if (typeof command.expectedRevision !== "number" || command.expectedRevision < 1) return false;
    return true;
  }

  private authorityLegal(a: UserDecisionV1["authority"]): boolean {
    if (a.strategy !== "user" && a.strategy !== "delegated") return false;
    if (a.strategy === "delegated" && a.delegator === null) return false;
    if (a.strategy === "user" && a.delegator !== null) return false;
    if (!a.policyVersion) return false;
    return true;
  }

  /** 任务集增量的有界形状检查（记录期；语义检查在 applyPlanChange 守卫 f）。 */
  private taskSetDeltaShapeValid(delta: unknown): boolean {
    if (delta === null || delta === undefined) return true;
    if (!Array.isArray(delta)) return false;
    if (delta.length > PLAN_CHANGE_MAX_TASK_DELTAS) return false;
    return delta.every((op) => {
      if (op === null || typeof op !== "object") return false;
      const action = (op as { action?: unknown }).action;
      if (action === "addTask") {
        const task = (op as { task?: { taskId?: unknown } }).task;
        return task !== null && task !== undefined && typeof task === "object" && typeof task.taskId === "string" && task.taskId.length > 0;
      }
      if (action === "replaceTask") {
        const ids = op as { supersededTaskId?: unknown; byTaskId?: unknown };
        return typeof ids.supersededTaskId === "string" && typeof ids.byTaskId === "string";
      }
      if (action === "cancelTask") return typeof (op as { taskId?: unknown }).taskId === "string";
      return false;
    });
  }

  // --------------------------------------------------------------------- //
  // Draft completion + replay helpers                                       //
  // --------------------------------------------------------------------- //

  /** Inherit null stages/taskHierarchy/executionDag from the source snapshot and
   * resolve the new task set: the draft's own tasks when present (the ADR 0003 D1
   * path, already proven equal to source+delta), otherwise the source task set.
   * RW-07: the assignment set follows the same rule (draft's own, else source+delta). */
  private inheritFromSource(
    source: PlanRevisionSnapshot,
    draft: NewPlanDraft,
    delta: PlanPatchV1["patchDraft"]["taskSetDelta"] | null,
  ): CompletedNewPlanDraft {
    return {
      ...draft,
      tasks: Array.isArray(draft.tasks)
        ? (draft.tasks as RuntimeTask[]).map((t) => ({ ...t, scope: { ...t.scope } }))
        : deriveTaskSet(source, delta).tasks,
      assignments: Array.isArray(draft.assignments)
        ? (draft.assignments as PlanTaskAssignment[]).map((entry) => ({ taskId: entry.taskId, role: entry.role, instruction: entry.instruction }))
        : deriveTaskAssignments(source, delta),
      stages: draft.stages === null ? source.stages.map((s) => ({ ...s })) : draft.stages,
      taskHierarchy:
        draft.taskHierarchy === null
          ? { parentOf: source.taskHierarchy.parentOf.map((e) => ({ ...e })) }
          : draft.taskHierarchy,
      executionDag:
        draft.executionDag === null
          ? { dependsOn: source.executionDag.dependsOn.map((e) => ({ ...e, requires: { ...e.requires } })) }
          : draft.executionDag,
    };
  }

  /** Recognize an idempotent replay of an already-committed apply command. */
  private async replayedApply(command: ApplyPlanChangeCommand): Promise<ApplyPlanChangeReceipt | null> {
    const page = await this.deps.ledger.events({ afterCursor: null, limit: 100000 });
    const events = page.events.filter((p) => p.event.causationId === command.commandId);
    if (events.length === 0) return null;
    const planAccepted = events.find((p) => p.event.eventType === "PlanRevisionAccepted");
    const goalRev = events.find((p) => p.event.eventType === "GoalRevisionRecorded");
    if (!planAccepted || !goalRev) return null;
    const ordered = [...events].sort((a, b) =>
      seqOfCommitCursor(a.cursor) < seqOfCommitCursor(b.cursor) ? -1 : 1,
    );
    const change = (goalRev.event as GoalRevisionRecordedEvent).payload.change;
    const planRevision = (planAccepted.event as PlanRevisionAcceptedEvent).payload.planRevision;
    const goalRevisionRef: GoalRevisionSnapshot["ref"] = {
      aggregateType: "GoalRevision",
      projectId: change.goalRef.projectId,
      workspaceId: command.payload.proposalRef.workspaceId,
      goalId: change.goalRef.goalId,
      revision: change.revision,
    };
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: true,
      goalRevision: goalRevisionRef,
      activePlanRef: planRevision.ref,
      eventIds: ordered.map((p) => p.event.eventId),
      commitCursor: ordered[ordered.length - 1]!.cursor,
    };
  }

  // --------------------------------------------------------------------- //
  // Receipt mapping helpers                                                 //
  // --------------------------------------------------------------------- //

  private mapProposalReceipt(
    receipt: LedgerCommitReceipt,
    command: RecordPlanChangeProposalCommand,
    proposalId: string,
    workspaceId: string,
  ): RecordPlanChangeProposalReceipt {
    if (receipt.status === "committed") {
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        proposalRef: { aggregateType: "PlanProposal", projectId: command.identity.projectId, workspaceId, proposalId },
        eventIds: receipt.eventIds,
        commitCursor: receipt.commitCursor,
      };
    }
    switch (receipt.code) {
      case "invalid_commit":
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
      case "revision_conflict":
        return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
      case "idempotency_conflict":
        return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
      case "unavailable":
        return { status: "rejected", commandId: command.commandId, code: "unavailable" };
      case "not_empty":
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
  }

  private mapDecisionReceipt(
    receipt: LedgerCommitReceipt,
    command: RecordUserDecisionCommand,
    decisionId: string,
    workspaceId: string,
  ): RecordUserDecisionReceipt {
    if (receipt.status === "committed") {
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        decisionRef: { aggregateType: "UserDecision", projectId: command.identity.projectId, workspaceId, decisionId },
        eventIds: receipt.eventIds,
        commitCursor: receipt.commitCursor,
      };
    }
    switch (receipt.code) {
      case "invalid_commit":
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
      case "revision_conflict":
        return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
      case "idempotency_conflict":
        return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
      case "unavailable":
        return { status: "rejected", commandId: command.commandId, code: "unavailable" };
      case "not_empty":
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
  }

  private mapApplyReceipt(
    receipt: LedgerCommitReceipt,
    command: ApplyPlanChangeCommand,
    loadedGoal: GoalSnapshot,
    draft: NewPlanDraft,
  ): ApplyPlanChangeReceipt {
    if (receipt.status === "committed") {
      const goalRevisionRef =
        (receipt.aggregateRevisions.find((v) => v.ref.aggregateType === "GoalRevision")?.ref as
          | GoalRevisionSnapshot["ref"]
          | undefined) ??
        ({
          aggregateType: "GoalRevision",
          projectId: command.payload.proposalRef.projectId,
          workspaceId: command.payload.proposalRef.workspaceId,
          goalId: loadedGoal.ref.goalId,
          revision: command.expectedRevision + 1,
        } as GoalRevisionSnapshot["ref"]);
      const activePlanRef: PlanRevisionRef = {
        aggregateType: "PlanRevision",
        projectId: command.payload.proposalRef.projectId,
        planId: draft.planId,
      };
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        goalRevision: goalRevisionRef,
        activePlanRef,
        eventIds: receipt.eventIds,
        commitCursor: receipt.commitCursor,
      };
    }
    switch (receipt.code) {
      case "invalid_commit":
        // A stale CAS window (command.expectedRevision != loaded revision) folds
        // an internally-valid batch the shared validator maps to invalid_commit;
        // surface that as revision_conflict (P1-02 pattern).
        if (loadedGoal.revision !== command.expectedRevision) {
          return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
        }
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
      case "revision_conflict":
        return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
      case "idempotency_conflict":
        return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
      case "unavailable":
        return { status: "rejected", commandId: command.commandId, code: "unavailable" };
      case "not_empty":
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
  }
}
