/**
 * Slice 4B L10 SQLite full-text candidate table (lead P5).
 *
 * This file owns the FTS5 table for every registered full-text index. It is
 * called by the SQLite RecordStore backend: at open it probes FTS5 and creates
 * or rebuilds the tables, and inside the one snapshot write transaction
 * `indexRecord` keeps a record's window row current. `migrations.ts` is
 * untouched (P5).
 *
 * `tokenize = 'unicode61'`; each record is stored as the de-duplicated set of
 * overlapping non-whitespace two-code-point windows, one ASCII token
 * `b<hex1>_<hex2>` per window (the encoding is `bigramWindows`). A query ANDs
 * the terms' windows, so the result is a superset of the real substring
 * matches; the backend rechecks the substring rule on each candidate.
 *
 * The small own table `next_fts_meta` keeps one row per full-text index: the
 * registration `code` (a digest of the index name, aggregate type, prefix
 * paths, text paths and `TEXT_SEARCH_RULE_VERSION`) and `through`, the
 * `events.id` the table has been maintained through. The row is written in the
 * same transaction as the rebuild and advanced in the same transaction as every
 * indexed write. A missing table, a different code or a `through` behind the
 * ledger's current maximum drops and rebuilds that index's table from the head
 * records before the store answers; a `through` that falls behind while the
 * store is open makes `searchText` answer `unavailable` / `index_not_ready`.
 *
 * This file imports no WorkGraph module.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RecordLookupRegistry, RegisteredLookupIndex } from "./lookup-index.js";
import { bigramWindows, searchTextFrom } from "./lookup-index.js";
import { isJsonObject } from "./record-codec.js";

/** Bumped when the normalization/window rule changes; part of every table code. */
export const TEXT_SEARCH_RULE_VERSION = 1;

/** The small table this file owns, storing one code per full-text index. */
const META_TABLE = "next_fts_meta";

/** Quote one SQL identifier; registered lookup names are logical, never SQL. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Deterministic short suffix so two index names cannot collide after sanitizing. */
function tableSuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (let position = 0; position < value.length; position += 1) {
    hash ^= value.charCodeAt(position);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as
    | { name: string }
    | undefined;
  return row !== undefined;
}

/** The FTS5 availability probe: a temporary table, one Chinese and one English sample. */
function fts5Probe(db: DatabaseSync): boolean {
  try {
    db.exec("DROP TABLE IF EXISTS temp.next_fts_probe");
    db.exec("CREATE VIRTUAL TABLE temp.next_fts_probe USING fts5(sample, tokenize='unicode61')");
    const insert = db.prepare("INSERT INTO temp.next_fts_probe(sample) VALUES (?)");
    insert.run("架构");
    insert.run("graph");
    const zh = db.prepare("SELECT count(*) AS total FROM temp.next_fts_probe WHERE sample MATCH ?").get("架构") as
      | { total: number | bigint }
      | undefined;
    const en = db.prepare("SELECT count(*) AS total FROM temp.next_fts_probe WHERE sample MATCH ?").get("graph") as
      | { total: number | bigint }
      | undefined;
    return Number(zh?.total ?? 0) === 1 && Number(en?.total ?? 0) === 1;
  } catch {
    return false;
  } finally {
    try {
      db.exec("DROP TABLE IF EXISTS temp.next_fts_probe");
    } catch {
      // the probe table is best-effort cleanup
    }
  }
}

function codeOf(definition: RegisteredLookupIndex, textPaths: readonly string[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: definition.name,
        aggregateType: definition.aggregateType,
        prefixPaths: definition.paths,
        textPaths,
        ruleVersion: TEXT_SEARCH_RULE_VERSION,
      }),
    )
    .digest("hex");
}

type TextIndex = {
  readonly definition: RegisteredLookupIndex;
  readonly textPaths: readonly string[];
  readonly table: string;
};

export type CandidatePage = { readonly refKeys: string[]; readonly hasMore: boolean };

export type SqliteTextSearch = {
  /** False when FTS5 is unavailable; the port then answers `unsupported`. */
  readonly available: boolean;
  /** Update the window rows for one written record of `aggregateType`. */
  indexRecord(refKey: string, aggregateType: string, body: Record<string, unknown>): void;
  /**
   * Advance the maintained-through cursor after this commit's events were
   * appended. The update only applies to a table that was current through
   * `previousMax`, so another writer's gap is never silently covered.
   */
  advanceThrough(previousMax: number | null, lastEventId: number): void;
  /** True when the index's table is maintained through the ledger's current max. */
  isCurrent(indexName: string): boolean;
  /** Window-superset candidates for the ANDed term windows, in refKey byte order. */
  candidates(
    index: RegisteredLookupIndex,
    values: readonly string[],
    windows: readonly string[],
    after: string | null,
    limit: number,
  ): CandidatePage;
};

