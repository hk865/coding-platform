/**
 * Human/role collaboration Control entry: initial-design and coordination-policy handlers.
 *
 * Public entry. Implements four human-collaboration and coordination-policy commands behind the versioned guard
 * chain recorded in the current contracts:
 *
 *   1. recordInitialDesignProposal: shape -> invalid (schemaVersion / options
 *      2..16 with non-empty summary / requirement.ambiguity non-empty);
 *      ledger.load(proposal.goalRef) -> not_found; commit buildInitialDesignProposalRecordCommit
 *      (CAS @0). Receipt mapping: committed/proposalRef + replayed/eventIds/
 *      commitCursor; invalid_commit -> invalid; revision/idempotency/unavailable
 *      pass through.
 *   2. recordInitialDesignDecision: shape -> invalid (subject.proposalRevision
 *      === 1 / outcome enum / authority shape); ledger.load(decision.proposalRef)
 *      -> proposal_not_found; authorizedTarget.designId == loaded proposal.designId
 *      AND authorizedTarget.proposalDigest == initialDesignProposalDigest(loaded)
 *      -> else target_mismatch (ZERO write); commit buildInitialDesignDecisionRecordCommit.
 *   3. installCoordinationPolicy: payload.contentDigest ==
 *      coordinationPolicyContentDigest(content, policyId, 1) -> else
 *      digest_mismatch; shape (budget.maxAutonomousReworks 1..4 /
 *      budget.maxClarifications 1..8 / upgrade.path === manual-decision) ->
 *      invalid; commit buildCoordinationPolicyInstallRecordCommit. NEVER auto-activates.
 *   4. activateCoordinationPolicy: ledger.load(target.ref) -> not_found; digest
 *      mismatch -> digest_mismatch; commit buildCoordinationPolicyActivateRecordCommit
 *      (Project CAS@command.expectedRevision + active aggregate @k).
 *
 * Receipt mapping mirrors control-engine / governance-activate: invalid_commit
 * -> invalid; revision_conflict / idempotency_conflict / unavailable pass
 * through. All pre-commit guard failures are ZERO write.
 *
 * Activation uses two distinct guards: Project@command.expectedRevision protects
 * project-level ordering, while the active-policy aggregate advances from its own
 * current revision. StateLedger rechecks both at commit time.
 */
import type {
  ActivateCoordinationPolicyCommand,
  ActivateCoordinationPolicyReceipt,
  InstallCoordinationPolicyCommand,
  InstallCoordinationPolicyReceipt,
  RecordInitialDesignDecisionCommand,
  RecordInitialDesignDecisionReceipt,
  RecordInitialDesignProposalCommand,
  RecordInitialDesignProposalReceipt,
  InitialDesignProposalV1,
  InitialDesignProposalSnapshot,
  InitialDesignDecisionV1,
  InitialDesignDecisionSnapshot,
  CoordinationPolicyRevisionSnapshot,
  ProjectCoordinationPolicyActiveSnapshot,
} from "../../contracts/human-role-collaboration.js";
import {
  initialDesignProposalRefFor,
  initialDesignDecisionRefFor,
  initialDesignProposalDigest,
  coordinationPolicyContentDigest,
  INITIAL_DESIGN_MAX_OPTIONS,
  INITIAL_DESIGN_OPTION_SUMMARY_MAX_BYTES,
  COORDINATION_AUTONOMOUS_REWORK_BUDGET_MAX,
  COORDINATION_POLICY_REVISION_V1,
} from "../../contracts/human-role-collaboration.js";
import { buildInitialDesignProposalRecordCommit, buildInitialDesignDecisionRecordCommit, buildCoordinationPolicyInstallRecordCommit, buildCoordinationPolicyActivateRecordCommit } from "./records/human-role-collaboration.js";
// 角色矩阵是协调策略正文的一部分，安装期形状校验与 RoleSpecRevision 的校验器共用同一份实现。
import { validateCoordinationRoleMatrix } from '../../contracts/validation/role.js';
import type { LedgerCommitReceipt, SnapshotResult } from "../../contracts/ledger.js";
import type { ControlEngineDeps } from "./control-engine.js";

/** Implementation of the four versioned human-collaboration and coordination-policy handlers. */
export class HumanRoleCollaborationEngineImpl {
  constructor(private readonly deps: ControlEngineDeps) {}

