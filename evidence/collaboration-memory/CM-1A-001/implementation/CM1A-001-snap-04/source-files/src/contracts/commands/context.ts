/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { CommandIdentity } from "../command-event.js";
import type { RoleBindingRefV1, RunRef } from "../dispatch.js";
import type { PlanRevisionRef } from "../plan.js";
import type {
  BindWorkContextCommand,
  LinkWorkRunCommand,
  WorkContextBindingV1,
} from "../context-continuity.js";

/** 正式工作身份命令的唯一字段构造入口。Dispatch 提供身份、范围与时间；
 * 不从测试夹具取得默认值。测试包装可以显式补自己的默认值。 */

export type BuildBindWorkContextDeps = {
  commandId: string;
  projectId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
  correlationId: string;
  submittedAt: string;
  /** workId — 持久工作身份的聚合标识（由调用方按确定性规则算出，本函数不生成）。 */
  workId: string;
  workspaceId: string;
  workKind: WorkContextBindingV1["workKind"];
  goalId: string | null;
  taskId: string | null;
  planRef: PlanRevisionRef | null;
  planRevision: number | null;
  roleBindingRef: RoleBindingRefV1;
  initialRunRef: RunRef;
};

export function buildBindWorkContextCommand(deps: BuildBindWorkContextDeps): BindWorkContextCommand {
  return {
    commandId: deps.commandId,
    commandType: "BindWorkContext",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: deps.workId,
    /** 工作身份只创建一次：CAS@0 是契约的一部分，不是调用方的选择。 */
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      workspaceId: deps.workspaceId,
      workKind: deps.workKind,
      goalId: deps.goalId,
      taskId: deps.taskId,
      planRef: deps.planRef === null ? null : { ...deps.planRef },
      planRevision: deps.planRevision,
      roleBindingRef: { ...deps.roleBindingRef },
      initialRunRef: { ...deps.initialRunRef },
    },
  };
}

export type BuildLinkWorkRunDeps = {
  commandId: string;
  projectId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
  correlationId: string;
  submittedAt: string;
  /** workId — 既有的 WorkContextBinding 聚合。 */
  workId: string;
  workspaceId: string;
  runRef: RunRef;
  /** 调用方读到的当前 WorkContextBinding revision（单写者 CAS）。 */
  expectedRevision: number;
};

export function buildLinkWorkRunCommand(deps: BuildLinkWorkRunDeps): LinkWorkRunCommand {
  return {
    commandId: deps.commandId,
    commandType: "LinkWorkRun",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: deps.actor, idempotencyKey: deps.idempotencyKey },
    aggregateId: deps.workId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { workspaceId: deps.workspaceId, runRef: { ...deps.runRef } },
  };
}
