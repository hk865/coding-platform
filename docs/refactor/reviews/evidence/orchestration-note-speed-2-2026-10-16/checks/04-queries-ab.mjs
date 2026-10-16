#!/usr/bin/env node
// R2-MEASURE step 5: EXPLAIN QUERY PLAN, re-prepare count and timing for the
// real RecordStore query shapes (sqlite-record-store.ts lookupInside :580-617,
// lookupOrderedInside :634-717, countInside :733-787, readManyInside :387,
// readThrough :333; plus the open-time type scan of sqlite-text-search.ts:205),
// each with aggregateType bound (?) and literal, LIMIT always literal (round-1
// power of two: limit 200 -> 256, limit 50 -> 64). READ-ONLY.
// Re-prepare detection: the authorizer callback runs on every compile, so
// authorizer calls during .all()/.get() of an already prepared statement =
// a re-prepare on that execution (validated in 00-mechanism-check.mjs).
// usage: node 04-queries-ab.mjs <full.sqlite> <partial.sqlite> <label> <out.json>
import { DatabaseSync, constants } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const [dbPath, dbPathB, label, outFile] = process.argv.slice(2);
if (!dbPath.includes('/r2-measure/') || !dbPathB.includes('/r2-measure/')) throw new Error('refusing');
const db = new DatabaseSync(dbPath, { readOnly: true });
const dbB = new DatabaseSync(dbPathB, { readOnly: true });
const P = 'm4b-project';
const W = 'm4b-workspace';
const MAX = 9007199254740991;

const jp = p => `'$.${p}'`;
const textEq = p => `json_type(snapshot_json, ${jp(p)}) = 'text' AND json_extract(snapshot_json, ${jp(p)}) = ?`;
const isNull = p => `json_extract(snapshot_json, ${jp(p)}) IS NULL`;
const ox = p => `json_extract(snapshot_json, ${jp(p)})`;
const TYPE = `json_extract(ref_key, '$.aggregateType')`;

// Runtime-derived continuation values (identical data in both files).
const lit = `${TYPE} = 'NoteHead'`;
const smallAnchor = 'file:src/m00/sub1/file05.ts';
const smallRows = db.prepare(`SELECT ref_key FROM snapshots WHERE ${lit} AND ${textEq('ref.projectId')} AND ${textEq('anchorKey0')} ORDER BY ref_key COLLATE BINARY ASC LIMIT 256`).all(P, smallAnchor);
const smallAfter = smallRows[0].ref_key;
const pathWanted = 'file:src/m08/sub3/';
const pathPage = db.prepare(`SELECT ref_key, ${ox('anchorKey0')} AS o FROM snapshots WHERE ${lit} AND ${textEq('ref.projectId')} AND json_type(snapshot_json, ${jp('anchorKey0')}) = 'text' AND ${ox('anchorKey0')} <> '' AND ${ox('anchorKey0')} >= ? ORDER BY ${ox('anchorKey0')} ASC, ref_key COLLATE BINARY ASC LIMIT 256`).all(P, pathWanted);
const pathAfter = pathPage[199];
const planRev = db.prepare(`SELECT ref_key, ${ox('acceptedAt')} AS o FROM snapshots WHERE ${TYPE} = 'PlanRevision' AND ${textEq('goalRef.projectId')} AND ${textEq('goalRef.goalId')}`).get(P, 'g000');
const catalog = db.prepare(`SELECT ref_key, ${ox('ref.revision')} AS o FROM snapshots WHERE ${TYPE} = 'ArchitectureCatalog'`).get();
const noteHeadRef = smallRows[1].ref_key;

