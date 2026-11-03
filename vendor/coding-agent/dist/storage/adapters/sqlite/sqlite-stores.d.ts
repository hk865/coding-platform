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
export interface CloseOpenTurnInput {
    readonly sessionId: string;
    readonly kernelRunId: string;
    readonly expectedRevision: number;
    readonly at: string;
}
export type CloseOpenTurnResult = {
    readonly status: "closed";
    readonly revision: number;
    readonly position: number;
} | {
    readonly status: "already_closed";
    readonly revision: number;
    readonly position: number;
} | {
    readonly status: "already_terminal";
    readonly terminalStatus: string;
} | {
    readonly status: "not_found";
} | {
    readonly status: "mismatch";
    readonly activeRunId: string | null;
} | {
    readonly status: "conflict";
    readonly currentRevision: number;
} | {
    readonly status: "unreadable";
    readonly reason: string;
};
export type TurnBounds = {
    readonly status: "found";
    readonly startPosition: number;
    readonly endPosition: number | null;
    readonly terminalStatus: string | null;
} | {
    readonly status: "not_found";
} | {
    readonly status: "unreadable";
    readonly reason: string;
};
export declare function readTurnBounds(store: SqliteStores, input: {
    readonly sessionId: string;
    readonly kernelRunId: string;
}): Promise<TurnBounds>;
export declare function closeOpenTurn(store: SqliteStores, input: CloseOpenTurnInput): Promise<CloseOpenTurnResult>;
type CompactionDraft = Extract<SessionRecordDraft, {
    recordType: "context.compacted";
}>;
type CompactionPayload = CompactionDraft["payload"];
export interface AppendCompactionRecordInput {
    readonly sessionId: string;
    readonly expectedRevision: number;
    readonly at: string;
    readonly basedOnPosition: number;
    readonly outcome: CompactionPayload["outcome"];
    readonly stubs: CompactionPayload["stubs"];
    readonly summary: CompactionPayload["summary"];
    readonly failure: CompactionPayload["failure"];
}
export type AppendCompactionRecordResult = {
    readonly status: "appended";
    readonly position: number;
    readonly revision: number;
} | {
    readonly status: "not_idle";
    readonly reason: string;
} | {
    readonly status: "invalid";
    readonly reason: string;
} | {
    readonly status: "conflict";
    readonly currentRevision: number;
} | {
    readonly status: "unreadable";
    readonly reason: string;
};
/**
 * Append one `context.compacted` record (K2 L3). The first matching row of the table
 * wins and only row 5 writes: 1 unreadable, 2 revision conflict, 3 the base is not the
 * Session's tail terminal event, 4 the payload or its ranges are invalid, 5 append.
 * A compacted record without a summary carries the previous compacted record's
 * summary, so every compacted record holds the whole view.
 */
export declare function appendCompactionRecord(store: SqliteStores, input: AppendCompactionRecordInput): Promise<AppendCompactionRecordResult>;
export {};
//# sourceMappingURL=sqlite-stores.d.ts.map