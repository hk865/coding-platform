/** R4a 内部恢复接线：精确 Turn 选择、恢复前有效约束核对与工作区忽略项解析。 */
import path from "node:path";

import type { RunLimits } from "../../core/runtime/limits/limit-guard.js";
import type { SessionRecord } from "../../core/ports/session_store/session-store-port.js";
import {
  parseEffectiveRecoveryConstraints,
  StoreError,
} from "../../core/ports/session_store/session-store-port.js";
import type { EffectiveRecoveryConstraintsRecord } from "../../core/ports/session_store/session-store-port.js";
import { selectRecoveryTurnRecords } from "../../core/runtime/recovery/recovery-coordinator.js";
import {
  DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PREFIXES,
  type WorkspaceSandboxOptions,
} from "../../sandbox/workspace/workspace-sandbox.js";
import type {
  EffectiveRecoveryConstraints,
  RecoveryConstraintEvidence,
  RecoveryTarget,
} from "./recovery-contract-types.js";

export type {
  EffectiveRecoveryConstraints,
  RecoveryConstraintEvidence,
  RecoveryTarget,
} from "./recovery-contract-types.js";

/**
 * 返回目标 Turn 的独占记录范围；不得把后续 Turn 的事件归入目标状态。
 *
 * 薄委托 Core 的单一选择算法 `selectRecoveryTurnRecords`（`RecoveryCoordinator.recover`
 * 使用同一函数），这里不复制第二套选择逻辑。`target=null` 保持旧 CLI 的最新 Turn 语义；
 * 精确目标必须同时匹配 runId 与 turnId。
 */
export function selectRecoveryTurn(
  records: readonly SessionRecord[],
  target: RecoveryTarget,
): readonly SessionRecord[] {
  return selectRecoveryTurnRecords(records, target);
}

const LIMIT_KEYS = [
  "maxModelRequests",
  "maxToolCalls",
  "maxInputTokens",
  "maxOutputTokens",
  "maxTotalTokens",
  "maxCostUsdMicros",
  "deadlineMs",
] as const satisfies readonly (keyof RunLimits)[];

/** `session` 只核对 Session 已知改动；`workspace`/`strict` 额外核对整个工作区。 */
const CONSISTENCY_RANK = { session: 0, workspace: 1, strict: 2 } as const;

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
export function requireEffectiveRecoveryConstraints(
  evidence: RecoveryConstraintEvidence,
): EffectiveRecoveryConstraints {
  const recordedInput: unknown = evidence.recorded;
  if (recordedInput === null || recordedInput === undefined) {
    throw new StoreError(
      "conflict",
      "缺少原执行的有效约束记录；无法证明原预算与沙箱限制时拒绝继续执行",
    );
  }
  const recorded = parseEffectiveRecoveryConstraints(recordedInput);
  const supplied = parseEffectiveRecoveryConstraints(evidence.supplied);
  assertNotWidened(supplied, recorded);
  return supplied;
}

function widened(detail: string): StoreError {
  return new StoreError("conflict", `恢复约束不得放宽：${detail}`);
}

function assertNotWidened(
  supplied: EffectiveRecoveryConstraintsRecord,
  recorded: EffectiveRecoveryConstraintsRecord,
): void {
  for (const key of LIMIT_KEYS) {
    const previous = recorded.limits[key];
    if (previous === null) continue;
    const next = supplied.limits[key];
    if (next === null) throw widened(`丢失原上限 ${key}`);
    if (next > previous)
      throw widened(`提高原上限 ${key}（${String(previous)} → ${String(next)}）`);
  }
  // denied / protected / read-only 集合：原值必须全部保留；ignored / hostAuthorizedTools
  // 集合：supplied 不得出现原记录之外的新值。
  assertKeeps(
    recorded.workspace.deniedPrefixes,
    supplied.workspace.deniedPrefixes,
    "丢失原 denied prefix",
  );
  assertAddsNothing(
    recorded.workspace.snapshotIgnoredPrefixes,
    supplied.workspace.snapshotIgnoredPrefixes,
    "扩大 snapshot ignored prefix",
  );
  if (
    CONSISTENCY_RANK[supplied.workspace.consistencyMode] <
    CONSISTENCY_RANK[recorded.workspace.consistencyMode]
  ) {
    throw widened(
      `降低 workspace consistency mode（${recorded.workspace.consistencyMode} → ${supplied.workspace.consistencyMode}）`,
    );
  }
  if (supplied.workspace.maxFileBytes > recorded.workspace.maxFileBytes) {
    throw widened("提高 maxFileBytes");
  }
  assertKeeps(
    recorded.process.protectedPaths,
    supplied.process.protectedPaths,
    "丢失原 protected path",
  );
  assertKeeps(
    recorded.process.readOnlyPaths,
    supplied.process.readOnlyPaths,
    "丢失原 read-only path",
  );
  if (supplied.process.executablePath !== recorded.process.executablePath) {
    throw widened("改变 executable path");
  }
  assertAddsNothing(recorded.hostAuthorizedTools, supplied.hostAuthorizedTools, "新增宿主工具授权");
}

/** 原集合必须被完整保留（可用于 denied / protected / read-only 这类「越多越紧」的字段）。 */
function assertKeeps(
  recorded: readonly string[],
  supplied: readonly string[],
  detail: string,
): void {
  const kept = new Set(supplied);
  for (const value of recorded) {
    if (!kept.has(value)) throw widened(`${detail} ${value}`);
  }
}

/** supplied 不得引入原集合之外的值（可用于 ignored / hostAuthorizedTools 这类「越少越紧」的字段）。 */
function assertAddsNothing(
  recorded: readonly string[],
  supplied: readonly string[],
  detail: string,
): void {
  const allowed = new Set(recorded);
  for (const value of supplied) {
    if (!allowed.has(value)) throw widened(`${detail} ${value}`);
  }
}

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
export function resolveRecoveryWorkspaceOptions(
  workspaceRoot: string,
  databasePath: string,
  options?: WorkspaceSandboxOptions,
): WorkspaceSandboxOptions {
  const root = path.resolve(workspaceRoot);
  const database = path.resolve(databasePath);
  const relative = path.relative(root, database);
  const inside =
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
  if (!inside) return { ...(options ?? {}) };
  const sqliteFiles = [relative, `${relative}-wal`, `${relative}-shm`, `${relative}-journal`].map(
    (value) => value.split(path.sep).join("/"),
  );
  const base = options?.snapshotIgnoredPrefixes ?? DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PREFIXES;
  return {
    ...(options ?? {}),
    snapshotIgnoredPrefixes: [...new Set([...base, ...sqliteFiles])],
  };
}
