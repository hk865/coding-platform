/**
 * 模块职责：用 SQLite 实现 Session 与 checkpoint 的跨进程持久化。
 *
 * 设计边界：适配器遵守 Core 端口，不包含恢复决策或 Runner 控制流程。
 * 关键流程：初始化表结构，在事务中执行乐观并发追加，读取时反序列化并复核记录与校验和。
 */
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  Checkpoint,
  CheckpointCandidate,
  CheckpointDraft,
  CheckpointStorePort,
} from "../../../core/ports/checkpoint_store/checkpoint-store-port.js";
import {
  assertCheckpointChecksum,
  checkpointSchema,
  createCheckpoint,
} from "../../../core/ports/checkpoint_store/checkpoint-store-port.js";
import type {
  AppendSessionResult,
  CreateSessionInput,
  ReadSessionPage,
  SessionHeader,
  SessionListPage,
  SessionRecord,
  SessionRecordDraft,
  SessionStorePort,
  StoreCallOptions,
} from "../../../core/ports/session_store/session-store-port.js";
import {
  assertSessionRecordChecksum,
  canonicalJson,
  computeSessionRecordChecksum,
  sessionHeaderSchema,
  sessionRecordDraftSchema,
  sessionRecordSchema,
  StoreError,
} from "../../../core/ports/session_store/session-store-port.js";
import {
  applySessionDraft,
  isActiveSessionState,
  replaySessionRecords,
} from "../../../core/ports/session_store/session-projection.js";

type SessionProjection = ReturnType<typeof replaySessionRecords>;

type Row = Record<string, unknown>;

