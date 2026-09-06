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
} from "../contracts/goal-change.js";
import { decisionTargetFor, draftConsistencyIssues } from "../contracts/goal-change.js";
import type {
  PlanRevisionAcceptedEvent,
  PlanRevisionDraft,
  PlanRevisionRef,
  PlanRevisionSnapshot,
  PlanStage,
  RuntimeExecutionDAG,
  TaskHierarchy,
} from "../contracts/plan.js";
import type {
  GoalRef,
  GoalSnapshot,
  LedgerCommitReceipt,
  SnapshotResult,
} from "../contracts/ledger.js";
import { seqOfCommitCursor } from "../contracts/ledger.js";
import { resolveProjectArchitectureBaseline, resolveProjectCompletionPolicy } from "../contracts/governance.js";
import { applyPlanGuardIssues } from "./plan-acceptance.js";
import {
  buildGoalChangeApplyCommit,
  buildPlanChangeProposalRecordCommit,
  buildUserDecisionRecordCommit,
} from "../contracts/fixtures/goal-change-fixtures.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import type { ControlEngineDeps } from "./control-engine.js";

type NewPlanDraft = NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>;

type CompletedNewPlanDraft = NewPlanDraft & {
  stages: PlanStage[];
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

    // Guard f: draft-consistency (the new plan draft must reflect the patch).
    const draft: NewPlanDraft = command.payload.newPlanDraft as NewPlanDraft;
    const draftIssues = draftConsistencyIssues(proposal, decision, draft, sourcePlan);
    if (draftIssues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "draft_mismatch", issues: draftIssues };
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
    const completedDraft: CompletedNewPlanDraft = this.inheritFromSource(sourcePlan, draft);
    const assembled: PlanRevisionDraft = {
      schemaVersion: 1,
      planId: completedDraft.planId,
      planRevision: completedDraft.planRevision,
      goalId: goalRef.goalId,
      stages: completedDraft.stages,
      tasks: sourcePlan.tasks,
      obligations: completedDraft.obligations,
      taskHierarchy: completedDraft.taskHierarchy,
      executionDag: completedDraft.executionDag,
    };
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

  // --------------------------------------------------------------------- //
  // Draft completion + replay helpers                                       //
  // --------------------------------------------------------------------- //

  /** Inherit null stages/taskHierarchy/executionDag from the source snapshot. */
  private inheritFromSource(source: PlanRevisionSnapshot, draft: NewPlanDraft): CompletedNewPlanDraft {
    return {
      ...draft,
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
