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

/**
 * RW-14（M3）：产品自带的人工派发入口绑定的**已登记角色**。
 *
 * 为什么必须换掉原来的 `template-short-lived-runner`：那个 templateId 从来不在任何角色矩阵的
 * catalog 里，templateRevision（'2026-09-05'）也不是角色规格 revision 的十进制写法。于是
 * **只要**项目装上一份含 roles 的协调策略，这条入口的每条 claim 都必然被拒（role_not_registered／
 * role_spec_stale），返回 `ineligible` 且零写入——一个人装上角色矩阵就会把人工真实运行与探索
 * 入口一起打断。这不是守卫的问题（守卫按 D4-2 正确执行），而是这条入口的工作身份没有落在
 * 角色目录里。
 *
 * 为什么选「升级为已登记角色」而不是「新登记一份等价的短生命周期规格」：
 *   - 角色矩阵是**项目授权的角色目录**，人工派发入口做的是真实工作，它的身份本来就该是目录里的
 *     一个角色，而不是目录必须额外知道的一个派发实现细节；
 *   - operator 入口有两种模式，声明权限完全不同（写入运行 read/write/shell + 写范围；探索运行
 *     read-only）。合成一份短生命周期规格就必须把权限上界放宽到「可写」，只读探索运行的规格上界
 *     会因此变成比它实际需要更宽的一份授权；分开绑定之后，只读入口的上界就是只读。
 *
 * 语义没有改变的部分：仍是一次性的、绑定到单个 Task/Run 的运行；没有新增常驻角色、没有新增
 * 授权来源。绑定只是从「自由字符串」升级为「可被矩阵 pin 校验的、版本化的角色规格引用」。
 *
 * 下面的常量与本文件导出的 operatorEntryBinding 现在表达的是**入口的角色意图**，以及
 * **没有矩阵时的既有绑定**（fallback）。真正提交给 claim 的绑定由当前生效矩阵签发
 * （见 role-spec-read.ts 的 issueMatrixRoleBinding，dispatch() 里调用）：矩阵登记了这个角色时，
 * templateId 与 templateRevision 直接取自矩阵 pin；没有矩阵（或矩阵没登记该角色）时逐字使用
 * 下面这份既有绑定 —— 既不编造角色目录，也不放松 claim 守卫。
 */
export const OPERATOR_ENTRY_ROLES = { develop: 'executor', explore: 'investigator' } as const;

/**
 * 入口的角色意图（roleId）与**没有矩阵时的既有绑定**（唯一出处：派发与就绪预检都读它，
 * 不在两处各写一份）。
 *
 * templateRevision 写成角色规格 revision 的十进制形式：这是 role-spec.ts 的既有编码约定
 * （claim 声明的 revision 必须正好等于矩阵 pin 的 revision）。templateId 一定是矩阵可见的角色 id，
 * 因此这份绑定在「有矩阵」与「没有矩阵」两种项目上都能被受理——没有矩阵时守卫沿用既有语义，
 * 有矩阵时它退化为 fallback，真正提交的绑定由矩阵 pin 签发（RW-18，见角色规格只读解析里的
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
    control: Pick<ControlEngine, 'claimTask'>;
    runtime: RuntimePreparationPort & { cancel(ref: RunRef): Promise<{ status: string }> };
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
    return this.deps.runtime.cancel(ref);
  }

  private ref(scope: ExplorationScope, runId: string): RunRef {
    return { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId };
  }
  private async assertScope(scope: ExplorationScope) {
    const loaded = await this.deps.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
    if (loaded.status !== 'found' || (loaded.snapshot as GoalSnapshot).workspaceRef.workspaceId !== scope.workspaceId) throw Error('目标不属于当前工作区');
  }
}
