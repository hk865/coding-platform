/**
 * RW-09 时间线可见性：受理结果必须在读模型里能区分「系统自动受理」与「人的决定」。
 *
 * 覆盖什么：
 *   1. 计划变更受理（goal-change-apply 批次）产生的 plan_accepted 时间线条目带
 *      `change.reason` 与 `change.actor`，取值逐字来自 canonical 的
 *      `GoalRevisionRecorded.change.reason` 与同一条已提交事件的 actor；
 *   2. 人的决定受理（changeReason=user-decision-accepted、actor=human）与系统自动受理
 *      （changeReason=autonomous-rework:<proposalId>、actor=system）在时间线上可区分；
 *   3. 计划的**初始**受理没有 GoalRevisionRecorded，因此那条条目不带 change
 *      （含义是"这不是一次计划变更受理"，而不是"原因未知"）；
 *   4. 内存与 SQLite 两套投影对同一段事件给出逐字段相同的时间线（同一语义，不分叉）。
 *
 * 事件用 P1-11 的既有 ledger-commit builder 构造（与 tests/read-model/p1-11-plan-change.test.ts
 * 同一种喂法），因此断言的是真实投影对真实事件形状的处理，不是手写的中间对象。
 */
import { describe, expect, it } from 'vitest';
import { ReadModelIndexImpl } from '../../src/data/read-model-index/read-model-index.js';
import { createSqliteReadModelIndex } from '../../src/data/read-model-index/sqlite-read-model-index.js';
import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
import { makeCommitCursor, type EventPage, type PositionedEvent } from '../../src/contracts/ledger.js';
import { FIXED_ISO_2026_09_05 } from '../../src/testing/sequences.js';
import {
  P111_GOAL, P111_NEW_PLAN, P111_PROJECT, P111_SOURCE_PLAN, P111_WORKSPACE,
  buildApplyPlanChangeCommand, buildP111NewPlanDraft, buildPlanProposalV1,
  buildRecordPlanChangeProposalCommand, buildRecordUserDecisionCommand, buildUserDecisionV1,
  p111GoalRef, p111PlanRef,
} from '../contract-support/fixtures/goal-change-fixtures.js';
import { buildGoalChangeApplyCommit, buildPlanChangeProposalRecordCommit, buildUserDecisionRecordCommit } from '../../src/control/control-engine/records/goal-change.js';
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, buildApplyPlanCommand } from '../../src/fixtures/plan-fixtures.js';
import { planRevisionAcceptedEventFor, planRevisionSnapshotFor } from '../../src/control/control-engine/records/plan.js';
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildInstallCommand } from '../../src/fixtures/governance-fixtures.js';
import { architectureBaselinePinFor, completionPolicyPinFor } from '../../src/contracts/governance.js';
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from '../../src/contracts/governance.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ApplyPlanChangeCommand } from '../../src/contracts/goal-change.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { TimelineEntry } from '../../src/contracts/console-views.js';

const FIXED = FIXED_ISO_2026_09_05;

/** 受理方与变更原因：一个是人走既有决定路径，一个是 ControlEngine 的自动受理。 */
type Acceptance = { changeReason: string; actor: ActorRef };

const HUMAN_ACCEPTANCE: Acceptance = { changeReason: 'user-decision-accepted', actor: { kind: 'human', id: 'user-owner-1' } };
const SYSTEM_ACCEPTANCE: Acceptance = { changeReason: 'autonomous-rework:rework-proposal-rw09', actor: { kind: 'system', id: 'autonomous-rework' } };

