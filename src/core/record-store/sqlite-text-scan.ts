/**
 * Slice 4 speed round 1 (decision 66, S1.2/S1.3/S1.5/S1.6): the SQLite compact
 * text table and its catch-up.
 *
 * One plain table per registered text index holds one row per head record of
 * that aggregate type: `(ref_key PRIMARY KEY, prefix_key, text, seq)`. `text`
 * and `prefix_key` are stored as `JSON.stringify(value)` and read back with
 * `JSON.parse`, so a lone surrogate survives node:sqlite's TEXT handling and
 * the two backends stay in parity (S1.2). `next_text_meta` stores this
 * process's registration `code`, the `through` event id and a random
 * `generation` per (re)build.
 *
 * Route two removes FTS5 entirely: no window table, no probe. An inert legacy
 * `next_fts_%` table from a 4B-era file is dropped at open, each drop guarded
 * by a try/catch so a missing fts5 module is not an error.
 *
 * The read path believes the table (S1.8): it scans `text` directly, then the
 * backend reads the matched records once inside the same read transaction.
 *
 * This file imports no WorkGraph module.
 */
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DecodedTextSearchRequest, RecordLookupRegistry, RegisteredLookupIndex } from "./lookup-index.js";
import { encodeLookupValues } from "./lookup-index.js";
import { isJsonObject } from "./record-codec.js";
import { aggregateTypeTerm } from "./sqlite-sql-literals.js";
import {
  clearTextScanIndex, createTextScanIndex, loadBucket, mergePending, moveCatchUpRow, removeTextScanRow,
  scanEntries, textScanRowOf, type TextScanIndex,
} from "./text-scan.js";

const META_TABLE = "next_text_meta";

/** Bumped when the row derivation or the scan rule changes; part of every code. */
export const TEXT_SCAN_RULE_VERSION = 2;

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const META_QUOTED = quoteIdentifier(META_TABLE);
const CREATE_META_SQL = `CREATE TABLE IF NOT EXISTS ${META_QUOTED}(name TEXT PRIMARY KEY, code TEXT NOT NULL, through INTEGER, generation TEXT NOT NULL)`;
const READ_META_SQL = `SELECT code, through, generation FROM ${META_QUOTED} WHERE name = ?`;
const WRITE_META_SQL = `INSERT INTO ${META_QUOTED}(name, code, through, generation) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET code = excluded.code, through = excluded.through, generation = excluded.generation`;
const READ_MAX_EVENT_ID_SQL = "SELECT MAX(id) AS max_id FROM events";
const TABLE_EXISTS_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?";
/**
 * F7 (review item 12b): the fixed advance statement is module-level too and is
 * prepared through the backend's statement cache on every call.
 */
const ADVANCE_META_SQL = `UPDATE ${META_QUOTED} SET through = ? WHERE name = ? AND through IS ? AND code = ?`;
/**
 * F7 (review item 6): only the legacy meta table and the FTS *virtual* tables.
 * The `next_fts_%` shadow tables are plain tables, so they do not match the
 * `CREATE VIRTUAL TABLE` filter and are dropped with their virtual table.
 */
const LEGACY_TABLES_SQL = `SELECT name FROM sqlite_master WHERE type = 'table'
  AND (name = 'next_fts_meta' OR (name LIKE 'next\\_fts\\_%' ESCAPE '\\' AND sql LIKE 'CREATE VIRTUAL TABLE%'))`;

/** Deterministic short suffix so two index names cannot collide after sanitizing. */
function tableSuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (let position = 0; position < value.length; position += 1) {
    hash ^= value.charCodeAt(position);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function tableNameFor(definition: RegisteredLookupIndex): string {
  return `next_text_${definition.name.replace(/[^A-Za-z0-9_]/g, "_")}_${tableSuffix(definition.name)}`;
}

/** S1.3: sha256 hex of the registration identity exactly in this key order. */
function codeOf(definition: RegisteredLookupIndex, textPaths: readonly string[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: definition.name,
        aggregateType: definition.aggregateType,
        prefixPaths: definition.paths,
        textPaths,
        ruleVersion: TEXT_SCAN_RULE_VERSION,
        unicode: process.versions.unicode,
        icu: process.versions.icu,
      }),
    )
    .digest("hex");
}

function tableExists(prepare: StatementGetter, name: string): boolean {
  const row = prepare(TABLE_EXISTS_SQL).get(name) as { name: string } | undefined;
  return row !== undefined;
}

/** The backend's cached statement getter (S3.1). */
export type StatementGetter = (sql: string) => ReturnType<DatabaseSync["prepare"]>;

type TextIndex = {
  readonly definition: RegisteredLookupIndex;
  readonly table: string;
  readonly code: string;
};

type CacheEntry = {
  bytes: TextScanIndex;
  generation: string | null;
  through: number | null;
};

export type SqliteTextScanPage =
  | { readonly status: "ready"; readonly refKeys: readonly string[]; readonly next: string | null; readonly complete: boolean }
  | { readonly status: "not_ready" };

