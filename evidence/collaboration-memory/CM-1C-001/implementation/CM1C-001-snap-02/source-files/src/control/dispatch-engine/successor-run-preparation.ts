/**
 * 后继 Run 的准备入口（CM-1A-001 第 3 工作段，缺陷回交 SPEC-01 的正解）。
 *
 * ── 它解决什么 ────────────────────────────────────────────────────────────────
 * Control 在接续事务里创建了唯一后继 TaskAttempt/Run/outbox，但**没有任何生产者**为这个新
 * Run 登记真实 Runtime 的 RunSpec：LeasedWorkerRuntime 只从 `runtime.all()` 找已登记的
 * exact runId spec，找不到就抛"真实运行缺少已登记输入"。此前只有测试用
 * `await runtime.prepare(specFor(root, successorRunId))` 手工补线，因此"后继能跑"从未被生产
 * 路径证明。
 *
 * 本模块就是那个生产者：Dispatch 消费后继 outbox 时，从**持久事实**重建 RunSpec，
 * 经既有 RuntimePreparationPort 先 `preflight` 再 `prepare`（两步都可重放/幂等），
 * 然后才走既有的 `control.startRun` → `runtime.start`。
 *
 * ── RunSpec 从哪些持久事实重建（没有一条来自测试或进程内存）─────────────────────
 *   · 计划与指派版本、授权（roleBinding/declaredPermissions）、运行配置的 tokenBudget：
 *     后继 intent 本身（DispatchOutboxEntry 快照，与 TaskClaimed 同事务落账）；
 *   · **指令来源与完整运行配置**：前驱 Run 在 Runtime 里**已登记的持久 RunSpec**
 *     （RuntimeObservationJournal 磁盘记录，重启后 `init()` 会重新读回），
 *     并用 `instructionSource.digest` 钉住指令的精确摘要；
 *   · 这一段执行的参与关系/Work/授权版本/固定 Delivery 集合：该 Run 的接续受理记录
 *     （CommunicationAdmission，见 coordination-admission-read.ts）。
 *
 * 因此重启之后（SQLite close+reopen、Runtime 用同一目录重建）仍能重建出**逐字节相同**的
 * RunSpec —— 否则 CodingAgentRuntime.preflight 会以"同一运行请求的内容已改变"拒绝，
 * 而不是静默换一份输入继续跑。
 *
 * ── 已经运行/结果未知的 Run 不重新启动 ────────────────────────────────────────
 * 只有 Runtime 记录处于 `prepared`（尚未执行）时本模块才允许继续；其他状态
 * （running / completed / failed / cancelled / budget_exhausted / outcome_unknown）一律
 * `not_restartable`，由派发面报告成**可见失败**而不是再来一次。
 */
import type { StateLedger } from "../../contracts/ledger.js";
import type { DispatchIntentV1, RunRef } from "../../contracts/dispatch.js";
import type { RuntimePreparationPort, RunSpec, SuccessorRunPreparationV1 } from "../../contracts/runtime-preparation.js";
import { canonicalJson, sha256Hex } from "../../contracts/fingerprint.js";
import { readAdmittedSuccessor } from "./coordination-admission-read.js";

/** 指令摘要（与 RunSpec.instruction 逐字节对应）。 */
export function instructionDigestOf(instruction: string): string {
  return sha256Hex(instruction);
}

export type SuccessorPreparationDeps = {
  ledger: Pick<StateLedger, "load" | "events">;
  /** 既有 Runtime 准备/观察面（all / preflight / prepare）。 */
  runtime: RuntimePreparationPort;
  /** 宿主知道工作区根在哪；不知道就显式失败，绝不猜一个路径去准备运行。 */
  workspaceRootFor: (projectId: string, workspaceId: string) => string | null;
};

export type SuccessorPreparationResult =
  /** 这个 intent 不是接续产生的：本入口不介入（普通任务的既有准备路径不变）。 */
  | { status: "not_successor" }
  /** 已按持久事实准备完毕（`replayed` 表示这次没有产生新的准备，记录已经存在）。 */
  | { status: "prepared"; spec: RunSpec; preparation: SuccessorRunPreparationV1; replayed: boolean }
  /** 该 Run 已经跑过或结果未知：**不**重新准备、也**不**重新启动。 */
  | { status: "not_restartable"; runStatus: string; message: string }
  /** 无法诚实重建 RunSpec：零启动，由派发面报告成可见失败。 */
  | { status: "unavailable"; code: string; message: string };

