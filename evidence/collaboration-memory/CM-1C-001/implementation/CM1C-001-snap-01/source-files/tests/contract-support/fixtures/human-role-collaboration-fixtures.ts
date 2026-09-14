
/** P1-15 shared fixtures: initial-design + coordination-policy builders + folds. */

import { initialDesignProposalDigest, coordinationPolicyContentDigest, P15_COORDINATION_POLICY_REVISION, type InitialDesignProposalV1, type InitialDesignDecisionV1, type CoordinationPolicyContentV1, type RecordInitialDesignProposalCommand, type RecordInitialDesignDecisionCommand, type InstallCoordinationPolicyCommand, type ActivateCoordinationPolicyCommand } from "../../../src/contracts/human-role-collaboration.js";
import { buildCoordinationPolicyActivateCommand, buildCoordinationPolicyInstallCommand } from "../../../src/contracts/commands/governance.js";

export const P115_PROJECT = "proj-alpha";
export const P115_WORKSPACE = "ws-shared";
export const P115_SCHEMA = "2026-09-06T00:00:00.000Z";
export const P115_DESIGN = "design-p115-1";
export const P115_DECISION = "decision-p115-1";
export const P115_POLICY = "coordination-policy-1";

export function buildP115Proposal(overrides: Partial<InitialDesignProposalV1> = {}): InitialDesignProposalV1 {
  return {
    schemaVersion: 1,
    designId: P115_DESIGN,
    projectId: P115_PROJECT,
    workspaceId: P115_WORKSPACE,
    goalRef: { aggregateType: "Goal", projectId: P115_PROJECT, goalId: "goal-1" },
    planRef: { aggregateType: "PlanRevision", projectId: P115_PROJECT, planId: "plan-mvp-1" },
    requirement: { ambiguity: "需求歧义：MVP 范围是否包含查询入口？", interpretations: ["含只读查询", "不含，仅显示"] },
    options: [
      { optionId: "opt-a", summary: "包含只读查询入口（P1-09 能力）", impactDelta: "多一个查询入口" },
      { optionId: "opt-b", summary: "仅显示状态（P1-08 能力）", impactDelta: "范围更小" },
    ],
    requestedBy: { kind: "human", id: "user-owner-1" },
    submittedAt: P115_SCHEMA,
    ...overrides,
  };
}

export function buildP115Decision(proposal: InitialDesignProposalV1, overrides: Partial<InitialDesignDecisionV1> = {}): InitialDesignDecisionV1 {
  return {
    schemaVersion: 1,
    decisionId: P115_DECISION,
    projectId: proposal.projectId,
    workspaceId: proposal.workspaceId,
    proposalRef: p115DesignRef(proposal.projectId),
    subject: { proposalRevision: 1 },
    outcome: "accept",
    actor: { kind: "human", id: "user-owner-1" },
    authority: { strategy: "user", delegator: null, policyVersion: "initial-design-policy@1" },
    authorizedTarget: { designId: proposal.designId, optionId: proposal.options[0]?.optionId ?? "opt-a", proposalDigest: initialDesignProposalDigest(proposal) },
    summary: "接受包含查询入口的初始设计",
    decidedAt: P115_SCHEMA,
    ...overrides,
  };
}

export const P115_COORDINATION_POLICY_CONTENT: CoordinationPolicyContentV1 = {
  schemaVersion: 1,
  budget: { maxAutonomousReworks: 1, maxClarifications: 3 },
  allowed: { inScopeRework: true, inScopeTesting: true },
  scope: { changesRequireHumanDecision: ["requirement", "acceptance", "baseline"] },
  upgrade: { path: "manual-decision", note: "策略升级需人工决定" },
};

/**
 * RW-10 薄包装：这两个 builder 只填 P1-15 的测试默认值（固定时间、user-owner-1、commandId 派生键），
 * 字段级构造全部交给契约命令层（contracts/commands/governance.ts）。这样生产入口与夹具走同一条
 * 构造路径，字段一旦变化两边不会各自漂移；本文件不再自己拼 payload 或自己算 digest
 * （digest 口径的唯一权威在契约与 ControlEngine 的安装守卫，不在夹具）。
 */
export function buildP115InstallCommand(projectId: string = P115_PROJECT, deps: { commandId: string } = { commandId: "p115-cmd-install-policy" }): InstallCoordinationPolicyCommand {
  return buildCoordinationPolicyInstallCommand(
    { policyId: P115_POLICY, content: P115_COORDINATION_POLICY_CONTENT },
    { commandId: deps.commandId, correlationId: deps.commandId + "-corr", submittedAt: P115_SCHEMA, projectId, actor: { kind: "human", id: "user-owner-1" }, idempotencyKey: deps.commandId + "-idem" },
  );
}
export function buildP115ActivateCommand(projectId: string = P115_PROJECT, deps: { commandId: string; expectedRevision: number } = { commandId: "p115-cmd-activate-policy", expectedRevision: 1 }): ActivateCoordinationPolicyCommand {
  return buildCoordinationPolicyActivateCommand(
    { ref: p115PolicyRef(projectId), digest: coordinationPolicyContentDigest(P115_COORDINATION_POLICY_CONTENT, P115_POLICY, P15_COORDINATION_POLICY_REVISION) },
    { commandId: deps.commandId, correlationId: deps.commandId + "-corr", submittedAt: P115_SCHEMA, projectId, actor: { kind: "human", id: "user-owner-1" }, idempotencyKey: deps.commandId + "-idem", expectedRevision: deps.expectedRevision },
  );
}

export function buildP115ProposalCommand(proposal: InitialDesignProposalV1, deps: { commandId: string }): RecordInitialDesignProposalCommand {
  return { commandId: deps.commandId, commandType: "RecordInitialDesignProposal", schemaVersion: 1, identity: { projectId: proposal.projectId, actor: proposal.requestedBy, idempotencyKey: deps.commandId + "-idem" }, aggregateId: proposal.designId, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P115_SCHEMA, payload: { proposal } };
}
export function buildP115DecisionCommand(decision: InitialDesignDecisionV1, deps: { commandId: string }): RecordInitialDesignDecisionCommand {
  return { commandId: deps.commandId, commandType: "RecordInitialDesignDecision", schemaVersion: 1, identity: { projectId: decision.projectId, actor: decision.actor, idempotencyKey: deps.commandId + "-idem" }, aggregateId: decision.decisionId, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P115_SCHEMA, payload: { decision } };
}


import { initialDesignProposalRefFor, initialDesignDecisionRefFor, type CoordinationPolicyRevisionRef } from "../../../src/contracts/human-role-collaboration.js";

export function p115DesignRef(projectId: string = P115_PROJECT) {
  return initialDesignProposalRefFor(projectId, P115_WORKSPACE, P115_DESIGN);
}
export function p115DecisionRef(projectId: string = P115_PROJECT) {
  return initialDesignDecisionRefFor(projectId, P115_WORKSPACE, P115_DECISION);
}
export function p115PolicyRef(projectId: string = P115_PROJECT): CoordinationPolicyRevisionRef {
  return { aggregateType: "CoordinationPolicyRevision", projectId, policyId: P115_POLICY, revision: 1 };
}
export function p115PolicyActiveRef(projectId: string = P115_PROJECT): { aggregateType: "ProjectCoordinationPolicyActive"; projectId: string } {
  return { aggregateType: "ProjectCoordinationPolicyActive", projectId };
}
