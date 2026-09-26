import type { Checkpoint, CheckpointCandidate, CheckpointDraft, CheckpointStorePort } from "../../../core/ports/checkpoint_store/checkpoint-store-port.js";
import type { AppendSessionResult, CreateSessionInput, ReadSessionPage, SessionHeader, SessionListPage, SessionRecordDraft, SessionStorePort, StoreCallOptions } from "../../../core/ports/session_store/session-store-port.js";
/**
 * Session 与 Checkpoint 的 SQLite 适配器。短事务负责批次原子性和 revision
 * 冲突，所有 JSON 在入库和读取时都经过 strict schema 与 checksum 校验。
 */
export declare class SqliteStores implements SessionStorePort, CheckpointStorePort {
    #private;
    private constructor();
    static open(databasePath: string): Promise<SqliteStores>;
    create(input: Readonly<CreateSessionInput>, options: Readonly<StoreCallOptions>): Promise<SessionHeader>;
    append(sessionId: string, expectedRevision: number, draftsInput: readonly Readonly<SessionRecordDraft>[], options: Readonly<StoreCallOptions>): Promise<AppendSessionResult>;
    read(sessionId: string, afterPosition: number, limit: number, options: Readonly<StoreCallOptions>): Promise<ReadSessionPage & {
        lastPosition: number;
    }>;
    get(sessionId: string, options: Readonly<StoreCallOptions>): Promise<SessionHeader>;
    list(cursor: string | null, limit: number, options: Readonly<StoreCallOptions>): Promise<SessionListPage>;
    save(draft: Readonly<CheckpointDraft>, options: Readonly<StoreCallOptions>): Promise<Checkpoint>;
    loadLatest(runId: string, options: Readonly<StoreCallOptions>): Promise<Checkpoint | null>;
    listCheckpoints(runId: string, options: Readonly<StoreCallOptions>): Promise<readonly Checkpoint[]>;
    listCheckpointCandidates(runId: string, options: Readonly<StoreCallOptions>): Promise<readonly CheckpointCandidate[]>;
    deleteInvalid(checkpointIds: readonly string[], options: Readonly<StoreCallOptions>): Promise<number>;
    close(): Promise<void>;
}
//# sourceMappingURL=sqlite-stores.d.ts.map