/**
 * 为已受理的后继 intent 重建 RunSpec 并完成可重放的准备。
 *
 * 顺序固定：读受理记录 → 复核归属 → 取指令来源（前驱持久 RunSpec）→ 组装准备事实 →
 * `preflight` → `prepare` → 复查 Runtime 记录状态。任何一步不成立都在 **runtime.start 之前**
 * 结束，且不产生模型调用。
 */
export async function prepareAdmittedSuccessor(
  deps: SuccessorPreparationDeps,
  intent: DispatchIntentV1,
): Promise<SuccessorPreparationResult> {
  const read = await readAdmittedSuccessor(deps.ledger, {
    projectId: intent.projectId,
    workspaceId: intent.workspaceId,
    runId: intent.runRef.runId,
  });
  if (read.status === "absent") return { status: "not_successor" };
  if (read.status === "unavailable") return { status: "unavailable", code: "admission_unavailable", message: read.reason };
  const { admission } = read.facts;
  const value = admission.admission;
  if (value.runRef.runId !== intent.runRef.runId ||
      value.attemptRef.attemptId !== intent.attemptRef.attemptId ||
      value.runRef.projectId !== intent.projectId) {
    return { status: "unavailable", code: "admission_mismatch", message: "接续受理记录与本次 intent 的 Run/Attempt 不一致；不启动" };
  }
  if (intent.admittedWorkRef !== undefined &&
      (intent.admittedWorkRef.workId !== value.workContextRef.workId ||
       intent.admittedWorkRef.workspaceId !== value.workContextRef.workspaceId)) {
    return { status: "unavailable", code: "admission_mismatch", message: "intent 固定的 Work 与受理记录不一致；不启动" };
  }
  if (JSON.stringify(value.roleBinding) !== JSON.stringify(intent.roleBinding)) {
    return { status: "unavailable", code: "authorization_mismatch", message: "受理固定的授权版本与 intent 的 RoleBinding 不一致；不启动" };
  }
  // 协议约束 1.2「Dispatch 与 Context 消费**同一份绑定**、不得重新猜测」：权限集也要与受理固定的
  // 那一份核对（Control 在同一次提交里把**收窄后**的权限集同时写进 admission 与唯一调度记录，
  // 本来就是同一个值；这里读 intent 的副本时必须能对上）。不一致 → fail-closed，不启动。
  if (!samePermissionSet(value.declaredPermissions, intent.declaredPermissions)) {
    return { status: "unavailable", code: "authorization_mismatch", message: "受理固定的权限集与 intent 的 declaredPermissions 不一致；不启动" };
  }
  const root = deps.workspaceRootFor(intent.projectId, intent.workspaceId);
  if (root === null || root.length === 0) {
    return { status: "unavailable", code: "workspace_root_unknown", message: "宿主没有登记该工作区的根目录，无法准备后继运行" };
  }
  // 指令来源：前驱 Run 在 Runtime 里**已登记**的持久 RunSpec（重启后由 journal 重新读回）。
  const predecessor = predecessorSpecOf(deps.runtime, value.predecessorRunRef, intent);
  if (predecessor === null) {
    return {
      status: "unavailable", code: "instruction_source_missing",
      message: "前驱 Run 的持久 RunSpec 读不到（runId=" + value.predecessorRunRef.runId + "）：后继 RunSpec 无法诚实重建，不用猜出来的输入启动",
    };
  }
  if (predecessor.mode !== undefined) {
    return { status: "unavailable", code: "mode_mismatch", message: "前驱 RunSpec 是 " + predecessor.mode + " 模式，不能作为普通后继 Run 的准备来源" };
  }
  const runtimeBudget = { ...predecessor.budget, contextWindowTokens: intent.budget.tokenBudget };
  const preparation: SuccessorRunPreparationV1 = {
    schemaVersion: 1,
    // 摘要覆盖除自身以外的**全部**准备内容（版本化来源 + 运行配置）：同一 exact RunRef 上
    // 内容有没有变，用它一比就知道（协议约束 1.3 的重放判据）。
    preparationDigest: preparationDigestOf({
      schemaVersion: 1,
      preparationDigest: "",
      planRef: intent.planRef,
      instructionSource: {
        kind: "predecessor_run_spec",
        runRef: value.predecessorRunRef,
        digest: instructionDigestOf(predecessor.instruction),
      },
      roleBinding: value.roleBinding,
      declaredPermissions: intent.declaredPermissions,
      runtimeBudget,
    }),
    planRef: { ...intent.planRef },
    instructionSource: {
      kind: "predecessor_run_spec",
      runRef: { ...value.predecessorRunRef },
      digest: instructionDigestOf(predecessor.instruction),
    },
    roleBinding: { ...value.roleBinding },
    declaredPermissions: { tools: [...intent.declaredPermissions.tools], writeScope: [...intent.declaredPermissions.writeScope] },
    runtimeBudget,
  };
  const spec: RunSpec = {
    projectId: intent.projectId,
    workspaceId: intent.workspaceId,
    goalId: intent.goalId,
    runId: intent.runRef.runId,
    taskId: intent.taskId,
    // Workspace 路径由**受信宿主**解析（协议约束 1.3）：它不是模型给的，也不是快照里的自由文本。
    root,
    instruction: predecessor.instruction,
    budget: runtimeBudget,
  };
  const existing = findRecord(deps.runtime, spec);
  if (existing !== undefined) {
    // ── 重放判据：exact RunRef + 准备内容（协议约束 1.3）────────────────────────────
    // 内容逐字节相同 → 同一次准备：**不写**（不重复 prepare，也不重新登记），直接算已准备。
    // 内容不同 → 同一个 Run 的准备内容发生了变化：**拒绝**，绝不覆盖既有登记。
    if (canonicalJson(existing.spec as never) !== canonicalJson(spec as never)) {
      return {
        status: "unavailable", code: "preparation_content_mismatch",
        message: "同一 Run（runId=" + spec.runId + "）上已经登记的准备内容与这次重建的不一致（preparationDigest=" +
          preparation.preparationDigest + "）：拒绝覆盖，不启动",
      };
    }
    if (existing.status !== "prepared") {
      return {
        status: "not_restartable", runStatus: existing.status,
        message: "后继 Run 已经运行或结果未知（status=" + existing.status + "）：不重新准备、也不重新启动",
      };
    }
    return { status: "prepared", spec, preparation, replayed: true };
  }
  try {
    // 首次准备：先 preflight 再 prepare。两步都可重放；Runtime 自己也会拒绝"同一 Run 换了内容"，
    // 这里是同一条规则的第一道闸门（上面的内容比较）之后的第二道。
    await deps.runtime.preflight(spec);
    await deps.runtime.prepare(spec);
  } catch (error) {
    return { status: "unavailable", code: "prepare_rejected", message: error instanceof Error ? error.message : String(error) };
  }
  const record = findRecord(deps.runtime, spec);
  if (record === undefined) {
    return { status: "unavailable", code: "prepare_not_visible", message: "Runtime 没有登记这次准备（prepare 未生效）；不启动" };
  }
  if (record.status !== "prepared") {
    return {
      status: "not_restartable", runStatus: record.status,
      message: "后继 Run 已经运行或结果未知（status=" + record.status + "）：不重新准备、也不重新启动",
    };
  }
  return { status: "prepared", spec, preparation, replayed: false };
}