export function createSqliteTextSearch(
  db: DatabaseSync,
  lookups: RecordLookupRegistry,
  probe?: () => boolean,
): SqliteTextSearch {
  let available: boolean;
  try {
    available = (probe ?? (() => fts5Probe(db)))() === true;
  } catch {
    available = false;
  }
  if (!available) {
    return {
      available: false,
      indexRecord: () => undefined,
      advanceThrough: () => undefined,
      isCurrent: () => false,
      candidates: () => ({ refKeys: [], hasMore: false }),
    };
  }

  db.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(META_TABLE)}(name TEXT PRIMARY KEY, code TEXT NOT NULL, through INTEGER)`,
  );
  // A round-1 store carries a `next_fts_meta` without `through`; add it in
  // place. The column is nullable, so existing rows need no backfill: a null
  // `through` with a non-empty ledger is a mismatch and rebuilds at open.
  const metaColumns = db.prepare(`PRAGMA table_info(${quoteIdentifier(META_TABLE)})`).all() as unknown as { name: string }[];
  if (!metaColumns.some((column) => column.name === "through")) {
    db.exec(`ALTER TABLE ${quoteIdentifier(META_TABLE)} ADD COLUMN through INTEGER`);
  }
  const readMeta = db.prepare(`SELECT code, through FROM ${quoteIdentifier(META_TABLE)} WHERE name = ?`);
  const writeMeta = db.prepare(
    `INSERT INTO ${quoteIdentifier(META_TABLE)}(name, code, through) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET code = excluded.code, through = excluded.through`,
  );

  /** The ledger's current maximum event id; null when the ledger is empty. */
  const readMaxEventId = (): number | null => {
    const row = db.prepare("SELECT MAX(id) AS max_id FROM events").get() as { max_id: number | bigint | null } | undefined;
    const max = row?.max_id;
    return max === null || max === undefined ? null : Number(max);
  };
  const normalizedThrough = (value: number | bigint | null | undefined): number | null =>
    value === null || value === undefined ? null : Number(value);

  const indexes: TextIndex[] = [];
  const byAggregate = new Map<string, TextIndex[]>();
  for (const definition of lookups.indexes) {
    const text = definition.text;
    if (text === undefined) continue;
    const table = `next_fts_${definition.name.replace(/[^A-Za-z0-9_]/g, "_")}_${tableSuffix(definition.name)}`;
    const code = codeOf(definition, text.paths);
    const stored = readMeta.get(definition.name) as { code: string; through: number | bigint | null } | undefined;
    if (
      stored?.code !== code ||
      !tableExists(db, table) ||
      normalizedThrough(stored?.through) !== readMaxEventId()
    ) {
      // One BEGIN IMMEDIATE ... COMMIT per index: DROP, CREATE, insert the head
      // rows and publish (code, through) together, so a throw leaves the old
      // table and its meta row exactly as they were (L10 rebuild atomicity).
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
        db.exec(
          `CREATE VIRTUAL TABLE ${quoteIdentifier(table)} USING fts5(ref_key UNINDEXED, windows, tokenize='unicode61')`,
        );
        const insert = db.prepare(
          `INSERT INTO ${quoteIdentifier(table)}(ref_key, windows) VALUES (?, ?)`,
        );
        const rows = db
          .prepare(
            `SELECT ref_key, snapshot_json FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = ?`,
          )
          .all(definition.aggregateType) as unknown as { ref_key: string; snapshot_json: string }[];
        for (const row of rows) {
          // A rebuild reads trusted head records: a non-text, unparsable or
          // non-object snapshot is corrupt, so the open must fail (the backend
          // closes and rethrows) instead of answering from an incomplete index.
          if (typeof row.snapshot_json !== "string") {
            throw new Error(`full-text rebuild: snapshot ${row.ref_key} is not stored as text`);
          }
          let body: unknown;
          try {
            body = JSON.parse(row.snapshot_json);
          } catch (error) {
            throw new Error(
              `full-text rebuild: snapshot ${row.ref_key} is damaged: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          if (!isJsonObject(body)) {
            throw new Error(`full-text rebuild: snapshot ${row.ref_key} is not a JSON object`);
          }
          insert.run(row.ref_key, bigramWindows(searchTextFrom(body, text.paths)).join(" "));
        }
        // Read MAX(id) inside the transaction so `through` matches the snapshot
        // the inserts were built from.
        writeMeta.run(definition.name, code, readMaxEventId());
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
    const entry: TextIndex = { definition, textPaths: text.paths, table };
    indexes.push(entry);
    const group = byAggregate.get(definition.aggregateType);
    if (group === undefined) byAggregate.set(definition.aggregateType, [entry]);
    else group.push(entry);
  }
  const tableByName = new Map(indexes.map((entry) => [entry.definition.name, entry]));

  const indexRecord = (refKey: string, aggregateType: string, body: Record<string, unknown>): void => {
    const group = byAggregate.get(aggregateType);
    if (group === undefined) return;
    for (const entry of group) {
      const windows = bigramWindows(searchTextFrom(body, entry.textPaths));
      // Replace this refKey's row: the head is upserted, so a previous text
      // version must not stay a candidate (L10: the FTS table changes with the
      // snapshot in the same transaction).
      db.prepare(`DELETE FROM ${quoteIdentifier(entry.table)} WHERE ref_key = ?`).run(refKey);
      db.prepare(`INSERT INTO ${quoteIdentifier(entry.table)}(ref_key, windows) VALUES (?, ?)`).run(
        refKey,
        windows.join(" "),
      );
    }
  };

  const advanceThrough = (previousMax: number | null, lastEventId: number): void => {
    if (indexes.length === 0) return;
    // Only a table that was current through the ledger's pre-commit maximum is
    // maintained through the appended events; `through IS ?` is the null-safe
    // equality (an empty ledger has `through: null`).
    const names = indexes.map((entry) => entry.definition.name);
    const placeholders = names.map(() => "?").join(", ");
    db.prepare(
      `UPDATE ${quoteIdentifier(META_TABLE)} SET through = ? WHERE name IN (${placeholders}) AND through IS ?`,
    ).run(lastEventId, ...names, previousMax);
  };

  const isCurrent = (indexName: string): boolean => {
    if (!tableByName.has(indexName)) return false;
    const row = db.prepare(`SELECT through FROM ${quoteIdentifier(META_TABLE)} WHERE name = ?`).get(indexName) as
      | { through: number | bigint | null }
      | undefined;
    if (row === undefined) return false;
    return normalizedThrough(row.through) === readMaxEventId();
  };

  const candidates = (
    index: RegisteredLookupIndex,
    values: readonly string[],
    windows: readonly string[],
    after: string | null,
    limit: number,
  ): CandidatePage => {
    const entry = tableByName.get(index.name);
    // `candidates` is only called with an index decoded from this registry, so
    // a miss is a programming error worth failing loudly, never an empty answer.
    if (entry === undefined) throw new Error(`full-text index ${index.name} has no candidate table`);
    // The equality prefix is resolved from the record BODY (the same
    // `json_extract` path family the generic lookup uses), never from the
    // canonical refKey, so a nested path such as `ref.projectId` works exactly
    // as it does in the in-memory backend.
    const conditions: string[] = [`json_extract(f.ref_key, '$.aggregateType') = ?`];
    const params: (string | number)[] = [index.aggregateType];
    for (let position = 0; position < index.paths.length; position += 1) {
      conditions.push(`json_extract(s.snapshot_json, ${`'$.${index.paths[position]!.replace(/'/g, "''")}'`}) = ?`);
      params.push(values[position] ?? "");
    }
    if (after !== null) {
      conditions.push("f.ref_key COLLATE BINARY > ?");
      params.push(after);
    }
    const match = windows.join(" ");
    const bound = Math.max(0, limit) + 1;
    const rows = db
      .prepare(
        `SELECT f.ref_key AS ref_key FROM ${quoteIdentifier(entry.table)} f` +
          ` JOIN snapshots s ON s.ref_key = f.ref_key` +
          ` WHERE f.windows MATCH ? AND ${conditions.join(" AND ")}` +
          ` ORDER BY f.ref_key COLLATE BINARY ASC LIMIT ?`,
      )
      .all(match, ...params, bound) as unknown as { ref_key: string }[];
    const hasMore = rows.length > Math.max(0, limit);
    return { refKeys: rows.slice(0, Math.max(0, limit)).map((row) => row.ref_key), hasMore };
  };

  return { available: true, indexRecord, advanceThrough, isCurrent, candidates };
}
