/**
 * RecordStore schema initialisation + the original 4-table compatibility check
 * (R3a §3.1 "migrations.ts 原4表兼容检查和新库初始化").
 *
 * The physical schema is the legacy StateLedger schema, unchanged: `events`,
 * `snapshots`, `idempotency`, `identity_claims`. This module never drops,
 * rebuilds or rewrites anything, and never touches any other table: `memory_*`
 * and every other business table in the same file must survive untouched.
 *
 * A brand-new database gets the original DDL. An existing database is checked
 * for the columns, primary keys and declared type affinities the store needs;
 * an incompatible file fails loudly instead of being repaired by data loss.
 */
import type { DatabaseSync } from "node:sqlite";

/** The original StateLedger DDL, byte-compatible with the legacy adapter. */
export const CORE_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_json TEXT NOT NULL);" +
  "CREATE TABLE IF NOT EXISTS snapshots (ref_key TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);" +
  "CREATE TABLE IF NOT EXISTS idempotency (identity_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, event_ids_json TEXT NOT NULL, aggregate_revisions_json TEXT NOT NULL, commit_cursor TEXT NOT NULL);" +
  "CREATE TABLE IF NOT EXISTS identity_claims (claim_key TEXT PRIMARY KEY, owner_key TEXT NOT NULL);";

type Affinity = "INTEGER" | "TEXT" | "REAL" | "BLOB" | "NUMERIC";

type ExpectedColumn = {
  name: string;
  affinity: Affinity;
  primaryKey: boolean;
};

type ExpectedTable = {
  name: string;
  columns: readonly ExpectedColumn[];
};

const CORE_TABLES: readonly ExpectedTable[] = [
  {
    name: "events",
    columns: [
      { name: "id", affinity: "INTEGER", primaryKey: true },
      { name: "event_json", affinity: "TEXT", primaryKey: false },
    ],
  },
  {
    name: "snapshots",
    columns: [
      { name: "ref_key", affinity: "TEXT", primaryKey: true },
      { name: "snapshot_json", affinity: "TEXT", primaryKey: false },
    ],
  },
  {
    name: "idempotency",
    columns: [
      { name: "identity_key", affinity: "TEXT", primaryKey: true },
      { name: "fingerprint", affinity: "TEXT", primaryKey: false },
      { name: "event_ids_json", affinity: "TEXT", primaryKey: false },
      { name: "aggregate_revisions_json", affinity: "TEXT", primaryKey: false },
      { name: "commit_cursor", affinity: "TEXT", primaryKey: false },
    ],
  },
  {
    name: "identity_claims",
    columns: [
      { name: "claim_key", affinity: "TEXT", primaryKey: true },
      { name: "owner_key", affinity: "TEXT", primaryKey: false },
    ],
  },
];

export type SchemaCompatibility = { compatible: boolean; problems: string[] };

type TableInfoRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

/** SQLite type affinity per the documented rules (declared type -> affinity). */
function affinityOf(declaredType: string): Affinity {
  const declared = declaredType.toUpperCase();
  if (declared.includes("INT")) return "INTEGER";
  if (declared.includes("CHAR") || declared.includes("CLOB") || declared.includes("TEXT")) return "TEXT";
  if (declared.includes("BLOB") || declared.length === 0) return "BLOB";
  if (declared.includes("REAL") || declared.includes("FLOA") || declared.includes("DOUB")) return "REAL";
  return "NUMERIC";
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as
    | { name: string }
    | undefined;
  return row !== undefined;
}

/**
 * Check an open database for the original 4-table physical contract. Reports
 * every problem instead of failing on the first one, so an incompatible file is
 * diagnosable without touching it.
 */
export function checkRecordStoreSchema(db: DatabaseSync): SchemaCompatibility {
  const problems: string[] = [];
  for (const table of CORE_TABLES) {
    if (!tableExists(db, table.name)) {
      problems.push(`missing table ${table.name}`);
      continue;
    }
    const rows = db.prepare(`PRAGMA table_info(${table.name})`).all() as unknown as TableInfoRow[];
    const byName = new Map(rows.map((row) => [row.name, row]));
    const primaryKey = rows
      .filter((row) => row.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((row) => row.name);
    const expectedPrimaryKey = table.columns.filter((column) => column.primaryKey).map((column) => column.name);
    if (primaryKey.join(",") !== expectedPrimaryKey.join(",")) {
      problems.push(`table ${table.name} primary key is [${primaryKey.join(",")}], expected [${expectedPrimaryKey.join(",")}]`);
    }
    for (const column of table.columns) {
      const found = byName.get(column.name);
      if (found === undefined) {
        problems.push(`table ${table.name} is missing column ${column.name}`);
        continue;
      }
      const affinity = affinityOf(found.type);
      if (affinity !== column.affinity) {
        problems.push(`table ${table.name}.${column.name} has affinity ${affinity}, expected ${column.affinity}`);
      }
    }
    // Extra columns are tolerated unless our INSERT (which names only the
    // original columns) would be rejected by them.
    for (const row of rows) {
      if (table.columns.some((column) => column.name === row.name)) continue;
      if (row.notnull === 1 && row.dflt_value === null && row.pk === 0) {
        problems.push(`table ${table.name} has extra NOT NULL column ${row.name} without a default`);
      }
    }
  }
  return { compatible: problems.length === 0, problems };
}

/**
 * Create the 4 core tables when they do not exist yet and verify the physical
 * contract of the ones that do. Throws with every incompatibility listed; the
 * caller closes the connection and rethrows the original error.
 */
export function initRecordStoreSchema(db: DatabaseSync): void {
  db.exec(CORE_TABLE_DDL);
  const compatibility = checkRecordStoreSchema(db);
  if (!compatibility.compatible) {
    throw new Error(
      `RecordStore: existing database is not compatible with the 4-core-table schema: ${compatibility.problems.join("; ")}`,
    );
  }
}
