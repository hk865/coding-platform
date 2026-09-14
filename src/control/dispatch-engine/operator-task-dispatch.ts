import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { randomUUID } from 'node:crypto';
import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { OperatorPlanningPort } from '../../contracts/operator-planning.js';
import type { OperatorDispatchPort } from '../../contracts/operator-dispatch.js';
import type { RuntimePreparationPort, RunSpec } from '../../contracts/runtime-preparation.js';
import type { ExplorationScope } from '../../contracts/exploration.js';
import { buildDispatchClaimCommand } from '../../contracts/commands/dispatch.js';
import { ROLE_SPEC_REVISION } from '../../contracts/role-spec.js';
import { issueMatrixRoleBinding } from './role-spec-read.js';

/** Production operator entries use registered roles. Ordinary execution and
 * readonly exploration retain separate permission ceilings and matrix bindings. */
export const OPERATOR_ENTRY_ROLES = { develop: 'executor', explore: 'investigator' } as const;

/**
 * 入口的角色意图（roleId）与**没有矩阵时的既有绑定**（唯一出处：派发与就绪预检都读它，
 * 不在两处各写一份）。
 *
 * templateRevision 写成角色规格 revision 的十进制形式：这是 role-spec.ts 的既有编码约定
 * （claim 声明的 revision 必须正好等于矩阵 pin 的 revision）。templateId 一定是矩阵可见的角色 id，
 * 因此这份绑定在「有矩阵」与「没有矩阵」两种项目上都能被受理——没有矩阵时守卫沿用既有语义，
 * 有矩阵时它退化为 fallback，真正提交的绑定由矩阵 pin 签发（见角色规格只读解析里的
 * issueMatrixRoleBinding）。
 */
export function operatorEntryBinding(mode: RunSpec['mode']): {
  roleBinding: RoleBindingRefV1;
  declaredPermissions: { tools: string[]; writeScope: string[] };
} {
  // review 规格由 ReviewerDispatch 自己派发，不会经过本入口；因此这里只有 explore 与写入两种。
  const readonly = mode === 'explore';
  const roleId = readonly ? OPERATOR_ENTRY_ROLES.explore : OPERATOR_ENTRY_ROLES.develop;
  return {
    roleBinding: {
      schemaVersion: 1,
      bindingId: 'binding-operator-' + roleId + '-v1',
      templateId: roleId,
      templateRevision: String(ROLE_SPEC_REVISION),
      bindingVersion: 1,
      policyRevision: 'auth-policy-runtime-v1',
    },
    declaredPermissions: readonly
      ? { tools: ['read'], writeScope: [] }
      : { tools: ['read', 'write', 'shell'], writeScope: ['*'] },
  };
}

/** Coordinates human-authorized preparation with canonical admission. Preparation
 * stores immutable runtime input; only the durable Control outbox starts work. */
export class OperatorTaskDispatch implements OperatorDispatchPort {
  constructor(private readonly deps: {
    ledger: Pick<StateLedger, 'load'>;
    control: Pick<ControlEngine, 'claimTask' | 'submitControl' | 'runFact'>;
    runtime: RuntimePreparationPort & { cancel?(ref: RunRef): Promise<{ status: string; events?: import('../../contracts/dispatch.js').RuntimeEventV1[] }> };
    planning: Pick<OperatorPlanningPort, 'ensureTaskPlan'>;
    launch(scope: ExplorationScope, runId: string): void;
    now(): string;
  }) {}

