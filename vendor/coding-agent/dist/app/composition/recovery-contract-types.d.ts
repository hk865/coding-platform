/** R4a 内部恢复契约类型；不属于 Kernel public-api。 */
import type { RunLimits } from "../../core/runtime/limits/limit-guard.js";
import type { WorkspaceConsistencyMode } from "../../sandbox/workspace/workspace-sandbox.js";
/** null 保留旧 CLI 的最新 Turn 选择；稳定身份重试必须同时给出 runId/turnId。 */
export type RecoveryTarget = Readonly<{
    runId: string;
    turnId: string;
}> | null;
/** 可直接重建沙箱的有效值；写入前解析缺省，不能只保存调用者的可选覆盖。 */
export interface EffectiveRecoveryConstraints {
    readonly version: 1;
    readonly limits: RunLimits;
    readonly workspace: {
        readonly deniedPrefixes: readonly string[];
        readonly snapshotIgnoredPrefixes: readonly string[];
        readonly consistencyMode: WorkspaceConsistencyMode;
        readonly maxFileBytes: number;
    };
    readonly process: {
        readonly protectedPaths: readonly string[];
        readonly readOnlyPaths: readonly string[];
        readonly executablePath: string;
    };
    readonly hostAuthorizedTools: readonly string[];
}
/** 缺少 recorded 证据时，执行恢复必须拒绝；terminal/只读旧日志另行处理。 */
export interface RecoveryConstraintEvidence {
    readonly recorded: EffectiveRecoveryConstraints | null;
    readonly supplied: EffectiveRecoveryConstraints;
}
//# sourceMappingURL=recovery-contract-types.d.ts.map