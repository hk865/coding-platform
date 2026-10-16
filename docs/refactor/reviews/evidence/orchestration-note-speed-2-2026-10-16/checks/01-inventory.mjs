#!/usr/bin/env node
// R2-MEASURE step 2+3: list every next_lookup_* index on a COPY, map it to the
// aggregateType it serves (by recomputing the FNV-1a name suffix that
// createLookupIndexes derives from `aggregateType\0paths[\0orderPath\0valueType]`),
// rows per aggregateType, and dbstat bytes per index/table. READ-ONLY.
// usage: node 01-inventory.mjs <db> <out.json> [extraTypesCsv]
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const [dbPath, outFile, extraCsv = ''] = process.argv.slice(2);
if (!dbPath.includes('/r2-measure/')) throw new Error('refusing: only files under r2-measure');
const db = new DatabaseSync(dbPath, { readOnly: true });

function fnv(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const rowsPerType = db.prepare(`SELECT json_extract(ref_key, '$.aggregateType') AS t, COUNT(*) AS n,
  SUM(length(snapshot_json)) AS bytes FROM snapshots GROUP BY t ORDER BY n DESC`).all().map(r => ({ type: r.t, rows: Number(r.n), jsonBytes: Number(r.bytes) }));
const totalRows = rowsPerType.reduce((a, r) => a + r.rows, 0);
const types = new Set([...rowsPerType.map(r => r.type), ...extraCsv.split(',').filter(Boolean)]);

const all = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name`).all();
const lookupIdx = all.filter(r => r.type === 'index' && r.name.startsWith('next_lookup_'));
const otherIdx = all.filter(r => r.type === 'index' && !r.name.startsWith('next_lookup_'));

// dbstat aggregate per object
let stat = [];
try {
  stat = db.prepare(`SELECT name, COUNT(*) AS pages, SUM(pgsize) AS bytes, SUM(payload) AS payload, SUM(unused) AS unused FROM dbstat GROUP BY name`).all()
    .map(r => ({ name: r.name, pages: Number(r.pages), bytes: Number(r.bytes), payload: Number(r.payload), unused: Number(r.unused) }));
} catch (e) { stat = [{ error: String(e) }]; }
const statBy = new Map(stat.map(s => [s.name, s]));
const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size);
const pageCount = Number(db.prepare('PRAGMA page_count').get().page_count);
const freelist = Number(db.prepare('PRAGMA freelist_count').get().freelist_count);

const indexes = [];
for (const idx of lookupIdx) {
  const m = /ON\s+snapshots\s*\((.*)\)\s*(WHERE\s+(.*))?$/s.exec(idx.sql);
  const cols = m[1];
  const where = m[3] ?? null;
  const typePaths = [...cols.matchAll(/json_type\(snapshot_json, '\$\.([^']+)'\)/g)].map(x => x[1]);
  const extractPaths = [...cols.matchAll(/json_extract\(snapshot_json, '\$\.([^']+)'\)/g)].map(x => x[1]);
  const orderPath = extractPaths.length > typePaths.length ? extractPaths[extractPaths.length - 1] : null;
  const suffix = idx.name.slice(-8);
  const logical = idx.name.slice('next_lookup_'.length, -9);
  const matches = [];
  const whereType = where === null ? null : (/= '([A-Za-z0-9_]+)'/.exec(where)?.[1] ?? null);
  if (whereType !== null) matches.push({ type: whereType, valueType: null, via: 'where' });
  for (const t of (whereType === null ? types : [])) {
    if (orderPath === null) {
      if (fnv(`${t}\u0000${typePaths.join('\u0000')}`) === suffix) matches.push({ type: t, valueType: null });
    } else {
      for (const vt of ['text', 'integer']) {
        if (fnv(`${t}\u0000${typePaths.join('\u0000')}\u0000${orderPath}\u0000${vt}`) === suffix) matches.push({ type: t, valueType: vt });
      }
    }
  }
  const s = statBy.get(idx.name);
  indexes.push({ name: idx.name, logical, aggregateType: matches.length === 1 ? matches[0].type : null, orderValueType: matches[0]?.valueType ?? null,
    matches, paths: typePaths, orderPath, where, sql: idx.sql, bytes: s?.bytes ?? null, pages: s?.pages ?? null });
}

const byType = {};
for (const i of indexes) {
  const t = i.aggregateType ?? '(unmatched)';
  byType[t] ??= { rows: rowsPerType.find(r => r.type === t)?.rows ?? 0, indexes: 0, bytes: 0, names: [] };
  byType[t].indexes += 1; byType[t].bytes += i.bytes ?? 0; byType[t].names.push(i.logical);
}
const lookupBytes = indexes.reduce((a, i) => a + (i.bytes ?? 0), 0);
const out = {
  db: dbPath, sqliteVersion: db.prepare('select sqlite_version() v').get().v,
  pageSize, pageCount, freelist, fileBytesFromPages: pageSize * pageCount,
  totalSnapshotRows: totalRows, rowsPerType,
  lookupIndexCount: indexes.length, lookupIndexBytes: lookupBytes,
  unmatched: indexes.filter(i => i.aggregateType === null).map(i => ({ name: i.name, matches: i.matches })),
  byType, indexes,
  otherIndexes: otherIdx.map(r => ({ name: r.name, tbl: r.tbl_name, sql: r.sql, bytes: statBy.get(r.name)?.bytes ?? null })),
  tables: all.filter(r => r.type === 'table').map(r => ({ name: r.name, bytes: statBy.get(r.name)?.bytes ?? null })),
  statTop: [...stat].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 25),
};
db.close();
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ pageSize, pageCount, freelist, totalRows, lookupIndexCount: indexes.length, lookupBytes, unmatched: out.unmatched, rowsPerType, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { rows: v.rows, indexes: v.indexes, MB: +(v.bytes / 1048576).toFixed(1) }])) }, null, 1));