  async dispatch({ spec, requestId }: { spec: RunSpec; requestId: string }) {
    await this.assertScope(spec);
    await this.deps.runtime.prepare(spec);
    if (spec.mode !== 'explore') await this.deps.planning.ensureTaskPlan(spec, spec.instruction);
    const existing = await this.deps.ledger.load(this.ref(spec, spec.runId));
    if (existing.status === 'found') return {
      runId: spec.runId, status: (existing.snapshot as RunSnapshot).status,
      ...(spec.mode === 'explore' ? { executor: 'coding-agent' as const } : {}),
    };
    const entry = operatorEntryBinding(spec.mode);
    // 绑定由**当前生效矩阵的 pin**签发（templateId／templateRevision／签发依据都来自矩阵）；
    // 没有矩阵（或矩阵未登记该角色）时逐字沿用 operatorEntryBinding 的既有绑定，仍交由未改动的
    // claim 守卫判定（role_not_registered／role_spec_stale → 拒绝且零写）。
    const issued = await issueMatrixRoleBinding({ ledger: this.deps.ledger }, {
      projectId: spec.projectId, roleId: entry.roleBinding.templateId, fallback: entry.roleBinding,
    });
    const receipt = await this.deps.control.claimTask(buildDispatchClaimCommand({
      projectId: spec.projectId, goalId: spec.goalId, taskId: spec.taskId, runId: spec.runId,
      attemptId: 'attempt-' + requestId, commandId: randomUUID(), correlationId: randomUUID(),
      idempotencyKey: spec.runId, actor: { kind: 'human', id: 'user-1' }, submittedAt: this.deps.now(),
      // 绑定的是已登记角色（见上方 operatorEntryBinding 的说明），因此项目装了含 roles 的
      // 协调策略之后这条入口仍然能被受理，而不是必然被拒。
      roleBinding: issued.roleBinding,
      declaredPermissions: entry.declaredPermissions,
      budget: { tokenBudget: spec.budget.contextWindowTokens, deadline: spec.budget.timeoutMs === null ? null : new Date(Date.parse(this.deps.now()) + spec.budget.timeoutMs).toISOString() },
    }));
    if (receipt.status === 'rejected') throw Error(JSON.stringify(receipt));
    this.deps.launch(spec, spec.runId);
    return { runId: spec.runId, status: 'accepted', executor: 'coding-agent' as const };
  }

  async cancel(scope: ExplorationScope, runId: string) {
    await this.assertScope(scope);
    const ref = this.ref(scope, runId), found = await this.deps.ledger.load(ref);
    if (found.status !== 'found') throw Error('当前目标不存在此运行');
    const id = 'cancel-' + sha256Hex(canonicalJson(ref)).slice(0, 32);
    const at = this.deps.now();
    if ((found.snapshot as RunSnapshot).controlState?.desiredState !== 'cancelled') {
    const result = await this.deps.control.submitControl({ commandId: id, commandType: 'SubmitControl', schemaVersion: 1,
      identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'user-1' }, idempotencyKey: id },
      aggregateId: id, expectedRevision: 0, correlationId: id, submittedAt: at,
      payload: { intent: { schemaVersion: 1, intentId: id, projectId: scope.projectId, workspaceId: scope.workspaceId,
        kind: 'cancel', scope: { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId, taskId: (found.snapshot as RunSnapshot).task.taskId, runRef: ref },
        desiredState: 'cancelled', status: 'queued', reason: 'Operator requested cancellation', steer: null,
        acks: [], resumeFromIntentRef: null, submittedAt: at, updatedAt: at } } });
    if (result.status !== 'committed') throw Error('Cancellation was not recorded: ' + result.code);
    }
    if (!this.deps.runtime.cancel) return { status: 'unsupported', message: '取消意图已持久记录；此 Runtime 未提供取消能力，执行结果尚未确认。' };
    const cancelled = await this.deps.runtime.cancel(ref);
    for (const event of cancelled.events ?? []) {
      const current = await this.deps.ledger.load(ref);
      if (current.status !== 'found' || (current.snapshot as RunSnapshot).status === 'ended') break;
      const recorded = await this.deps.control.runFact({ commandId: 'cancel-fact-' + event.eventId, commandType: 'RunFact', schemaVersion: 1,
        identity: { projectId: scope.projectId, actor: { kind: 'system', id: 'dispatch' }, idempotencyKey: 'cancel-fact-' + event.eventId },
        aggregateId: runId, expectedRevision: current.snapshot.revision, correlationId: id, submittedAt: event.occurredAt,
        payload: { fact: { kind: 'runtime_event', event } } });
      if (recorded.status !== 'committed') throw Error('Cancellation occurred but its receipt needs reconciliation: ' + recorded.code);
    }
    return cancelled;
  }

  private ref(scope: ExplorationScope, runId: string): RunRef {
    return { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId };
  }
  private async assertScope(scope: ExplorationScope) {
    const loaded = await this.deps.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
    if (loaded.status !== 'found' || (loaded.snapshot as GoalSnapshot).workspaceRef.workspaceId !== scope.workspaceId) throw Error('目标不属于当前工作区');
  }
}