function cancelled(options: Readonly<StoreCallOptions>): void {
  if (options.signal.aborted) throw new StoreError("cancelled", "Storage 操作已取消");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseJson<T>(text: unknown, parser: (value: unknown) => T, kind: string): T {
  try {
    return parser(JSON.parse(String(text)));
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("corrupt", `${kind} JSON 或 schema 损坏`);
  }
}

function draftMatches(
  record: SessionRecord,
  draft: SessionRecordDraft,
  sessionId: string,
): boolean {
  return (
    record.sessionId === sessionId &&
    record.recordId === draft.recordId &&
    record.recordType === draft.recordType &&
    record.schemaVersion === draft.schemaVersion &&
    record.recordedAt === draft.recordedAt &&
    canonicalJson(record.payload) === canonicalJson(draft.payload)
  );
}

/**
 * Session 与 Checkpoint 的 SQLite 适配器。短事务负责批次原子性和 revision
 * 冲突，所有 JSON 在入库和读取时都经过 strict schema 与 checksum 校验。
 */
export class SqliteStores implements SessionStorePort, CheckpointStorePort {
  readonly #database: DatabaseSync;
  readonly #projectionCache = new Map<
    string,
    { readonly revision: number; readonly state: SessionProjection }
  >();
  #closed = false;

  private constructor(database: DatabaseSync) {
    this.#database = database;
  }

  static async open(databasePath: string): Promise<SqliteStores> {
    const parent = path.dirname(databasePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
    const database = new DatabaseSync(databasePath);
    const stores = new SqliteStores(database);
    try {
      stores.#initialize();
      await chmod(databasePath, 0o600);
      return stores;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async create(
    input: Readonly<CreateSessionInput>,
    options: Readonly<StoreCallOptions>,
  ): Promise<SessionHeader> {
    this.#assertOpen();
    cancelled(options);
    const header = this.#transaction(() => {
      if (this.#sessionRow(input.sessionId))
        throw new StoreError("already_exists", "Session 已存在");
      const content = {
        recordId: input.recordId,
        sessionId: input.sessionId,
        position: 1,
        recordType: "session.created" as const,
        schemaVersion: 1 as const,
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
      this.#database
        .prepare(
          "INSERT INTO sessions(session_id,schema_version,created_at,updated_at,revision,active_run_id,active_turn_id) VALUES(?,?,?,?,?,?,?)",
        )
        .run(input.sessionId, 1, input.createdAt, input.createdAt, 1, null, null);
      this.#insertRecord(record);
      cancelled(options);
      return clone(header);
    });
    this.#projectionCache.set(input.sessionId, { revision: header.revision, state: null });
    return header;
  }

  async append(
    sessionId: string,
    expectedRevision: number,
    draftsInput: readonly Readonly<SessionRecordDraft>[],
    options: Readonly<StoreCallOptions>,
  ): Promise<AppendSessionResult> {
    this.#assertOpen();
    cancelled(options);
    if (draftsInput.length === 0) throw new StoreError("invalid_record", "append batch 不能为空");
    let drafts: SessionRecordDraft[];
    try {
      drafts = draftsInput.map((draft) => sessionRecordDraftSchema.parse(draft));
    } catch {
      throw new StoreError("invalid_record", "Session record draft 非法");
    }
    if (new Set(drafts.map((draft) => draft.recordId)).size !== drafts.length) {
      throw new StoreError("invalid_record", "batch recordId 重复");
    }
    let nextProjection:
      { readonly revision: number; readonly state: SessionProjection } | undefined;
    const result = this.#transaction(() => {
      const header = this.#header(sessionId);
      const existing = drafts.map((draft) => this.#recordById(draft.recordId));
      if (existing.every((record) => record !== null)) {
        const records = existing as SessionRecord[];
        if (!records.every((record, index) => draftMatches(record, drafts[index]!, sessionId))) {
          throw new StoreError("idempotency_conflict", "recordId 的重试内容不同");
        }
        return {
          revision: header["revision"],
          positions: records.map((record) => record["position"]),
          records: clone(records),
        };
      }
      if (existing.some((record) => record !== null)) {
        throw new StoreError("idempotency_conflict", "append batch 部分 recordId 已存在");
      }
      if (header["revision"] !== expectedRevision)
        throw new StoreError("conflict", "Session revision 冲突");
      const cached = this.#projectionCache.get(sessionId);
      const committed =
        cached?.revision === header["revision"] ? null : this.#allRecords(sessionId);
      let state =
        cached?.revision === header["revision"] ? cached.state : replaySessionRecords(committed!);
      const committedCount = committed?.length ?? this.#recordCount(sessionId);
      const records: SessionRecord[] = [];
      for (const [index, draft] of drafts.entries()) {
        state = applySessionDraft(state, draft);
        const content = {
          ...draft,
          sessionId,
          position: committedCount + index + 1,
        };
        records.push(
          sessionRecordSchema.parse({
            ...content,
            checksum: computeSessionRecordChecksum(content),
          }),
        );
      }
      cancelled(options);
      for (const record of records) this.#insertRecord(record);
      const last = records.at(-1)!;
      const active = isActiveSessionState(state) ? state : null;
      const revision = header["revision"] + 1;
      this.#database
        .prepare(
          "UPDATE sessions SET updated_at=?,revision=?,active_run_id=?,active_turn_id=? WHERE session_id=? AND revision=?",
        )
        .run(
          last.recordedAt,
          revision,
          active?.runId ?? null,
          active?.turn.turnId ?? null,
          sessionId,
          expectedRevision,
        );
      nextProjection = { revision, state };
      return {
        revision,
        positions: records.map((record) => record["position"]),
        records: clone(records),
      };
    });
    if (nextProjection) this.#projectionCache.set(sessionId, nextProjection);
    return result;
  }

  async read(
    sessionId: string,
    afterPosition: number,
    limit: number,
    options: Readonly<StoreCallOptions>,
  ): Promise<ReadSessionPage> {
    this.#assertOpen();
    cancelled(options);
    if (
      !Number.isSafeInteger(afterPosition) ||
      afterPosition < 0 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0
    ) {
      throw new StoreError("invalid_record", "read page 参数非法");
    }
    const header = this.#header(sessionId);
    const all = this.#allRecords(sessionId);
    const records = all.slice(afterPosition, afterPosition + limit);
    const lastPosition = records.at(-1)?.["position"] ?? afterPosition;
    return {
      revision: header["revision"],
      records: clone(records),
      nextPosition: lastPosition < all.length ? lastPosition : null,
    };
  }

  async get(sessionId: string, options: Readonly<StoreCallOptions>): Promise<SessionHeader> {
    this.#assertOpen();
    cancelled(options);
    return clone(this.#header(sessionId));
  }

  async list(
    cursor: string | null,
    limit: number,
    options: Readonly<StoreCallOptions>,
  ): Promise<SessionListPage> {
    this.#assertOpen();
    cancelled(options);
    const offset = cursor === null ? 0 : Number.parseInt(cursor, 10);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new StoreError("invalid_record", "list page 参数非法");
    }
    const rows = this.#database
      .prepare("SELECT * FROM sessions ORDER BY updated_at DESC, session_id ASC LIMIT ? OFFSET ?")
      .all(limit + 1, offset) as Row[];
    const hasNext = rows.length > limit;
    const selected = rows.slice(0, limit).map((row) => this.#rowToHeader(row));
    return {
      sessions: clone(selected),
      nextCursor: hasNext ? String(offset + selected.length) : null,
    };
  }

  async save(
    draft: Readonly<CheckpointDraft>,
    options: Readonly<StoreCallOptions>,
  ): Promise<Checkpoint> {
    this.#assertOpen();
    cancelled(options);
    const checkpoint = createCheckpoint(draft);
    return this.#transaction(() => {
      const existing = this.#checkpointById(checkpoint.checkpointId);
      if (existing) {
        if (canonicalJson(existing) !== canonicalJson(checkpoint)) {
          throw new StoreError("idempotency_conflict", "checkpointId 内容冲突");
        }
        return clone(existing);
      }
      const count = Number(
        (
          this.#database
            .prepare("SELECT COUNT(*) AS count FROM session_records WHERE session_id=?")
            .get(checkpoint.sessionId) as Row
        )["count"],
      );
      if (count === 0) throw new StoreError("not_found", "Checkpoint Session 不存在");
      if (checkpoint.recordPosition > count) {
        throw new StoreError("invalid_record", "Checkpoint cursor 超过 Session 事实位置");
      }
      const latest = this.#database
        .prepare(
          "SELECT record_position FROM checkpoints WHERE run_id=? ORDER BY record_position DESC LIMIT 1",
        )
        .get(checkpoint.runId) as Row | undefined;
      if (latest && checkpoint.recordPosition <= Number(latest["record_position"])) {
        throw new StoreError("conflict", "Checkpoint cursor 不能倒退或重复");
      }
      this.#database
        .prepare(
          "INSERT INTO checkpoints(checkpoint_id,session_id,run_id,turn_id,record_position,created_at,checkpoint_json) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          checkpoint.checkpointId,
          checkpoint.sessionId,
          checkpoint.runId,
          checkpoint.turnId,
          checkpoint.recordPosition,
          checkpoint.createdAt,
          canonicalJson(checkpoint),
        );
      this.#database
        .prepare(
          "DELETE FROM checkpoints WHERE checkpoint_id IN (SELECT checkpoint_id FROM checkpoints WHERE run_id=? ORDER BY record_position DESC LIMIT -1 OFFSET 3)",
        )
        .run(checkpoint.runId);
      cancelled(options);
      return clone(checkpoint);
    });
  }

  async loadLatest(runId: string, options: Readonly<StoreCallOptions>): Promise<Checkpoint | null> {
    return (await this.listCheckpoints(runId, options))[0] ?? null;
  }

  async listCheckpoints(
    runId: string,
    options: Readonly<StoreCallOptions>,
  ): Promise<readonly Checkpoint[]> {
    this.#assertOpen();
    cancelled(options);
    const rows = this.#database
      .prepare(
        "SELECT checkpoint_json FROM checkpoints WHERE run_id=? ORDER BY record_position DESC",
      )
      .all(runId) as Row[];
    return rows.map((row) => this.#parseCheckpoint(row["checkpoint_json"]));
  }

  async listCheckpointCandidates(
    runId: string,
    options: Readonly<StoreCallOptions>,
  ): Promise<readonly CheckpointCandidate[]> {
    this.#assertOpen();
    cancelled(options);
    const rows = this.#database
      .prepare(
        "SELECT checkpoint_id,checkpoint_json FROM checkpoints WHERE run_id=? ORDER BY record_position DESC",
      )
      .all(runId) as Row[];
    return rows.map((row) => {
      const checkpointId = String(row["checkpoint_id"]);
      try {
        return { checkpointId, checkpoint: this.#parseCheckpoint(row["checkpoint_json"]) };
      } catch {
        return { checkpointId, checkpoint: null };
      }
    });
  }

  async deleteInvalid(
    checkpointIds: readonly string[],
    options: Readonly<StoreCallOptions>,
  ): Promise<number> {
    this.#assertOpen();
    cancelled(options);
    return this.#transaction(() => {
      let deleted = 0;
      const statement = this.#database.prepare("DELETE FROM checkpoints WHERE checkpoint_id=?");
      for (const id of checkpointIds) deleted += Number(statement.run(id).changes);
      return deleted;
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#projectionCache.clear();
    this.#database.close();
  }

  #initialize(): void {
    this.#database.exec("PRAGMA foreign_keys=ON");
    this.#database.exec("PRAGMA journal_mode=WAL");
    this.#database.exec("PRAGMA synchronous=FULL");
    this.#database.exec("PRAGMA trusted_schema=OFF");
    this.#database.exec("PRAGMA busy_timeout=1000");
    this.#database.enableDefensive(true);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS sessions(
        session_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        active_run_id TEXT,
        active_turn_id TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS session_records(
        session_id TEXT NOT NULL REFERENCES sessions(session_id),
        position INTEGER NOT NULL,
        record_id TEXT NOT NULL UNIQUE,
        record_type TEXT NOT NULL,
        run_id TEXT,
        turn_id TEXT,
        event_sequence INTEGER,
        record_json TEXT NOT NULL,
        PRIMARY KEY(session_id, position),
        UNIQUE(run_id, event_sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS checkpoints(
        checkpoint_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id),
        run_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        record_position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL
      ) STRICT;
    `);
    const version = this.#database
      .prepare("SELECT value FROM metadata WHERE key='database_schema_version'")
      .get() as Row | undefined;
    if (!version) {
      this.#database
        .prepare("INSERT INTO metadata(key,value) VALUES('database_schema_version','1')")
        .run();
    } else if (version["value"] !== "1") {
      throw new StoreError(
        "version_unsupported",
        `不支持数据库 schema version ${String(version["value"])}`,
      );
    }
    const foreignKeys = this.#database.prepare("PRAGMA foreign_keys").get() as Row;
    const trustedSchema = this.#database.prepare("PRAGMA trusted_schema").get() as Row;
    if (
      Number(foreignKeys["foreign_keys"]) !== 1 ||
      Number(trustedSchema["trusted_schema"]) !== 0
    ) {
      throw new StoreError("internal", "SQLite 安全 PRAGMA 未生效");
    }
  }

  #insertRecord(record: SessionRecord): void {
    const event = record.recordType === "agent.event" ? record.payload.event : null;
    const runId =
      record.recordType === "turn.started"
        ? record.payload.run.runId
        : record.recordType === "agent.event"
          ? record.payload.event.meta.runId
          : null;
    const turnId =
      record.recordType === "turn.started"
        ? record.payload.run.turn.turnId
        : record.recordType === "agent.event"
          ? record.payload.event.meta.turnId
          : null;
    this.#database
      .prepare(
        "INSERT INTO session_records(session_id,position,record_id,record_type,run_id,turn_id,event_sequence,record_json) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        record.sessionId,
        record["position"],
        record.recordId,
        record.recordType,
        runId,
        turnId,
        event?.meta.sequence ?? null,
        canonicalJson(record),
      );
  }

  #allRecords(sessionId: string): SessionRecord[] {
    const rows = this.#database
      .prepare(
        "SELECT position,record_json FROM session_records WHERE session_id=? ORDER BY position",
      )
      .all(sessionId) as Row[];
    return rows.map((row, index) => {
      if (Number(row["position"]) !== index + 1) {
        throw new StoreError("corrupt", "Session position 不连续", index);
      }
      const record = parseJson(
        row["record_json"],
        (value) => sessionRecordSchema.parse(value),
        "Session record",
      );
      assertSessionRecordChecksum(record);
      return record;
    });
  }

  #recordCount(sessionId: string): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM session_records WHERE session_id=?")
      .get(sessionId) as Row;
    return Number(row["count"]);
  }

  #recordById(recordId: string): SessionRecord | null {
    const row = this.#database
      .prepare("SELECT record_json FROM session_records WHERE record_id=?")
      .get(recordId) as Row | undefined;
    if (!row) return null;
    const record = parseJson(
      row["record_json"],
      (value) => sessionRecordSchema.parse(value),
      "Session record",
    );
    assertSessionRecordChecksum(record);
    return record;
  }

  #sessionRow(sessionId: string): Row | undefined {
    return this.#database.prepare("SELECT * FROM sessions WHERE session_id=?").get(sessionId) as
      Row | undefined;
  }

  #header(sessionId: string): SessionHeader {
    const row = this.#sessionRow(sessionId);
    if (!row) throw new StoreError("not_found", "Session 不存在");
    return this.#rowToHeader(row);
  }

  #rowToHeader(row: Row): SessionHeader {
    return sessionHeaderSchema.parse({
      schemaVersion: Number(row["schema_version"]),
      sessionId: String(row["session_id"]),
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
      revision: Number(row["revision"]),
      activeRunId: row["active_run_id"] === null ? null : String(row["active_run_id"]),
      activeTurnId: row["active_turn_id"] === null ? null : String(row["active_turn_id"]),
    });
  }

  #checkpointById(checkpointId: string): Checkpoint | null {
    const row = this.#database
      .prepare("SELECT checkpoint_json FROM checkpoints WHERE checkpoint_id=?")
      .get(checkpointId) as Row | undefined;
    return row ? this.#parseCheckpoint(row["checkpoint_json"]) : null;
  }

  #parseCheckpoint(value: unknown): Checkpoint {
    const checkpoint = parseJson(
      value,
      (candidate) => checkpointSchema.parse(candidate),
      "Checkpoint",
    );
    assertCheckpointChecksum(checkpoint);
    return checkpoint;
  }

  #transaction<T>(operation: () => T): T {
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // 事务可能已由 SQLite 自动回滚。
      }
      if (error instanceof StoreError) throw error;
      const code = (error as { code?: string }).code ?? "";
      if (code.includes("BUSY") || code.includes("LOCKED")) {
        throw new StoreError("busy", "SQLite 正忙");
      }
      if (code.includes("CONSTRAINT")) {
        throw new StoreError("idempotency_conflict", "SQLite 唯一约束冲突");
      }
      throw new StoreError("internal", "SQLite 操作失败");
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new StoreError("closed", "Storage 已关闭");
  }
}