/** 准备内容摘要（协议约束 1.3）：结构去掉 `preparationDigest` 自身后的 canonical JSON 的 sha256。 */
export function preparationDigestOf(preparation: SuccessorRunPreparationV1): string {
  const { preparationDigest: _ignored, ...content } = preparation;
  void _ignored;
  return sha256Hex(canonicalJson(content as never));
}

/** 该 exact RunRef（project + workspace + runId）在 Runtime 里已登记的准备记录。 */
function findRecord(runtime: RuntimePreparationPort, spec: RunSpec) {
  return runtime.all().find((row) =>
    row.spec.projectId === spec.projectId && row.spec.workspaceId === spec.workspaceId && row.spec.runId === spec.runId);
}

/**
 * 权限集是否**同一份**（协议约束 1.2）。
 *
 * 逐项按值比较（tools / writeScope 各自比较集合成员；顺序不参与语义——"权限集"是集合而不是序列），
 * 任何一项不同都算不一致；调用方据此 fail-closed（不启动），绝不"用 intent 的副本替换受理值"。
 */
function samePermissionSet(
  left: { tools: string[]; writeScope: string[] },
  right: { tools: string[]; writeScope: string[] },
): boolean {
  if (left === undefined || right === undefined) return false;
  const canonical = (values: string[]): string => canonicalJson([...values].sort() as never);
  return canonical(left.tools) === canonical(right.tools) && canonical(left.writeScope) === canonical(right.writeScope);
}

/** 前驱 Run 的持久 RunSpec（同 project/workspace；跨工作区同名 runId 不算命中）。 */
function predecessorSpecOf(runtime: RuntimePreparationPort, runRef: RunRef, intent: DispatchIntentV1): RunSpec | null {
  const found = runtime.all().find((row) =>
    row.spec.projectId === intent.projectId && row.spec.workspaceId === intent.workspaceId && row.spec.runId === runRef.runId);
  return found === undefined ? null : found.spec;
}