// Each case: type, where (after the type term), params (after the type value), tail.
const cases = [
  // lookupInside: ORDER BY ref_key COLLATE BINARY ASC LIMIT <literal>
  { name: 'lookup_note_anchor_small', shape: 'lookupInside', type: 'NoteHead', where: [textEq('ref.projectId'), textEq('anchorKey0')], params: [P, smallAnchor], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 256' },
  { name: 'lookup_note_anchor_small_after', shape: 'lookupInside+after', type: 'NoteHead', where: [textEq('ref.projectId'), textEq('anchorKey0'), 'ref_key COLLATE BINARY > ?'], params: [P, smallAnchor, smallAfter], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 256' },
  { name: 'lookup_note_anchor_empty', shape: 'lookupInside', type: 'NoteHead', where: [textEq('ref.projectId'), textEq('anchorKey3')], params: [P, 'project'], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 256' },
  { name: 'lookup_note_anchor_page456', shape: 'lookupInside', type: 'NoteHead', where: [textEq('ref.projectId'), textEq('anchorKey0')], params: [P, 'project'], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 256' },
  { name: 'lookup_note_staged_null', shape: 'lookupInside(null matcher)', type: 'NoteHead', where: [textEq('ref.projectId'), isNull('stagedRunKey')], params: [P], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 32' },
  { name: 'lookup_run_by_goal_small', shape: 'lookupInside', type: 'Run', where: [textEq('ref.projectId'), textEq('ref.goalId')], params: [P, 'g000'], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 256' },
  { name: 'lookup_session_by_workspace_page', shape: 'lookupInside', type: 'Session', where: [textEq('ref.projectId'), textEq('workspaceId')], params: [P, W], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 256' },
  { name: 'lookup_message_empty_type', shape: 'lookupInside', type: 'SessionMessage', where: [textEq('ref.projectId'), textEq('ref.workspaceId'), textEq('recipient.sessionId')], params: [P, W, 'session-x'], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 256' },
  { name: 'lookup_worklink_null_empty_type', shape: 'lookupInside(null matcher)', type: 'SessionWorkLink', where: [textEq('ref.projectId'), textEq('ref.sessionId'), textEq('ref.relation'), isNull('until')], params: [P, 'session-x', 'executes'], tail: 'ORDER BY ref_key COLLATE BINARY ASC LIMIT 256' },
  // lookupOrderedInside
  { name: 'ordered_note_path_asc_bound', shape: 'lookupOrderedInside asc, bound', type: 'NoteHead', where: [textEq('ref.projectId'), `json_type(snapshot_json, ${jp('anchorKey0')}) = 'text'`, `${ox('anchorKey0')} <> ''`, `${ox('anchorKey0')} >= ?`], params: [P, pathWanted], tail: `ORDER BY ${ox('anchorKey0')} ASC, ref_key COLLATE BINARY ASC LIMIT 256` },
  { name: 'ordered_note_path_asc_after', shape: 'lookupOrderedInside asc, after (keyset)', type: 'NoteHead', where: [textEq('ref.projectId'), `json_type(snapshot_json, ${jp('anchorKey0')}) = 'text'`, `${ox('anchorKey0')} <> ''`, `${ox('anchorKey0')} >= ?`, `(${ox('anchorKey0')}, ref_key COLLATE BINARY) > (?, ?)`], params: [P, pathAfter.o, pathAfter.o, pathAfter.ref_key], tail: `ORDER BY ${ox('anchorKey0')} ASC, ref_key COLLATE BINARY ASC LIMIT 256` },
  { name: 'ordered_note_path_desc_bound', shape: 'lookupOrderedInside desc, bound', type: 'NoteHead', where: [textEq('ref.projectId'), `json_type(snapshot_json, ${jp('anchorKey0')}) = 'text'`, `${ox('anchorKey0')} <> ''`, `${ox('anchorKey0')} <= ?`], params: [P, pathWanted], tail: `ORDER BY ${ox('anchorKey0')} DESC, ref_key COLLATE BINARY DESC LIMIT 256` },
  { name: 'ordered_planrev_desc_small', shape: 'lookupOrderedInside desc', type: 'PlanRevision', where: [textEq('goalRef.projectId'), textEq('goalRef.goalId'), `json_type(snapshot_json, ${jp('acceptedAt')}) = 'text'`, `${ox('acceptedAt')} <> ''`], params: [P, 'g000'], tail: `ORDER BY ${ox('acceptedAt')} DESC, ref_key COLLATE BINARY DESC LIMIT 64` },
  { name: 'ordered_planrev_desc_after_empty', shape: 'lookupOrderedInside desc, after (keyset)', type: 'PlanRevision', where: [textEq('goalRef.projectId'), textEq('goalRef.goalId'), `json_type(snapshot_json, ${jp('acceptedAt')}) = 'text'`, `${ox('acceptedAt')} <> ''`, `${ox('acceptedAt')} <= ?`, `(${ox('acceptedAt')}, ref_key COLLATE BINARY) < (?, ?)`], params: [P, 'g000', planRev.o, planRev.o, planRev.ref_key], tail: `ORDER BY ${ox('acceptedAt')} DESC, ref_key COLLATE BINARY DESC LIMIT 64` },
  { name: 'ordered_catalog_int_desc_small', shape: 'lookupOrderedInside desc, integer', type: 'ArchitectureCatalog', where: [textEq('ref.projectId'), `json_type(snapshot_json, ${jp('ref.revision')}) = 'integer'`, `${ox('ref.revision')} >= ?`, `${ox('ref.revision')} <= ?`], params: [P, -MAX, MAX], tail: `ORDER BY ${ox('ref.revision')} DESC, ref_key COLLATE BINARY DESC LIMIT 64` },
  { name: 'ordered_catalog_int_desc_after_empty', shape: 'lookupOrderedInside desc, integer, after', type: 'ArchitectureCatalog', where: [textEq('ref.projectId'), `json_type(snapshot_json, ${jp('ref.revision')}) = 'integer'`, `${ox('ref.revision')} >= ?`, `${ox('ref.revision')} <= ?`, `(${ox('ref.revision')}, ref_key COLLATE BINARY) < (?, ?)`], params: [P, -MAX, catalog.o, catalog.o, catalog.ref_key], tail: `ORDER BY ${ox('ref.revision')} DESC, ref_key COLLATE BINARY DESC LIMIT 64` },
  { name: 'ordered_queryrun_int_asc_empty_type', shape: 'lookupOrderedInside asc, integer', type: 'QueryRun', where: [textEq('ref.projectId'), textEq('ref.workspaceId'), textEq('run.executionState.sessionRef.sessionId'), `json_type(snapshot_json, ${jp('run.executionState.sessionGeneration')}) = 'integer'`, `${ox('run.executionState.sessionGeneration')} >= ?`, `${ox('run.executionState.sessionGeneration')} <= ?`], params: [P, W, 'session-x', -MAX, MAX], tail: `ORDER BY ${ox('run.executionState.sessionGeneration')} ASC, ref_key COLLATE BINARY ASC LIMIT 64` },
  // countInside
  { name: 'count_note_review_141', shape: 'countInside', count: true, type: 'NoteHead', where: [textEq('ref.projectId'), textEq('goalId'), textEq('state')], params: [P, 'g008', 'superseded'] },
  { name: 'count_note_review_empty', shape: 'countInside', count: true, type: 'NoteHead', where: [textEq('ref.projectId'), textEq('goalId'), textEq('state')], params: [P, 'g008', 'withdrawn-x'] },
  { name: 'count_session_lifecycle_202', shape: 'countInside', count: true, type: 'Session', where: [textEq('ref.projectId'), textEq('workspaceId'), textEq('lifecycle')], params: [P, W, 'active'] },
  { name: 'count_ordered_session_archived_empty', shape: 'countInside (ordered index)', count: true, type: 'Session', where: [textEq('ref.projectId'), textEq('workspaceId'), textEq('lifecycle'), `json_type(snapshot_json, ${jp('archivedAt')}) = 'text'`, `${ox('archivedAt')} <> ''`], params: [P, W, 'archived'] },
  { name: 'count_distinct_session_from_202', shape: 'countInside distinct', distinct: 'provenance.from.sessionId', type: 'Session', where: [textEq('ref.projectId'), textEq('workspaceId'), textEq('provenance.kind')], params: [P, W, 'new'] },
  { name: 'count_distinct_session_from_empty', shape: 'countInside distinct', distinct: 'provenance.from.sessionId', type: 'Session', where: [textEq('ref.projectId'), textEq('workspaceId'), textEq('provenance.kind')], params: [P, W, 'continuation'] },
  // open-time type scan (sqlite-text-search.ts:205), informative only
  { name: 'typescan_catalog_1', shape: 'type scan (text rebuild)', select: 'ref_key, snapshot_json', type: 'ArchitectureCatalog', where: [], params: [], heavy: false },
  { name: 'typescan_notehead_20034', shape: 'type scan (text rebuild)', select: 'ref_key, snapshot_json', type: 'NoteHead', where: [], params: [], heavy: true },
];
// No aggregateType term at all:
const plain = [
  { name: 'pk_read_hit', shape: 'readManyInside :387', sql: 'SELECT snapshot_json FROM snapshots WHERE ref_key = ?', params: [noteHeadRef], get: true },
  { name: 'pk_read_miss', shape: 'readManyInside :387', sql: 'SELECT snapshot_json FROM snapshots WHERE ref_key = ?', params: ['{"aggregateType":"NoteHead","noteId":"nope","projectId":"m4b-project"}'], get: true },
  { name: 'max_events_id', shape: 'readThrough :333', sql: 'SELECT MAX(id) AS max_id FROM events', params: [], get: true },
  // control: the known bound-LIMIT re-prepare (summary.md:42), literal type
  { name: 'control_bound_limit', shape: 'lookupInside, LIMIT ?', sql: `SELECT ref_key FROM snapshots WHERE ${TYPE} = 'NoteHead' AND ${textEq('ref.projectId')} AND ${textEq('anchorKey0')} ORDER BY ref_key COLLATE BINARY ASC LIMIT ?`, params: [P, smallAnchor, 201] },
];

function sqlOf(c, variant) {
  const typeTerm = variant === 'bound' ? `${TYPE} = ?` : `${TYPE} = '${c.type}'`;
  const where = [typeTerm, ...c.where].join(' AND ');
  if (c.count) return `SELECT COUNT(*) AS total FROM snapshots WHERE ${where}`;
  if (c.distinct) {
    const d = jp(c.distinct);
    const typeClass = `CASE WHEN json_type(snapshot_json, ${d}) IN ('integer', 'real') THEN 'number' ELSE json_type(snapshot_json, ${d}) END`;
    return `SELECT COUNT(*) AS total FROM (SELECT DISTINCT ${typeClass} AS value_type, json_extract(snapshot_json, ${d}) AS value FROM snapshots WHERE ${where} AND json_type(snapshot_json, ${d}) IN ('text', 'integer', 'real', 'true', 'false'))`;
  }
  if (c.select) return `SELECT ${c.select} FROM snapshots WHERE ${where}`;
  const isOrdered = c.shape.startsWith('lookupOrdered');
  const orderCol = isOrdered ? /ORDER BY (json_extract\(snapshot_json, '[^']+'\))/.exec(c.tail)[1] : null;
  return `SELECT ref_key${isOrdered ? `, ${orderCol} AS order_value` : ''} FROM snapshots WHERE ${where} ${c.tail}`;
}

let authCalls = 0;
const counter = () => { authCalls += 1; return constants.SQLITE_OK; };
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function bench(fn, heavy) {
  const budget = heavy ? 400 : 200; const minIters = heavy ? 3 : 30; const maxIters = heavy ? 50 : 50000;
  fn();
  const means = []; let total = 0;
  for (let r = 0; r < 3; r += 1) {
    let n = 0; const s = performance.now();
    while ((n < minIters || performance.now() - s < budget) && n < maxIters) { fn(); n += 1; }
    means.push(((performance.now() - s) / n) * 1000); total += n;
  }
  return { us: +median(means).toFixed(1), rounds: means.map(m => +m.toFixed(1)), iterations: total };
}
function measure(db, name, shape, sql, params, { get = false, heavy = false } = {}) {
  const exec = st => (get ? st.get(...params) : st.all(...params));
  const r = { name, shape, sql };
  r.eqp = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(x => x.detail);
  if (sql.includes(`${TYPE} = ?`)) {
    try { r.eqpBeforeBind = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(x => x.detail); } catch (e) { r.eqpBeforeBind = String(e); }
  }
  const res = exec(db.prepare(sql));
  r.resultJson = JSON.stringify(res ?? null);
  r.rows = get ? (res === undefined ? 0 : 1) : res.length;
  if (r.rows === 1 && res?.[0]?.total !== undefined) r.total = Number(res[0].total);
  else if (get && res?.total !== undefined) r.total = Number(res.total);
  db.setAuthorizer(counter);
  authCalls = 0; const st = db.prepare(sql); r.authCallsAtPrepare = authCalls;
  const per = [];
  for (let i = 0; i < 5; i += 1) { authCalls = 0; exec(st); per.push(authCalls); }
  db.setAuthorizer(null);
  r.authCallsPerExecution = per;
  r.reprepareEveryExecution = per.every(x => x > 0);
  r.fresh = bench(() => exec(db.prepare(sql)), heavy);
  const reused = db.prepare(sql);
  r.reused = bench(() => exec(reused), heavy);
  return r;
}

// Interleaved A/B in one process (same machine state): A = full-index file,
// B = partial-index file; order alternates per case (ABBA) to cancel drift.
const files = [{ label: 'full', db }, { label: 'partial', db: dbB }];
const t0 = performance.now();
for (const f of files) for (const c of cases) for (const v of ['bound', 'literal']) f.db.prepare(sqlOf(c, v)).all(...(v === 'bound' ? [c.type, ...c.params] : c.params));
const results = [];
let k = 0;
const both = (fn) => { const order = k % 2 === 0 ? files : [...files].reverse(); k += 1; const got = {}; for (const f of order) got[f.label] = fn(f.db); return got; };
for (const c of cases) {
  for (const variant of ['bound', 'literal']) {
    const params = variant === 'bound' ? [c.type, ...c.params] : c.params;
    const got = both(d => measure(d, c.name, c.shape, sqlOf(c, variant), params, { heavy: c.heavy === true, get: c.count === true || c.distinct !== undefined }));
    results.push({ name: c.name, shape: c.shape, type: c.type, variant, sameResult: got.full.resultJson === got.partial.resultJson, full: got.full, partial: got.partial });
  }
}
for (const c of plain) {
  const got = both(d => measure(d, c.name, c.shape, c.sql, c.params, { get: c.get === true }));
  results.push({ name: c.name, shape: c.shape, variant: 'n/a', sameResult: got.full.resultJson === got.partial.resultJson, full: got.full, partial: got.partial });
}
db.close(); dbB.close();
for (const r of results) { delete r.full.resultJson; delete r.partial.resultJson; }
const out = { label, dbFull: dbPath, dbPartial: dbPathB, unit: 'microseconds per execution (median of 3 rounds); fresh = db.prepare(sql) + execute each time; reused = one statement executed repeatedly', node: process.version, elapsedMs: Math.round(performance.now() - t0), results };
writeFileSync(outFile, JSON.stringify(out, null, 2));
const fmt = x => String(x).padStart(8);
console.log(['case'.padEnd(38), 'var'.padEnd(7), 'rows', '  same', ' F.fresh', ' P.fresh', 'F.reused', 'P.reused', 'F.rep', 'P.rep'].join(' '));
for (const r of results) console.log([r.name.padEnd(38), r.variant.padEnd(7), String(r.full.rows).padStart(4), String(r.sameResult).padStart(6), fmt(r.full.fresh.us), fmt(r.partial.fresh.us), fmt(r.full.reused.us), fmt(r.partial.reused.us), (r.full.reprepareEveryExecution ? 'Y' : 'n').padStart(5), (r.partial.reprepareEveryExecution ? 'Y' : 'n').padStart(5)].join(' '));
console.log('elapsedMs', out.elapsedMs);
