import { assertCheckpointChecksum, checkpointSchema, createCheckpoint, } from "../../../core/ports/checkpoint_store/checkpoint-store-port.js";
import { assertSessionRecordChecksum, canonicalJson, computeSessionRecordChecksum, sessionHeaderSchema, sessionRecordDraftSchema, sessionRecordSchema, StoreError, } from "../../../core/ports/session_store/session-store-port.js";
import { applySessionDraft, isActiveSessionState, replaySessionRecords, } from "../../../core/ports/session_store/session-projection.js";
function clone(value) {
    return structuredClone(value);
}
function cancelled(options) {
    if (options.signal.aborted)
        throw new StoreError("cancelled", "Storage 操作已取消");
}
function positiveLimit(value) {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new StoreError("invalid_record", "limit 必须为正整数");
}
function draftMatches(record, draft, sessionId) {
    return (record.sessionId === sessionId &&
        record.recordId === draft.recordId &&
        record.recordType === draft.recordType &&
        record.schemaVersion === draft.schemaVersion &&
        record.recordedAt === draft.recordedAt &&
        canonicalJson(record.payload) === canonicalJson(draft.payload));
}
export class InMemoryStores {
    #sessions = new Map();
    #recordsById = new Map();
    #checkpoints = new Map();
    #closed = false;
    async create(input, options) {
        this.#assertOpen();
        cancelled(options);
        if (this.#sessions.has(input.sessionId))
            throw new StoreError("already_exists", "Session 已存在");
        if (this.#recordsById.has(input.recordId))
            throw new StoreError("already_exists", "recordId 已存在");
        const content = {
            recordId: input.recordId,
            sessionId: input.sessionId,
            position: 1,
            recordType: "session.created",
            schemaVersion: 1,
            recordedAt: input.createdAt,
            payload: { sessionId: input.sessionId, createdAt: input.createdAt },
        };
        const record = sessionRecordSchema.parse({
            ...content,
            checksum: computeSessionRecordChecksum(content),
        });
        const header = sessionHeaderSchema.parse({
            schemaVersion: 1,
            sessionId: input.sessionId,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
            revision: 1,
            activeRunId: null,
            activeTurnId: null,
        });
        cancelled(options);
        this.#sessions.set(input.sessionId, { header, records: [record] });
        this.#recordsById.set(input.recordId, record);
        return clone(header);
    }
    async append(sessionId, expectedRevision, draftsInput, options) {
        this.#assertOpen();
        cancelled(options);
        const session = this.#session(sessionId);
        if (draftsInput.length === 0)
            throw new StoreError("invalid_record", "append batch 不能为空");
        let drafts;
        try {
            drafts = draftsInput.map((draft) => sessionRecordDraftSchema.parse(draft));
        }
        catch {
            throw new StoreError("invalid_record", "Session record draft 非法");
        }
        const ids = drafts.map((draft) => draft.recordId);
        if (new Set(ids).size !== ids.length)
            throw new StoreError("invalid_record", "batch recordId 重复");
        const existing = drafts.map((draft) => this.#recordsById.get(draft.recordId));
        if (existing.every((record) => record !== undefined)) {
            const records = existing;
            if (!records.every((record, index) => draftMatches(record, drafts[index], sessionId))) {
                throw new StoreError("idempotency_conflict", "recordId 的重试内容不同");
            }
            return {
                revision: session.header.revision,
                positions: records.map((record) => record.position),
                records: clone(records),
            };
        }
        if (existing.some((record) => record !== undefined)) {
            throw new StoreError("idempotency_conflict", "append batch 部分 recordId 已存在");
        }
        if (session.header.revision !== expectedRevision) {
            throw new StoreError("conflict", "Session revision 冲突");
        }
        let state = replaySessionRecords(session.records);
        const records = [];
        for (const [index, draft] of drafts.entries()) {
            state = applySessionDraft(state, draft);
            const content = {
                ...draft,
                sessionId,
                position: session.records.length + index + 1,
            };
            records.push(sessionRecordSchema.parse({
                ...content,
                checksum: computeSessionRecordChecksum(content),
            }));
        }
        cancelled(options);
        const last = records.at(-1);
        const active = isActiveSessionState(state) ? state : null;
        session.records.push(...records);
        session.header = sessionHeaderSchema.parse({
            ...session.header,
            updatedAt: last.recordedAt,
            revision: session.header.revision + 1,
            activeRunId: active?.runId ?? null,
            activeTurnId: active?.turn.turnId ?? null,
        });
        for (const record of records)
            this.#recordsById.set(record.recordId, record);
        return {
            revision: session.header.revision,
            positions: records.map((record) => record.position),
            records: clone(records),
        };
    }
    async read(sessionId, afterPosition, limit, options) {
        this.#assertOpen();
        cancelled(options);
        positiveLimit(limit);
        if (!Number.isSafeInteger(afterPosition) || afterPosition < 0) {
            throw new StoreError("invalid_record", "afterPosition 非法");
        }
        const session = this.#session(sessionId);
        for (const [index, record] of session.records.entries()) {
            if (record.position !== index + 1)
                throw new StoreError("corrupt", "Session position 不连续", index);
            sessionRecordSchema.parse(record);
            assertSessionRecordChecksum(record);
        }
        const records = session.records.slice(afterPosition, afterPosition + limit);
        const lastPosition = records.at(-1)?.position ?? afterPosition;
        return {
            revision: session.header.revision,
            records: clone(records),
            nextPosition: lastPosition < session.records.length ? lastPosition : null,
        };
    }
    async get(sessionId, options) {
        this.#assertOpen();
        cancelled(options);
        return clone(this.#session(sessionId).header);
    }
    async list(cursor, limit, options) {
        this.#assertOpen();
        cancelled(options);
        positiveLimit(limit);
        const offset = cursor === null ? 0 : Number.parseInt(cursor, 10);
        if (!Number.isSafeInteger(offset) || offset < 0)
            throw new StoreError("invalid_record", "cursor 非法");
        const all = [...this.#sessions.values()]
            .map((session) => session.header)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) ||
            left.sessionId.localeCompare(right.sessionId));
        const sessions = all.slice(offset, offset + limit);
        const nextOffset = offset + sessions.length;
        return {
            sessions: clone(sessions),
            nextCursor: nextOffset < all.length ? String(nextOffset) : null,
        };
    }
    async save(draft, options) {
        this.#assertOpen();
        cancelled(options);
        const checkpoint = createCheckpoint(draft);
        const session = this.#session(checkpoint.sessionId);
        if (checkpoint.recordPosition > session.records.length) {
            throw new StoreError("invalid_record", "Checkpoint cursor 超过 Session 事实位置");
        }
        const existing = this.#checkpoints.get(checkpoint.checkpointId);
        if (existing) {
            if (canonicalJson(existing) !== canonicalJson(checkpoint)) {
                throw new StoreError("idempotency_conflict", "checkpointId 内容冲突");
            }
            return clone(existing);
        }
        const sameRun = [...this.#checkpoints.values()].filter((candidate) => candidate.runId === checkpoint.runId);
        const latest = sameRun.sort((a, b) => b.recordPosition - a.recordPosition)[0];
        if (latest && checkpoint.recordPosition <= latest.recordPosition) {
            throw new StoreError("conflict", "Checkpoint cursor 不能倒退或重复");
        }
        this.#checkpoints.set(checkpoint.checkpointId, checkpoint);
        const retained = [...sameRun, checkpoint]
            .sort((a, b) => b.recordPosition - a.recordPosition)
            .slice(3);
        for (const candidate of retained)
            this.#checkpoints.delete(candidate.checkpointId);
        return clone(checkpoint);
    }
    async loadLatest(runId, options) {
        return (await this.listCheckpoints(runId, options))[0] ?? null;
    }
    async listCheckpoints(runId, options) {
        this.#assertOpen();
        cancelled(options);
        const checkpoints = [...this.#checkpoints.values()]
            .filter((checkpoint) => checkpoint.runId === runId)
            .sort((left, right) => right.recordPosition - left.recordPosition);
        for (const checkpoint of checkpoints) {
            checkpointSchema.parse(checkpoint);
            assertCheckpointChecksum(checkpoint);
        }
        return clone(checkpoints);
    }
    async listCheckpointCandidates(runId, options) {
        this.#assertOpen();
        cancelled(options);
        return [...this.#checkpoints.values()]
            .filter((checkpoint) => checkpoint.runId === runId)
            .sort((left, right) => right.recordPosition - left.recordPosition)
            .map((checkpoint) => {
            try {
                checkpointSchema.parse(checkpoint);
                assertCheckpointChecksum(checkpoint);
                return { checkpointId: checkpoint.checkpointId, checkpoint: clone(checkpoint) };
            }
            catch {
                return { checkpointId: checkpoint.checkpointId, checkpoint: null };
            }
        });
    }
    async deleteInvalid(checkpointIds, options) {
        this.#assertOpen();
        cancelled(options);
        let deleted = 0;
        for (const id of checkpointIds) {
            if (this.#checkpoints.delete(id))
                deleted += 1;
        }
        return deleted;
    }
    async close() {
        this.#closed = true;
    }
    #session(sessionId) {
        const session = this.#sessions.get(sessionId);
        if (!session)
            throw new StoreError("not_found", "Session 不存在");
        return session;
    }
    #assertOpen() {
        if (this.#closed)
            throw new StoreError("closed", "Storage 已关闭");
    }
}
//# sourceMappingURL=in-memory-stores.js.map