export type SqliteTextScan = {
  /** Inside the write transaction: upsert this record's row for each text index. */
  indexRecord(refKey: string, aggregateType: string, body: Record<string, unknown>, seq: number): void;
  /** Inside the write transaction: advance `through` for this process's code. */
  advanceThrough(previousMax: number | null, lastEventId: number): void;
  /** Inside the read transaction: answer one decoded request or `not_ready`. */
  searchText(request: DecodedTextSearchRequest): SqliteTextScanPage;
  /** Clear every cached bucket and reverse mapping. */
  close(): void;
};

export function createSqliteTextScan(
  db: DatabaseSync,
  lookups: RecordLookupRegistry,
  prepare: StatementGetter,
): SqliteTextScan {
  db.exec(CREATE_META_SQL);

  /**
   * S1.5 legacy drop. Precondition: no 4B-era process has the file open during
   * this upgrade. A virtual table whose fts5 module is missing cannot be
   * dropped; the try/catch leaves it inert.
   */
  const legacy = prepare(LEGACY_TABLES_SQL).all() as unknown as { name: string }[];
  if (legacy.length > 0) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of legacy) {
        try {
          db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(row.name)}`);
        } catch {
          // A missing fts5 module leaves an inert table; not an error.
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // no live transaction left to roll back - nothing else to do
      }
      throw error;
    }
  }

  const readMaxEventId = (): number | null => {
    const row = prepare(READ_MAX_EVENT_ID_SQL).get() as
      | { max_id: number | bigint | null }
      | undefined;
    const max = row?.max_id;
    return max === null || max === undefined ? null : Number(max);
  };
  const normalizedThrough = (value: number | bigint | null | undefined): number | null =>
    value === null || value === undefined ? null : Number(value);

  // F7 (review item 12c): `readMeta` no longer holds a statement outside the
  // cache; every call prepares through the backend's statement cache.
  const readMeta = (name: string): { code: string; through: number | bigint | null; generation: string | null } | undefined =>
    prepare(READ_META_SQL).get(name) as
      | { code: string; through: number | bigint | null; generation: string | null }
      | undefined;
  const writeMeta = (name: string, code: string, through: number | null, generation: string): void => {
    prepare(WRITE_META_SQL).run(name, code, through, generation);
  };

  const indexes: TextIndex[] = [];
  const byAggregate = new Map<string, TextIndex[]>();
  const byName = new Map<string, TextIndex>();
  const caches = new Map<string, CacheEntry>();

  for (const definition of lookups.indexes) {
    const text = definition.text;
    if (text === undefined) continue;
    const table = tableNameFor(definition);
    const code = codeOf(definition, text.paths);
    const stored = readMeta(definition.name);
    if (
      stored?.code !== code ||
      stored?.generation === null ||
      stored?.generation === undefined ||
      !tableExists(prepare, table) ||
      normalizedThrough(stored?.through) !== readMaxEventId()
    ) {
      // S1.5: one BEGIN IMMEDIATE per index. DROP, CREATE, derive every head row
      // and publish the new meta together, so a throw leaves the old table and
      // its meta exactly as they were.
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
        db.exec(
          `CREATE TABLE ${quoteIdentifier(table)}(ref_key TEXT PRIMARY KEY, prefix_key TEXT, text TEXT NOT NULL, seq INTEGER NOT NULL)`,
        );
        db.exec(`CREATE INDEX ${quoteIdentifier(`${table}_seq`)} ON ${quoteIdentifier(table)}(seq)`);
        db.exec(
          `CREATE INDEX ${quoteIdentifier(`${table}_prefix`)} ON ${quoteIdentifier(table)}(prefix_key, ref_key)`,
        );
        const rows = prepare(`SELECT ref_key, snapshot_json FROM snapshots WHERE ${aggregateTypeTerm(definition.aggregateType)}`)
          .all() as unknown as { ref_key: string; snapshot_json: string }[];
        // Read MAX(id) inside the transaction so `through` matches the snapshot
        // the inserts were built from.
        const through = readMaxEventId();
        const insert = prepare(
          `INSERT INTO ${quoteIdentifier(table)}(ref_key, prefix_key, text, seq) VALUES (?, ?, ?, ?)`,
        );
        for (const row of rows) {
          // A rebuild reads trusted head records: a non-text, unparsable or
          // non-object snapshot is corrupt, so the open must fail instead of
          // answering from an incomplete index.
          if (typeof row.snapshot_json !== "string") {
            throw new Error(`text scan rebuild: snapshot ${row.ref_key} is not stored as text`);
          }
          let body: unknown;
          try {
            body = JSON.parse(row.snapshot_json);
          } catch (error) {
            throw new Error(
              `text scan rebuild: snapshot ${row.ref_key} is damaged: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          if (!isJsonObject(body)) {
            throw new Error(`text scan rebuild: snapshot ${row.ref_key} is not a JSON object`);
          }
          const derived = textScanRowOf(definition, body);
          if (derived === null) continue;
          insert.run(row.ref_key, JSON.stringify(derived.prefixKey), JSON.stringify(derived.text), through);
        }
        writeMeta(definition.name, code, through, randomUUID());
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // no live transaction left to roll back - nothing else to do
        }
        throw error;
      }
    }
    const entry: TextIndex = { definition, table, code };
    indexes.push(entry);
    byName.set(definition.name, entry);
    const group = byAggregate.get(definition.aggregateType);
    if (group === undefined) byAggregate.set(definition.aggregateType, [entry]);
    else group.push(entry);
    caches.set(definition.name, { bytes: createTextScanIndex(), generation: null, through: null });
  }

  const indexRecord = (refKey: string, aggregateType: string, body: Record<string, unknown>, seq: number): void => {
    const group = byAggregate.get(aggregateType);
    if (group === undefined) return;
    for (const entry of group) {
      const stored = readMeta(entry.definition.name);
      // S1.4: a stored code that is not this process's code means another
      // registration owns the table now; skip the upsert and the advance.
      if (stored?.code !== entry.code) continue;
      const derived = textScanRowOf(entry.definition, body);
      if (derived === null) {
        // F1 (review item 1): a composite prefix is never a candidate. Keep the
        // row (with a NULL prefix) and bump its seq so every other connection's
        // catch-up sees the change and drops the refKey from its cache; a DELETE
        // would be invisible to `WHERE seq > through`.
        prepare(
          `UPDATE ${quoteIdentifier(entry.table)} SET prefix_key = NULL, seq = ? WHERE ref_key = ?`,
        ).run(seq, refKey);
        continue;
      }
      prepare(
        `INSERT INTO ${quoteIdentifier(entry.table)}(ref_key, prefix_key, text, seq) VALUES (?, ?, ?, ?)
         ON CONFLICT(ref_key) DO UPDATE SET prefix_key = excluded.prefix_key, text = excluded.text, seq = excluded.seq`,
      ).run(refKey, JSON.stringify(derived.prefixKey), JSON.stringify(derived.text), seq);
    }
  };

  const advanceThrough = (previousMax: number | null, lastEventId: number): void => {
    for (const entry of indexes) {
      prepare(ADVANCE_META_SQL).run(lastEventId, entry.definition.name, previousMax, entry.code);
    }
  };

  const searchText = (request: DecodedTextSearchRequest): SqliteTextScanPage => {
    const entry = byName.get(request.index.name);
    if (entry === undefined) return { status: "not_ready" };
    const meta = readMeta(entry.definition.name);
    if (meta === undefined || meta.code !== entry.code) return { status: "not_ready" };
    const max = readMaxEventId();
    if (normalizedThrough(meta.through) !== max) return { status: "not_ready" };
    const cache = caches.get(entry.definition.name)!;
    if (
      cache.generation !== meta.generation ||
      cache.through === null ||
      cache.through > (max ?? 0)
    ) {
      // F7 (review item 5): the reload drops the stale-generation structure;
      // buckets load lazily, so a failed bucket read leaves no half-loaded
      // bucket (only the not-yet-loaded fresh structure).
      cache.bytes = createTextScanIndex();
      cache.generation = meta.generation;
      cache.through = max;
    } else if (cache.through < (max ?? 0)) {
      const changed = prepare(`SELECT ref_key, prefix_key, text FROM ${quoteIdentifier(entry.table)} WHERE seq > ?`)
        .all(cache.through) as unknown as { ref_key: string; prefix_key: string | null; text: string }[];
      for (const row of changed) {
        if (row.prefix_key === null) {
          // F1: the composite-prefix marker; the refKey leaves the cache for
          // every prefix. Bucket loads never match a NULL prefix_key.
          removeTextScanRow(cache.bytes, row.ref_key);
          continue;
        }
        moveCatchUpRow(
          cache.bytes,
          row.ref_key,
          JSON.parse(row.prefix_key) as string,
          JSON.parse(row.text) as string,
        );
      }
      cache.through = max;
    }
    const prefixKey = encodeLookupValues(request.values);
    let bucket = cache.bytes.buckets.get(prefixKey);
    if (bucket === undefined || !bucket.loaded) {
      // S1.7: BINARY ref_key order equals compareRefKeys.
      const rows = prepare(
          `SELECT ref_key, text FROM ${quoteIdentifier(entry.table)} WHERE prefix_key = ? ORDER BY ref_key`,
        )
        .all(JSON.stringify(prefixKey)) as unknown as { ref_key: string; text: string }[];
      loadBucket(
        cache.bytes,
        prefixKey,
        rows.map((row) => ({ refKey: row.ref_key, text: JSON.parse(row.text) as string })),
      );
      bucket = cache.bytes.buckets.get(prefixKey)!;
    }
    mergePending(cache.bytes, prefixKey);
    const page = scanEntries(bucket.entries, request.terms, request.match, request.after, request.limit);
    return { status: "ready", refKeys: page.refKeys, next: page.next, complete: page.complete };
  };

  const close = (): void => {
    for (const entry of caches.values()) clearTextScanIndex(entry.bytes);
    caches.clear();
  };

  return { indexRecord, advanceThrough, searchText, close };
}
