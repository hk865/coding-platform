/**
 * Speed round 2 (R2-2/R2-3/R2-4, decision 66): one partial expression index per
 * registered lookup, each covering only its own aggregate type, plus the
 * open-time migration that creates any missing index.
 *
 * `migrateLookupIndexes` replaces round 1's `createLookupIndexes`. It plans
 * outside any transaction and only when there is work runs one
 * `BEGIN IMMEDIATE` ... `COMMIT` so a crash leaves no half-created ledger; a
 * steady-state open plans nothing and runs no transaction.
 *
 * This module imports no WorkGraph module, opens no connection and never
 * exposes SQL to a caller.
 */
import type { DatabaseSync } from "node:sqlite";
import type { RecordLookupRegistry, RegisteredLookupIndex } from "./lookup-index.js";
import { aggregateTypeTerm } from "./sqlite-sql-literals.js";

/**
 * R2-3: bump on every semantic change to the DDL below. Any text change in
 * `lookupIndexBody` (or this constant) renames every index and makes every
 * ledger migrate once.
 */
export const LOOKUP_INDEX_RULE_VERSION = 2;

/** Deterministic short suffix so a changed type, path set or rule is distinct. */
function lookupIndexSuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (let position = 0; position < value.length; position += 1) {
    hash ^= value.charCodeAt(position);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Validated paths are plain member names; quote is belt-and-braces only. */
function lookupJsonPath(path: string): string {
  return `'$.${path.replace(/'/g, "''")}'`;
}

/** Quote one SQL identifier; registered lookup names are logical, never SQL. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * The DDL body after the index name, hashed for the name and run verbatim. The
 * partial `WHERE` comes from the same `aggregateTypeTerm` the queries use
 * (R2-4), and no path gets an `IS NOT NULL`.
 */
function lookupIndexBody(index: RegisteredLookupIndex): string {
  const columns: string[] = [`json_extract(ref_key, '$.aggregateType')`];
  for (const path of index.paths) {
    const jsonPath = lookupJsonPath(path);
    columns.push(`json_type(snapshot_json, ${jsonPath})`);
    columns.push(`json_extract(snapshot_json, ${jsonPath})`);
  }
  // Slice 2A L1: the ordered column follows the equality prefix, exactly the
  // ORDER BY expression. The order value type is not part of the DDL, so a
  // registration that changes only `valueType` keeps the same index name.
  if (index.orderBy !== undefined) columns.push(`json_extract(snapshot_json, ${lookupJsonPath(index.orderBy.path)})`);
  columns.push("ref_key");
  return `ON snapshots (${columns.join(", ")}) WHERE ${aggregateTypeTerm(index.aggregateType)}`;
}

type ExpectedIndex = { readonly create: string };

/** Expected physical name to its one `CREATE INDEX` statement. */
function expectedIndexes(lookups: RecordLookupRegistry): Map<string, ExpectedIndex> {
  const expected = new Map<string, ExpectedIndex>();
  for (const index of lookups.indexes) {
    const body = lookupIndexBody(index);
    // R2-3: version, raw registered name and the exact DDL body after the name.
    const name = `next_lookup_${index.name.replace(/[^A-Za-z0-9_]/g, "_")}_${lookupIndexSuffix(
      `${LOOKUP_INDEX_RULE_VERSION}\u0000${index.name}\u0000${body}`,
    )}`;
    expected.set(name, { create: `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(name)} ${body}` });
  }
  return expected;
}

type StoredIndex = { readonly name: string };

function existingLookupIndexes(db: DatabaseSync): StoredIndex[] {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'snapshots' AND name LIKE 'next\\_lookup\\_%' ESCAPE '\\'",
  ).all() as unknown as StoredIndex[];
  return rows.filter((row) => row.name.startsWith("next_lookup_"));
}

type MigrationPlan = { readonly create: readonly string[] };

function planMigration(db: DatabaseSync, expected: Map<string, ExpectedIndex>): MigrationPlan {
  const existing = new Set<string>();
  for (const row of existingLookupIndexes(db)) existing.add(row.name);
  const create: string[] = [];
  for (const name of expected.keys()) if (!existing.has(name)) create.push(name);
  return { create };
}

/**
 * Bring the `next_lookup_*` indexes on `snapshots` up to this backend's
 * registration. No work is no transaction; otherwise create every missing
 * index in one `BEGIN IMMEDIATE` transaction, re-planned inside it because
 * another process may have migrated meanwhile. A throw rolls back and
 * rethrows, and the SQLite factory closes the connection as it already does.
 */
export function migrateLookupIndexes(db: DatabaseSync, lookups: RecordLookupRegistry): void {
  const expected = expectedIndexes(lookups);
  const before = planMigration(db, expected);
  if (before.create.length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const inside = planMigration(db, expected);
    for (const name of inside.create) db.exec(expected.get(name)!.create);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // A failed COMMIT may already have ended the transaction; the original wins.
    }
    throw error;
  }
}
