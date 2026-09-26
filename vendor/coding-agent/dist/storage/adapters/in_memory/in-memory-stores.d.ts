/**
 * 模块职责：用内存实现 SessionStorePort 与 CheckpointStorePort，便于测试和短生命周期运行。
 *
 * 设计边界：数据不跨进程持久化，但仍严格模拟 revision、position、幂等和校验语义。
 * 关键流程：写入前校验草稿和预期 revision，复制保存；读取时分页或选择最近 checkpoint。
 */
import type { Checkpoint, CheckpointCandidate, CheckpointDraft, CheckpointStorePort } from "../../../core/ports/checkpoint_store/checkpoint-store-port.js";
import type { AppendSessionResult, CreateSessionInput, ReadSessionPage, SessionHeader, SessionListPage, SessionRecordDraft, SessionStorePort, StoreCallOptions } from "../../../core/ports/session_store/session-store-port.js";
export declare class InMemoryStores implements SessionStorePort, CheckpointStorePort {
    #private;
    create(input: Readonly<CreateSessionInput>, options: Readonly<StoreCallOptions>): Promise<SessionHeader>;
    append(sessionId: string, expectedRevision: number, draftsInput: readonly Readonly<SessionRecordDraft>[], options: Readonly<StoreCallOptions>): Promise<AppendSessionResult>;
    read(sessionId: string, afterPosition: number, limit: number, options: Readonly<StoreCallOptions>): Promise<ReadSessionPage>;
    get(sessionId: string, options: Readonly<StoreCallOptions>): Promise<SessionHeader>;
    list(cursor: string | null, limit: number, options: Readonly<StoreCallOptions>): Promise<SessionListPage>;
    save(draft: Readonly<CheckpointDraft>, options: Readonly<StoreCallOptions>): Promise<Checkpoint>;
    loadLatest(runId: string, options: Readonly<StoreCallOptions>): Promise<Checkpoint | null>;
    listCheckpoints(runId: string, options: Readonly<StoreCallOptions>): Promise<readonly Checkpoint[]>;
    listCheckpointCandidates(runId: string, options: Readonly<StoreCallOptions>): Promise<readonly CheckpointCandidate[]>;
    deleteInvalid(checkpointIds: readonly string[], options: Readonly<StoreCallOptions>): Promise<number>;
    close(): Promise<void>;
}
//# sourceMappingURL=in-memory-stores.d.ts.map