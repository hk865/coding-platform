import type { SessionRecord } from "../../core/ports/session_store/session-store-port.js";
import { type WorkspaceSandboxOptions } from "../../sandbox/workspace/workspace-sandbox.js";
import type { EffectiveRecoveryConstraints, RecoveryConstraintEvidence, RecoveryTarget } from "./recovery-contract-types.js";
export type { EffectiveRecoveryConstraints, RecoveryConstraintEvidence, RecoveryTarget, } from "./recovery-contract-types.js";
/**
 * 返回目标 Turn 的独占记录范围；不得把后续 Turn 的事件归入目标状态。
 *
 * 薄委托 Core 的单一选择算法 `selectRecoveryTurnRecords`（`RecoveryCoordinator.recover`
 * 使用同一函数），这里不复制第二套选择逻辑。`target=null` 保持旧 CLI 的最新 Turn 语义；
 * 精确目标必须同时匹配 runId 与 turnId。
 */
export declare function selectRecoveryTurn(records: readonly SessionRecord[], target: RecoveryTarget): readonly SessionRecord[];
/**
 * 在 runner.resume/continueRecovered 和任何恢复对账写入前核验原约束。
 *
 * 只接受 `recorded` 与 `supplied` 两份**有效**约束：`recorded` 缺省表示该 Turn 没有可证明
 * 的原预算 / 沙箱 / 授权证据（旧 schemaVersion=1 记录），继续执行必须抛
 * `StoreError('conflict', ...)`，terminal 重放与只读旧日志由调用路径单独处理。没有
 * `legacyDefaultProven` 之类的布尔捷径，也不靠 `baseConfigDigest` 猜测调用者当时未传选项。
 *
 * 允许等值恢复；允许只会收紧的差异（更小预算、更多 denied/protected、更少授权），返回
 * 实际应采用的 supplied；任何提高预算、去掉 denied prefix、减少只读 / 保护路径、改变
 * executable path、新增宿主授权或降低一致性模式都判为放宽并拒绝。
 */
export declare function requireEffectiveRecoveryConstraints(evidence: RecoveryConstraintEvidence): EffectiveRecoveryConstraints;
/**
 * 为 run/resume 解析相同的 workspace 忽略项：保留调用方选项；仅当 SQLite 位于
 * workspaceRoot 内时，追加该数据库文件及其 -wal/-shm/-journal 文件的相对路径。
 * 不忽略数据库的父目录或整个工作区；工作区外数据库不增加忽略项。
 *
 * 语义边界：这些路径只从 revision / 一致性快照中排除（内核自身持续写入的存储文件），
 * **不改变 read/write 权限**；同一目录下的普通文件仍参与 revision 核对。调用方显式传入的
 * `snapshotIgnoredPrefixes` 原样保留，不用默认值替换（缺省时才用 WorkspaceSandbox 的默认集合）。
 *
 * 组合根必须在创建 WorkspaceSandbox 之前调用；run/resume 两个入口共用同一解析结果，新
 * turn/checkpoint 持久化构造后实际生效的 ignore 值。
 */
export declare function resolveRecoveryWorkspaceOptions(workspaceRoot: string, databasePath: string, options?: WorkspaceSandboxOptions): WorkspaceSandboxOptions;
//# sourceMappingURL=recovery-contract.d.ts.map