  recordProposal(command: RecordInitialDesignProposalCommand): Promise<RecordInitialDesignProposalReceipt> {
    return recordProposalImpl(this.deps, command);
  }

  recordDecision(command: RecordInitialDesignDecisionCommand): Promise<RecordInitialDesignDecisionReceipt> {
    return recordDecisionImpl(this.deps, command);
  }

  installPolicy(command: InstallCoordinationPolicyCommand): Promise<InstallCoordinationPolicyReceipt> {
    return installPolicyImpl(this.deps, command);
  }

  activatePolicy(command: ActivateCoordinationPolicyCommand): Promise<ActivateCoordinationPolicyReceipt> {
    return activatePolicyImpl(this.deps, command);
  }
}

// ------------------------------------------------------------------------ //
// Handlers                                                                   //
// ------------------------------------------------------------------------ //

async function recordProposalImpl(
  deps: ControlEngineDeps,
  command: RecordInitialDesignProposalCommand,
): Promise<RecordInitialDesignProposalReceipt> {
  // Guard 1: shape (zero write).
  const shapeIssues = validateProposalShape(command);
  if (shapeIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid", issues: shapeIssues };
  }

  const proposal = command.payload.proposal;

  // Guard 2: the goal the proposal is scoped to must exist (zero write).
  const goalResult = await deps.ledger.load(proposal.goalRef);
  if (goalResult.status !== "found" || goalResult.snapshot.ref.aggregateType !== "Goal") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildInitialDesignProposalRecordCommit(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      proposalRef: initialDesignProposalRefFor(proposal.projectId, proposal.workspaceId, proposal.designId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapProposalRejected(receipt, command.commandId);
}

async function recordDecisionImpl(
  deps: ControlEngineDeps,
  command: RecordInitialDesignDecisionCommand,
): Promise<RecordInitialDesignDecisionReceipt> {
  // Guard 1: shape (zero write).
  const shapeIssues = validateDecisionShape(command);
  if (shapeIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid", issues: shapeIssues };
  }

  const decision = command.payload.decision;

  // Guard 2: the proposal the decision binds must exist (zero write).
  const proposalResult = await deps.ledger.load(decision.proposalRef);
  if (proposalResult.status !== "found" || proposalResult.snapshot.ref.aggregateType !== "InitialDesignProposal") {
    return { status: "rejected", commandId: command.commandId, code: "proposal_not_found" };
  }
  const proposal = (proposalResult.snapshot as InitialDesignProposalSnapshot).proposal;

  // Guard 3: exact target matching — authorizedTarget.designId == loaded
  // proposal.designId AND authorizedTarget.proposalDigest == digest(proposal).
  const designMatch = decision.authorizedTarget.designId === proposal.designId;
  const digestMatch = decision.authorizedTarget.proposalDigest === initialDesignProposalDigest(proposal);
  if (!designMatch || !digestMatch) {
    return { status: "rejected", commandId: command.commandId, code: "target_mismatch" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildInitialDesignDecisionRecordCommit(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      decisionRef: initialDesignDecisionRefFor(decision.projectId, decision.workspaceId, decision.decisionId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapDecisionRejected(receipt, command.commandId);
}

async function installPolicyImpl(
  deps: ControlEngineDeps,
  command: InstallCoordinationPolicyCommand,
): Promise<InstallCoordinationPolicyReceipt> {
  const payload = command.payload;

  // Guard 1: content must be structurally usable to compute the digest.
  if (!isRecord(payload.content) || !isString(payload.policyId) || !isString(payload.contentDigest)) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  // Guard 2: content digest must match the command-provided digest (zero write).
  // 摘要口径固定用 COORDINATION_POLICY_REVISION_V1（=1）：一个 policyId 只有一份安装 revision。
  const expectedDigest = coordinationPolicyContentDigest(payload.content, payload.policyId, COORDINATION_POLICY_REVISION_V1);
  if (payload.contentDigest !== expectedDigest) {
    return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
  }

  // Guard 3: shape (budget ranges / upgrade path) — zero write.
  if (validateInstallShape(command).length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildCoordinationPolicyInstallRecordCommit(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      revisionRef: (batch.snapshots[0]! as CoordinationPolicyRevisionSnapshot).ref,
      contentDigest: payload.contentDigest,
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapInstallRejected(receipt, command.commandId);
}

async function activatePolicyImpl(
  deps: ControlEngineDeps,
  command: ActivateCoordinationPolicyCommand,
): Promise<ActivateCoordinationPolicyReceipt> {
  const target = command.payload.target;

  // Guard 1: target revision must be installed (zero write).
  const targetResult = await deps.ledger.load(target.ref);
  if (targetResult.status !== "found" || targetResult.snapshot.ref.aggregateType !== "CoordinationPolicyRevision") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const revision = (targetResult.snapshot as CoordinationPolicyRevisionSnapshot);

  // Guard 2: digest must match the installed revision (zero write).
  if (
    revision.ref.projectId !== target.ref.projectId ||
    revision.policyId !== target.ref.policyId ||
    revision.contentRevision !== target.ref.revision ||
    revision.contentDigest !== target.digest
  ) {
    return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
  }

  // Per project active aggregate revision ("active@k").
  const activeRef = { aggregateType: "ProjectCoordinationPolicyActive" as const, projectId: command.identity.projectId };
  const active = await deps.ledger.load(activeRef);
  const activeExpected = active.status === "found" ? active.snapshot.revision : 0;
  const newActiveRevision = activeExpected + 1;

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildCoordinationPolicyActivateRecordCommit(command, {
    eventId,
    occurredAt,
    activeAggregateRevision: newActiveRevision,
    projectRevision: command.expectedRevision,
  });
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status === "committed") {
    const snap = batch.snapshots[0]! as ProjectCoordinationPolicyActiveSnapshot;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      activeRef: snap.ref,
      activeRevision: snap.activeRevision,
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapActivateRejected(receipt, command.commandId);
}

// ------------------------------------------------------------------------ //
// Receipt mapping                                                            //
// ------------------------------------------------------------------------ //

type LedgerRejected = Extract<LedgerCommitReceipt, { status: "rejected" }>;

function mapCommittedRejection(
  receipt: LedgerRejected,
  commandId: string,
): { status: "rejected"; commandId: string; code: "invalid" | "revision_conflict" | "idempotency_conflict" | "unavailable" } {
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId, code: "revision_conflict" };
    case "idempotency_conflict":
      return { status: "rejected", commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId, code: "unavailable" };
    case "not_empty":
      // Not reachable for these commits (all carry a non-empty expectedVersions);
      // treat as a malformed commit rather than inventing a code.
      return { status: "rejected", commandId, code: "invalid" };
  }
}

function mapProposalRejected(receipt: LedgerRejected, commandId: string): RecordInitialDesignProposalReceipt {
  return mapCommittedRejection(receipt, commandId);
}
function mapDecisionRejected(receipt: LedgerRejected, commandId: string): RecordInitialDesignDecisionReceipt {
  return mapCommittedRejection(receipt, commandId);
}
function mapInstallRejected(receipt: LedgerRejected, commandId: string): InstallCoordinationPolicyReceipt {
  return mapCommittedRejection(receipt, commandId);
}
function mapActivateRejected(receipt: LedgerRejected, commandId: string): ActivateCoordinationPolicyReceipt {
  return mapCommittedRejection(receipt, commandId);
}

// ------------------------------------------------------------------------ //
// Inline shape validators (these commands have no contract validators yet).     //
// these inline guards all produce ZERO writes on failure).                           //
// ------------------------------------------------------------------------ //

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function validateProposalShape(command: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(command)) return ["command not an object"];
  if (command["commandType"] !== "RecordInitialDesignProposal") issues.push("commandType");
  if (command["schemaVersion"] !== 1) issues.push("schemaVersion");
  if (!isString(command["commandId"])) issues.push("commandId");
  if (!isString(command["aggregateId"])) issues.push("aggregateId");
  if (command["expectedRevision"] !== 0) issues.push("expectedRevision");
  if (!isRecord(command["identity"])) {
    issues.push("identity");
  } else if (!isString(command["identity"]["projectId"]) || !isRecord(command["identity"]["actor"]) || !isString(command["identity"]["idempotencyKey"])) {
    issues.push("identity");
  }
  const payload = command["payload"];
  if (!isRecord(payload)) {
    issues.push("payload");
    return issues;
  }
  const p = payload["proposal"];
  if (!isRecord(p)) {
    issues.push("payload.proposal");
    return issues;
  }
  if (p["schemaVersion"] !== 1) issues.push("proposal.schemaVersion");
  if (!isNonEmptyString(p["designId"]) || !isNonEmptyString(p["projectId"]) || !isNonEmptyString(p["workspaceId"])) issues.push("proposal.identity");
  const goalRef = p["goalRef"];
  if (!isRecord(goalRef) || goalRef["aggregateType"] !== "Goal" || !isString(goalRef["projectId"]) || !isString(goalRef["goalId"])) {
    issues.push("proposal.goalRef");
  }
  const planRef = p["planRef"];
  if (planRef !== null && (!isRecord(planRef) || planRef["aggregateType"] !== "PlanRevision" || !isString(planRef["projectId"]) || !isString(planRef["planId"]))) {
    issues.push("proposal.planRef");
  }
  const requirement = p["requirement"];
  if (!isRecord(requirement)) {
    issues.push("proposal.requirement");
  } else {
    if (!isNonEmptyString(requirement["ambiguity"])) issues.push("proposal.requirement.ambiguity");
    const interpretations = requirement["interpretations"];
    if (!Array.isArray(interpretations) || interpretations.some((i) => !isString(i))) issues.push("proposal.requirement.interpretations");
  }
  const options = p["options"];
  if (!Array.isArray(options)) {
    issues.push("proposal.options");
  } else {
    if (options.length < 2) issues.push("proposal.options.min2");
    if (options.length > INITIAL_DESIGN_MAX_OPTIONS) issues.push("proposal.options.max16");
    options.forEach((opt, idx) => {
      if (!isRecord(opt)) {
        issues.push("proposal.options[" + idx + "]");
        return;
      }
      if (!isNonEmptyString(opt["optionId"])) issues.push("proposal.options[" + idx + "].optionId");
      if (!isNonEmptyString(opt["summary"])) issues.push("proposal.options[" + idx + "].summary");
      if (!isString(opt["impactDelta"])) issues.push("proposal.options[" + idx + "].impactDelta");
      if (isString(opt["summary"]) && opt["summary"].length > INITIAL_DESIGN_OPTION_SUMMARY_MAX_BYTES) issues.push("proposal.options[" + idx + "].summary.maxBytes");
    });
  }
  if (!isRecord(p["requestedBy"]) || !isString(p["requestedBy"]["kind"]) || !isString(p["requestedBy"]["id"])) issues.push("proposal.requestedBy");
  if (!isString(p["submittedAt"])) issues.push("proposal.submittedAt");
  return issues;
}

function validateDecisionShape(command: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(command)) return ["command not an object"];
  if (command["commandType"] !== "RecordInitialDesignDecision") issues.push("commandType");
  if (command["schemaVersion"] !== 1) issues.push("schemaVersion");
  if (!isString(command["commandId"])) issues.push("commandId");
  if (!isString(command["aggregateId"])) issues.push("aggregateId");
  if (command["expectedRevision"] !== 0) issues.push("expectedRevision");
  if (!isRecord(command["identity"])) {
    issues.push("identity");
  } else if (!isString(command["identity"]["projectId"]) || !isRecord(command["identity"]["actor"]) || !isString(command["identity"]["idempotencyKey"])) {
    issues.push("identity");
  }
  const payload = command["payload"];
  if (!isRecord(payload)) {
    issues.push("payload");
    return issues;
  }
  const d = payload["decision"];
  if (!isRecord(d)) {
    issues.push("payload.decision");
    return issues;
  }
  if (d["schemaVersion"] !== 1) issues.push("decision.schemaVersion");
  if (!isNonEmptyString(d["decisionId"]) || !isNonEmptyString(d["projectId"]) || !isNonEmptyString(d["workspaceId"])) issues.push("decision.identity");
  const proposalRef = d["proposalRef"];
  if (!isRecord(proposalRef) || proposalRef["aggregateType"] !== "InitialDesignProposal" || !isString(proposalRef["projectId"]) || !isString(proposalRef["workspaceId"]) || !isString(proposalRef["designId"])) {
    issues.push("decision.proposalRef");
  }
  const subject = d["subject"];
  if (!isRecord(subject) || subject["proposalRevision"] !== 1) issues.push("decision.subject.proposalRevision");
  if (!isString(d["outcome"]) || !["accept", "reject", "defer"].includes(d["outcome"])) issues.push("decision.outcome");
  if (!isRecord(d["actor"]) || !isString(d["actor"]["kind"]) || !isString(d["actor"]["id"])) issues.push("decision.actor");
  const authority = d["authority"];
  if (!isRecord(authority)) {
    issues.push("decision.authority");
  } else if (authority["strategy"] !== "user" && authority["strategy"] !== "delegated") {
    issues.push("decision.authority.strategy");
  } else if (authority["strategy"] === "user" && authority["delegator"] !== null) {
    issues.push("decision.authority.delegator");
  } else if (authority["strategy"] === "delegated" && !isString(authority["delegator"])) {
    issues.push("decision.authority.delegator");
  } else if (!isNonEmptyString(authority["policyVersion"])) {
    issues.push("decision.authority.policyVersion");
  }
  const authorizedTarget = d["authorizedTarget"];
  if (!isRecord(authorizedTarget) || !isNonEmptyString(authorizedTarget["designId"]) || !isNonEmptyString(authorizedTarget["optionId"]) || !isNonEmptyString(authorizedTarget["proposalDigest"])) {
    issues.push("decision.authorizedTarget");
  }
  if (!isString(d["summary"])) issues.push("decision.summary");
  if (!isString(d["decidedAt"])) issues.push("decision.decidedAt");
  return issues;
}

function validateInstallShape(command: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(command)) return ["command not an object"];
  if (command["commandType"] !== "InstallCoordinationPolicy") issues.push("commandType");
  if (command["schemaVersion"] !== 1) issues.push("schemaVersion");
  if (!isString(command["commandId"])) issues.push("commandId");
  if (!isRecord(command["identity"])) {
    issues.push("identity");
  } else if (!isString(command["identity"]["projectId"]) || !isRecord(command["identity"]["actor"]) || !isString(command["identity"]["idempotencyKey"])) {
    issues.push("identity");
  }
  const payload = command["payload"];
  if (!isRecord(payload)) {
    issues.push("payload");
    return issues;
  }
  if (!isString(payload["policyId"])) issues.push("payload.policyId");
  const content = payload["content"];
  if (!isRecord(content)) {
    issues.push("payload.content");
    return issues;
  }
  if (content["schemaVersion"] !== 1) issues.push("payload.content.schemaVersion");
  const budget = content["budget"];
  if (!isRecord(budget)) {
    issues.push("payload.content.budget");
  } else {
    if (!isNumber(budget["maxAutonomousReworks"]) || budget["maxAutonomousReworks"] < 1 || budget["maxAutonomousReworks"] > COORDINATION_AUTONOMOUS_REWORK_BUDGET_MAX) {
      issues.push("payload.content.budget.maxAutonomousReworks");
    }
    if (!isNumber(budget["maxClarifications"]) || budget["maxClarifications"] < 1 || budget["maxClarifications"] > 8) {
      issues.push("payload.content.budget.maxClarifications");
    }
  }
  const allowed = content["allowed"];
  // 人的暂停开关：allowed.inScopeRework 是运行时可读的授权位，因此取值必须是布尔
  // （true=允许范围内的自动返工，false=人已停用，自动受理转人工且零写入）。
  // 这里只放宽这一个位；inScopeTesting 没有运行时消费者，继续要求 true——放宽它等于在没有
  // 判据的地方先降低安装期判据。
  if (!isRecord(allowed) || typeof allowed["inScopeRework"] !== "boolean" || allowed["inScopeTesting"] !== true) issues.push("payload.content.allowed");
  const scope = content["scope"];
  if (!isRecord(scope) || !Array.isArray(scope["changesRequireHumanDecision"])) issues.push("payload.content.scope");
  const upgrade = content["upgrade"];
  if (!isRecord(upgrade) || upgrade["path"] !== "manual-decision") issues.push("payload.content.upgrade.path");
  // 角色矩阵**可选**（既有正式来源没有这个字段，收紧会让它们失效），但一旦出现就必须完整：
  // catalog 里每个 pin 都要有角色、正数 revision 与摘要，coordinator 必须指向已登记角色。
  // 「可选」不等于「角色已校验」——没有矩阵的项目沿用既有绑定语义，Control 不补默认目录。
  if (content["roles"] !== undefined) {
    const matrixIssues: import("../../contracts/validation/common.js").ValidationIssue[] = [];
    validateCoordinationRoleMatrix(content["roles"], "payload.content.roles", matrixIssues);
    if (matrixIssues.length > 0) issues.push("payload.content.roles");
  }
  return issues;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}
