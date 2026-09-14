/**
 * **协调能力的执行前准入**（协作通信协议约束 2.3）。
 *
 * ── 它在回答什么 ──────────────────────────────────────────────────────────────
 * "这个 Run 被授予协调能力了吗？依据是账本里的哪条事实？"
 *
 * 协调能力是**独立的一档**：它不等于 workspace 读、也不等于文件写入或 shell 权限。
 * 发消息/登记等待会修改平台状态，因此宿主必须在**执行之前**显式判定并授予；未授予时
 * 既不装配工具、也不向内核声明该能力（fail-closed），工具调用会在内核侧被拒绝并给出可读原因。
 *
 * ── 授予不是什么 ──────────────────────────────────────────────────────────────
 *   · **不是**本模块自己签发的授权：授予的依据是账本里**已经存在**的 canonical 事实
 *     （该 Run 发起的参与关系 / 该 Run 的接续受理记录），本模块只读不写；
 *   · **不是** module 内新造的第二份权限来源：参与关系上的 RoleBinding 仍由 Control 在受理时
 *     固定，Run 权限仍只来自 TaskEnvelope.permissions；
 *   · **不是**用 effectClass 冒充：工具的 effectClass 只声明"非只读、有确定性副作用"
 *     （内核词表没有"平台状态写入"这一档，平台用工具定义上的 `platformEffect` 如实标注），
 *     放行与否由这里的授予 + 内核的宿主授权名单共同决定。
 *
 * 旧记录/异常一律 fail-closed：读不完整、参与关系不是 active、同一个 Run 对应多段参与关系，
 * 都返回 `not_granted` 并带可读原因，绝不"补一个身份"继续启动。
 *
 * ── 拒绝发生在哪一层（三层，各自独立可核对；见 tests/coordination/coordination-capability.test.ts）
 *   层 1 装配层：本模块判定 not_granted → 运行入口**不注入**协调工具（模型请求里没有它们）。
 *   层 2 Adapter 调用期：`coordination-tool-access.ts` 的 `capabilityDenial` 在每个写操作
 *        动 Vault/Control 之前**再校验一次**授予是否仍然成立（授予失效 → 拒绝、零写入）。
 *   层 3 内核策略层：即使工具被注入并启用，没进宿主的 `hostAuthorizedTools` 也会被内核按
 *        "未授权的未知操作"拒绝（`permission_denied`，handler 不执行）。
 */
import type { StateLedger } from "../../contracts/ledger.js";
import type { RunRef } from "../../contracts/dispatch.js";
import {
  COORDINATION_CAPABILITY_ID,
  type CoordinationCapabilityDecisionV1,
} from "../../contracts/coordination-tools.js";
import { CoordinationToolAccess, resolveRunPrincipal, type CoordinationAccessDeps } from "./coordination-tool-access.js";
import type { CoordinationRuntimeGrantV1 } from "../../contracts/coordination-tools.js";

export type CoordinationCapabilityDeps = { ledger: Pick<StateLedger, "load" | "events"> };

/**
 * 宿主侧的唯一入口：判定 + 装配。返回 `granted` 时同时给出访问面，`not_granted` 时给出原因；
 * 调用方（运行入口）据此决定是否注入工具，**不存在**"只注入工具、不带授予"的路径。
 */
export async function coordinationRuntimeGrant(
  deps: CoordinationAccessDeps,
  runRef: RunRef,
): Promise<CoordinationRuntimeGrantV1> {
  const decision = await resolveCoordinationCapability({ ledger: deps.ledger }, runRef);
  if (decision.status === "not_granted") return decision;
  const resolution = await resolveRunPrincipal({ ledger: deps.ledger }, runRef);
  if (resolution.status !== "resolved") {
    return { status: "not_granted", capability: COORDINATION_CAPABILITY_ID, reason: "授予与身份解析不一致；不装配协调工具" };
  }
  return {
    status: "granted",
    capability: COORDINATION_CAPABILITY_ID,
    grant: decision.grant,
    // 访问面与授予一起给出：每个写操作还会在动 Vault/Control 之前按这份授予再校验一次。
    access: new CoordinationToolAccess(deps, resolution.principal, decision.grant),
  };
}

/**
 * 解析该 Run 的协调能力判定。
 *
 * 判定完全由 canonical 事实决定（因此重启后同样成立、也不需要第二份持久状态）：
 * 恰好一段 active 参与关系 → `granted`（并给出依据），否则 `not_granted` + 可读原因。
 */
export async function resolveCoordinationCapability(
  deps: CoordinationCapabilityDeps,
  runRef: RunRef,
): Promise<CoordinationCapabilityDecisionV1> {
  const resolution = await resolveRunPrincipal(deps, runRef);
  if (resolution.status !== "resolved") {
    return {
      status: "not_granted",
      capability: COORDINATION_CAPABILITY_ID,
      reason: "该 Run 未被授予协调能力：" + resolution.reason + "（未授予时不装配协调工具，也不向内核声明该能力）",
    };
  }
  const { principal, basis } = resolution;
  return {
    status: "granted",
    capability: COORDINATION_CAPABILITY_ID,
    grant: {
      schemaVersion: 1,
      capability: COORDINATION_CAPABILITY_ID,
      runRef: { ...runRef },
      workContextRef: { ...principal.workContextRef },
      participationRef: { ...principal.participationRef },
      agentInstanceId: principal.agentInstanceId,
      roleBinding: { ...principal.roleBinding },
      basis,
    },
  };
}