/** 与 P1-11 相同的批次形状：初始计划受理 → 提案 → 决定 → 变更受理（3 事件原子批次）。 */
function buildPlanChangePage(acceptance: Acceptance, projectId: string = P111_PROJECT): EventPage {
  const planCmd = buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
    commandId: 'rw09-src-accept', correlationId: 'rw09-src-corr', submittedAt: FIXED, projectId, expectedRevision: 1, idempotencyKey: 'rw09-src-accept-idem',
  });
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, { commandId: 'rw09-cp-install', correlationId: 'rw09-cp-corr', submittedAt: FIXED, projectId, idempotencyKey: 'rw09-cp-idem' }) as InstallCompletionPolicyRevisionCommand;
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, { commandId: 'rw09-ab-install', correlationId: 'rw09-ab-corr', submittedAt: FIXED, projectId, idempotencyKey: 'rw09-ab-idem' }) as InstallArchitectureBaselineRevisionCommand;
  const pins = { completionPolicy: completionPolicyPinFor(cp), architectureBaseline: architectureBaselinePinFor(ab) };
  const sourceSnap = planRevisionSnapshotFor(planCmd, pins, FIXED);
  const sourceAccepted = planRevisionAcceptedEventFor(planCmd, { eventId: 'evt-rw09-src-accept', occurredAt: FIXED, workspaceId: P111_WORKSPACE, goalAggregateRevision: 2, planSnapshot: sourceSnap });

  const proposal = buildPlanProposalV1({ projectId, workspaceId: P111_WORKSPACE, sourceGoalRef: p111GoalRef(projectId), sourcePlanRef: p111PlanRef(P111_SOURCE_PLAN, projectId) });
  const propCommit = buildPlanChangeProposalRecordCommit(buildRecordPlanChangeProposalCommand(proposal, { commandId: 'rw09-cmd-proposal' }), { eventId: 'evt-rw09-proposal', occurredAt: FIXED });

  // 决定行与受理命令的 actor／authority／changeReason 都按被验证的那条路径给出：
  // 人的决定路径是 user-decision-accepted + human；自动受理路径是 delegated + system。
  const decision = buildUserDecisionV1({
    proposal,
    outcome: 'accept',
    actor: acceptance.actor,
    ...(acceptance.actor.kind === 'system'
      ? { authority: { strategy: 'delegated' as const, delegator: 'user-owner-1', policyVersion: 'coordination-policy-main@1' } }
      : {}),
  });
  const decCommit = buildUserDecisionRecordCommit(buildRecordUserDecisionCommand(decision, { commandId: 'rw09-cmd-decision' }), { eventId: 'evt-rw09-decision', occurredAt: FIXED });

  const newPlanDraft = buildP111NewPlanDraft(sourceSnap, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
  const baseCommand = buildApplyPlanChangeCommand(proposal, decision, newPlanDraft, { commandId: 'rw09-cmd-apply', expectedRevision: 1, actor: acceptance.actor });
  const applyCmd: ApplyPlanChangeCommand = { ...baseCommand, payload: { ...baseCommand.payload, changeReason: acceptance.changeReason } };
  const baseGoal: GoalSnapshot = {
    ref: p111GoalRef(projectId),
    workspaceRef: { aggregateType: 'Workspace', projectId, workspaceId: P111_WORKSPACE },
    objective: proposal.patch.patchDraft.objective,
    desiredState: 'active',
    activePlanRevision: null,
    revision: 1,
  };
  const applyCommit = buildGoalChangeApplyCommit(applyCmd, { eventId: 'evt-rw09-apply', occurredAt: FIXED, changedAt: FIXED, pins, sourcePlan: sourceSnap, newPlanDraft, baseGoal });

  const events: PositionedEvent[] = [
    { cursor: makeCommitCursor(1), event: sourceAccepted },
    { cursor: makeCommitCursor(2), event: propCommit.events[0]! },
    { cursor: makeCommitCursor(3), event: decCommit.events[0]! },
    { cursor: makeCommitCursor(4), event: applyCommit.events[0]! },
    { cursor: makeCommitCursor(5), event: applyCommit.events[1]! },
    { cursor: makeCommitCursor(6), event: applyCommit.events[2]! },
  ];
  return { afterCursor: null, throughCursor: makeCommitCursor(6), events, hasMore: false };
}

async function memoryTimeline(page: EventPage): Promise<TimelineEntry[]> {
  const readModel = new ReadModelIndexImpl(new ControlPolicyExplanation());
  await readModel.advance(page);
  const view = await readModel.consoleTimeline({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE });
  if (view.status !== 'ready') throw Error('时间线不可读：' + view.status);
  return view.timeline.entries;
}

async function sqliteTimeline(page: EventPage): Promise<TimelineEntry[]> {
  const readModel = createSqliteReadModelIndex({ path: ':memory:', policyExplanation: new ControlPolicyExplanation() });
  try {
    await readModel.advance(page);
    const view = await readModel.consoleTimeline({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE });
    if (view.status !== 'ready') throw Error('时间线不可读：' + view.status);
    return view.timeline.entries;
  } finally {
    await readModel.close();
  }
}

const planAccepted = (entries: TimelineEntry[]): TimelineEntry[] => entries.filter(entry => entry.kind === 'plan_accepted');

describe('RW-09 时间线：计划变更受理的 changeReason 与受理方可见', () => {
  it('人的决定受理：changeReason 逐字落账，actor 如实是人的决定；初始受理那条不带 change', async () => {
    const entries = await memoryTimeline(buildPlanChangePage(HUMAN_ACCEPTANCE));
    const accepted = planAccepted(entries);
    expect(accepted).toHaveLength(2);
    // 初始计划受理没有 GoalRevisionRecorded：它不能被说成"原因未知"，只能不带 change。
    expect(accepted[0]!.refs.planId).toBe(P111_SOURCE_PLAN);
    expect(accepted[0]!.change).toBeUndefined();
    expect(accepted[1]!.refs).toMatchObject({ goalId: P111_GOAL, planId: P111_NEW_PLAN });
    expect(accepted[1]!.change).toEqual({
      reason: 'user-decision-accepted',
      actor: { kind: 'human', id: 'user-owner-1' },
      goalRevision: 2,
      activePlanId: P111_NEW_PLAN,
      supersededPlanIds: [P111_SOURCE_PLAN],
    });
  });

  it('系统自动受理：同一条时间线能认出 autonomous-rework:<proposalId> 与 system actor', async () => {
    const entries = await memoryTimeline(buildPlanChangePage(SYSTEM_ACCEPTANCE));
    const accepted = planAccepted(entries);
    expect(accepted).toHaveLength(2);
    expect(accepted[1]!.change).toEqual({
      reason: 'autonomous-rework:rework-proposal-rw09',
      actor: { kind: 'system', id: 'autonomous-rework' },
      goalRevision: 2,
      activePlanId: P111_NEW_PLAN,
      supersededPlanIds: [P111_SOURCE_PLAN],
    });
  });

  it('内存与 SQLite 两套投影对同一段事件给出逐字段相同的时间线', async () => {
    for (const acceptance of [HUMAN_ACCEPTANCE, SYSTEM_ACCEPTANCE]) {
      const memory = await memoryTimeline(buildPlanChangePage(acceptance));
      const sqlite = await sqliteTimeline(buildPlanChangePage(acceptance));
      expect(sqlite).toEqual(memory);
    }
  });
});
