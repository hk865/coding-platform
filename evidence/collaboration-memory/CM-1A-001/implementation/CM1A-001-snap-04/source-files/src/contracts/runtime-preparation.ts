import type { RuntimeBudget } from './runtime-budget.js';
import type { RoleBindingRefV1, RunRef, RuntimeEventV1 } from './dispatch.js';
import type { PlanRevisionRef } from './plan.js';
import type { ReviewWorkRef } from './reviewer-work.js';
import type { ReviewerProfileV1 } from './reviewer-context.js';

export type RunSpec = {
  mode?: 'explore' | 'review';
  review?: { workRef: ReviewWorkRef; profile: ReviewerProfileV1 };
  projectId: string;
  workspaceId: string;
  goalId: string;
  runId: string;
  taskId: string;
  root: string;
  instruction: string;
  budget: RuntimeBudget;
};

export type PreparedRunStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'cancelled' | 'budget_exhausted' | 'outcome_unknown';
export type PreparedRunFact = { spec: RunSpec; status: PreparedRunStatus; events: RuntimeEventV1[] };

/**
 * 后继 Run 的 RunSpec **可重建来源**（CM-1A-001 第 3 工作段）。
 *
 * 为什么必须落成持久事实：唯一后继 Run 由 Control 在接续事务里创建，它的 RunSpec
 * （指令、授权、运行配置、计划/指派版本）**不允许**只存在于测试代码或进程内存里。
 * Dispatch 消费后继 outbox 时要从 canonical 事实上重建出**逐字节相同**的 RunSpec，
 * 才能先 preflight/prepare 再启动；重启之后同样要能重建（否则 Runtime 的 preflight
 * 会以"同一运行请求的内容已改变"拒绝，而不是静默换一份输入继续跑）。
 *
 * 它不是权限，也不是完成证据：
 *   - `roleBinding` / `declaredPermissions` 是**沿用**前一段执行已经落账的那一份，
 *     本结构不新增授权、不放宽范围；
 *   - `runtimeBudget` 是这一段执行沿用的运行容量，不是累计用量、也不是上一次的剩余；
 *   - 指令只存**来源位置与摘要**（前驱 Run 已登记的持久 RunSpec），不复制正文，
 *     也不把 host 路径或正文塞进账本。
 */
export type SuccessorRunPreparationV1 = {
  schemaVersion: 1;
  /**
   * **准备内容摘要**（协议约束 1.3）：本结构去掉本字段后的 canonical JSON 的 sha256。
   *
   * 它让"重放"有可核对的判据：同一 exact RunRef 上，摘要相同 → 同一次准备（不重复写）；
   * 摘要不同 → **同一 Run 的内容发生了变化，必须拒绝**，绝不覆盖已经登记的准备。
   */
  preparationDigest: string;
  /** 计划与指派版本：后继 Run 沿用的 PlanRevision。 */
  planRef: PlanRevisionRef;
  /**
   * 指令来源：这一段工作的指令取自哪一条**持久** RunSpec（前驱 Run 的登记规格），
   * 以及该指令的精确摘要。重建时逐字节取回同一份指令，摘要不符即拒绝准备。
   */
  instructionSource: {
    kind: 'predecessor_run_spec';
    runRef: RunRef;
    digest: string;
  };
  /** 授权：沿用前驱 Run 的 RoleBinding 版本与声明权限（不放宽）。 */
  roleBinding: RoleBindingRefV1;
  declaredPermissions: { tools: string[]; writeScope: string[] };
  /** 运行配置：这一段执行沿用的运行容量。 */
  runtimeBudget: RuntimeBudget;
};

/** WorkerRuntime's public preparation and observation surface. These are adapter
 * facts; only Control can accept them as canonical Task/Run state. */
export interface RuntimePreparationPort {
  all(): PreparedRunFact[];
  preflight(spec: RunSpec): Promise<void>;
  prepare(spec: RunSpec): Promise<void>;
}

export interface RuntimeReconciliationPort {
  /** Apply an already persisted desired cancellation; never starts external work. */
  cancel?(ref: RunRef): Promise<unknown>;
  all(): PreparedRunFact[];
  markUnknown(ref: RunRef): Promise<void>;
}
