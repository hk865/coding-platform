/**
 * 模块职责：定义 checkpoint 的结构、完整性校验、恢复模式和持久化端口。
 *
 * 设计边界：Core 只依赖该抽象，不关心 checkpoint 保存到内存、SQLite 还是其他介质。
 * 关键流程：由稳定状态生成草稿和校验和，适配器保存；恢复时先验签再选择候选。
 */
import { z } from "zod";
import { isoUtcDateTimeSchema, nonEmptyIdSchema } from "../../context/types/context-types.js";
import { deriveRunPhase, runStateSchema } from "../../runtime/state/run-state.js";
import { checksum, contextBasisSchema, effectiveRecoveryConstraintsSchema, runConfigSnapshotSchema, StoreError, workspaceReferenceSchema, } from "../session_store/session-store-port.js";
export const checkpointResumeModeSchema = z.enum([
    "before_model",
    "before_tools",
    "ready_to_complete",
    "paused",
    "terminal",
]);
export const checkpointSchema = z
    .object({
    schemaVersion: z.literal(1),
    checkpointId: nonEmptyIdSchema,
    sessionId: nonEmptyIdSchema,
    runId: nonEmptyIdSchema,
    turnId: nonEmptyIdSchema,
    recordPosition: z.number().int().positive(),
    lastEventSequence: z.number().int().nonnegative(),
    lastEventId: nonEmptyIdSchema.nullable(),
    state: runStateSchema,
    resumeMode: checkpointResumeModeSchema,
    config: runConfigSnapshotSchema,
    workspace: workspaceReferenceSchema,
    /**
     * 可选扩展字段：`session_history` Run 的 checkpoint 保存与其 turn.started 相同的重建
     * 绑定。摘要/checkpoint 只加速恢复，不能取代原 Session 记录；旧 checkpoint 缺省该字段
     * 时保持 `current_turn` 含义，checksum 仍按不含该字段的原正文校验。
     */
    contextBasis: contextBasisSchema.optional(),
    /**
     * 可选扩展字段：与本 Run 的 `turn.started.payload.recoveryConstraints` 相同的实际生效
     * 约束。checkpoint 只加速恢复，不能取代 turn.started 的证据；旧 checkpoint 缺省该字段
     * 时 checksum 仍按原正文校验。
     */
    recoveryConstraints: effectiveRecoveryConstraintsSchema.optional(),
    createdAt: isoUtcDateTimeSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
})
    .strict();
export const checkpointDraftSchema = z
    .object({
    schemaVersion: z.literal(1),
    checkpointId: nonEmptyIdSchema,
    sessionId: nonEmptyIdSchema,
    recordPosition: z.number().int().positive(),
    state: runStateSchema,
    config: runConfigSnapshotSchema,
    workspace: workspaceReferenceSchema,
    contextBasis: contextBasisSchema.optional(),
    recoveryConstraints: effectiveRecoveryConstraintsSchema.optional(),
    createdAt: isoUtcDateTimeSchema,
})
    .strict();
export function deriveCheckpointResumeMode(state) {
    const phase = deriveRunPhase(state);
    if (phase === "created" || phase === "awaiting_model") {
        throw new StoreError("invalid_record", `阶段 ${phase} 不能保存可恢复 checkpoint`);
    }
    if (phase === "before_tools" &&
        state.toolBatch?.calls.some((call) => call.status === "running")) {
        throw new StoreError("invalid_record", "running tool 不能保存可恢复 checkpoint");
    }
    return phase;
}
export function createCheckpoint(draftInput) {
    const draft = checkpointDraftSchema.parse(draftInput);
    const content = {
        schemaVersion: 1,
        checkpointId: draft.checkpointId,
        sessionId: draft.sessionId,
        runId: draft.state.runId,
        turnId: draft.state.turn.turnId,
        recordPosition: draft.recordPosition,
        lastEventSequence: draft.state.lastEventSequence,
        lastEventId: draft.state.lastEventId,
        state: draft.state,
        resumeMode: deriveCheckpointResumeMode(draft.state),
        config: draft.config,
        workspace: draft.workspace,
        // 缺省不写这些键：旧语义记录与原 schemaVersion=1 正文保持逐字节一致。
        ...(draft.contextBasis ? { contextBasis: draft.contextBasis } : {}),
        ...(draft.recoveryConstraints ? { recoveryConstraints: draft.recoveryConstraints } : {}),
        createdAt: draft.createdAt,
    };
    return checkpointSchema.parse({ ...content, checksum: checksum(content) });
}
export function assertCheckpointChecksum(checkpoint) {
    const { checksum: actual, ...content } = checkpoint;
    if (checksum(content) !== actual)
        throw new StoreError("corrupt", "Checkpoint checksum 不匹配");
}
export function checkpointDraft(checkpointId, sessionId, recordPosition, state, config, workspace, createdAt, contextBasis, recoveryConstraints) {
    return {
        schemaVersion: 1,
        checkpointId,
        sessionId,
        recordPosition,
        state,
        config,
        workspace,
        ...(contextBasis ? { contextBasis } : {}),
        ...(recoveryConstraints ? { recoveryConstraints } : {}),
        createdAt,
    };
}
//# sourceMappingURL=checkpoint-store-port.js.map