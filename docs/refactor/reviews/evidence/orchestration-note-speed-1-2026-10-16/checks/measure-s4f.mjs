#!/usr/bin/env node
/**
 * Speed round 1 (decision 66) re-measurement on round-1 code + rework, READS ONLY, over the
 * dataset measure-4b.mjs already built in <repo>/.measure-data/full (20,000 notes,
 * 65,185 versions at checkpoint A, plus 34 heads of the stopped phase B).
 * Records only; asserts nothing.
 *
 * The anchors and terms are the ones measure-4b.mjs chose (read from its
 * measure-4b.out.json); the few ids it kept only in memory (the g000 executor
 * Run, the first contradiction note, the first reviewed note with version >= 3)
 * are recovered from the ledger with one read-only SQLite connection opened and
 * closed BEFORE the first platform open, so the timed first open is the one that
 * rebuilds the full-text table under the new meta format.
 *
 * Usage (WSL, Node 24; build dist first with node_modules/.bin/tsc -p tsconfig.build.json):
 *   node measure-4b-final.mjs --repo ~/dsh-work/measure-4b \
 *     [--old /mnt/d/cc-lead-notes/impl/s4b/measure-4b.out.json] \
 *     [--out /mnt/d/cc-lead-notes/impl/s4b/measure-4b-final.out.json] [--reps 30]
 */
import { writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true; else { out[a.slice(2)] = next; i += 1; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const expand = p => (typeof p === 'string' && p.startsWith('~/') ? join(os.homedir(), p.slice(2)) : p);
const REPO = resolve(expand(args.repo ?? '~/dsh-work/measure-4b'));
const DATA = resolve(expand(args.data ?? join(REPO, '.measure-data/full')));
const OLD = resolve(expand(args.old ?? '/mnt/d/cc-lead-notes/impl/s4b/measure-4b.out.json'));
const OUT = resolve(expand(args.out ?? '/mnt/d/cc-lead-notes/impl/s4b/measure-4b-final.out.json'));
const REPS = Number(args.reps ?? 30);

const dist = p => import(pathToFileURL(join(REPO, 'dist', p)).href);
const { createTargetPlatform } = await dist('composition/create-platform.js');
const { createSqliteRecordBackend } = await dist('core/record-store/sqlite-record-store.js');
const { NOTE_RECORD_SCHEMAS, S4_NOTE_TEXT_LOOKUP } = await dist('core/work-graph/persistence/note-record-codecs.js');

const log = line => console.log(`[${new Date().toISOString()}] ${line}`);

const PROJECT = 'm4b-project';
const WORKSPACE = 'm4b-workspace';
const scope = { projectId: PROJECT, workspaceId: WORKSPACE };
const hostActor = { kind: 'human', id: 'm4b-operator' };
const hostCtx = () => ({ projectId: PROJECT, workspaceId: WORKSPACE, principal: { kind: 'host', actor: hostActor },
  materialReader: { kind: 'host', projectId: PROJECT, workspaceId: WORKSPACE, actor: hostActor },
  signal: new AbortController().signal });
const workCtx = (runRef, roleBinding) => ({ projectId: PROJECT, workspaceId: WORKSPACE,
  principal: { kind: 'work_run', runRef, roleBinding }, materialReader: { kind: 'run', requester: runRef },
  signal: new AbortController().signal });
// The same deterministic binding measure-4b.mjs used for the g000 executor claim.
const executorBinding = { schemaVersion: 1, bindingId: 'm4b-g000-exec-binding', templateId: 'platform-executor',
  templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' };

let clockMs = Date.parse('2026-10-20T00:00:00.000Z');
const now = () => { clockMs += 10; return new Date(clockMs).toISOString(); };
async function openPlatform() {
  const root = join(DATA, 'workspace');
  return createTargetPlatform({
    storage: { kind: 'sqlite', directory: join(DATA, 'storage') },
    workspace: {
      async resolveRoot(requested) {
        return requested.projectId === PROJECT && requested.workspaceId === WORKSPACE
          ? { status: 'ready', value: { root, workspaceRevision: 1 } }
          : { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered' };
      },
      async authorize() {
        return { status: 'ready', value: { subjectKey: 'm4b-host', permissionRevision: 'm4b-grant-1', allowsRead: () => true } };
      },
    },
    now,
    kernelStores: { entries: [{ adapterId: 'm4b-kernel', storeKey: 'm4b-kernel-store', workspace: scope,
      databasePath: join(DATA, 'kernel.sqlite') }] },
  });
}

function quantile(sorted, q) { if (sorted.length === 0) return null; return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]; }
function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const r = v => (v === null ? null : Math.round(v * 100) / 100);
  return { count: sorted.length, p50: r(quantile(sorted, 0.5)), p95: r(quantile(sorted, 0.95)), max: r(sorted[sorted.length - 1] ?? null),
    min: r(sorted[0] ?? null), mean: r(sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length)) };
}
function summarize(result) {
  if (result === undefined || result === null) return null;
  if (result.status !== 'ready') return { status: result.status, code: result.code, reason: result.reason };
  const v = result.value;
  const out = { status: 'ready', bytes: Buffer.byteLength(JSON.stringify(v), 'utf8') };
  if (Array.isArray(v.items)) out.items = v.items.length;
  if (Array.isArray(v.records)) out.records = v.records.length;
  for (const key of ['complete', 'ranking', 'coverage', 'topicsComplete']) if (v[key] !== undefined) out[key] = v[key];
  if (v.next !== undefined) out.hasNext = v.next !== null;
  if (Array.isArray(v.warnings)) out.warnings = v.warnings.length;
  if (v.readBasis !== undefined) out.observedFiles = v.readBasis.observedFiles.length;
  if (Array.isArray(v.topics)) out.topics = v.topics.length;
  if (v.understanding !== undefined) out.understanding = v.understanding === null ? null : { pointerSet: v.understanding.pointer.noteId !== null };
  if (Array.isArray(v.items) && v.items.length > 0) {
    const fresh = {}; const states = {};
    for (const item of v.items) { fresh[item.freshness] = (fresh[item.freshness] ?? 0) + 1; states[item.storedState] = (states[item.storedState] ?? 0) + 1; }
    out.freshness = fresh; out.storedStates = states;
    if (v.items[0].score !== undefined) out.topScore = v.items[0].score;
    const conflicting = v.items.filter(item => item.conflicting).length;
    if (conflicting > 0) out.conflictingItems = conflicting;
  }
  return out;
}
async function bench(label, fn, options = {}) {
  const reps = options.reps ?? REPS;
  const maxMs = options.maxMs ?? 90000;
  const t0 = performance.now();
  const first = await fn();
  const firstMs = performance.now() - t0;
  const times = [];
  const start = performance.now();
  for (let i = 0; i < reps; i += 1) {
    const s = performance.now();
    await fn();
    times.push(performance.now() - s);
    if (performance.now() - start > maxMs && times.length >= 3) break;
  }
  const row = { label, firstMs: Math.round(firstMs * 100) / 100, warm: stats(times), sample: summarize(first) };
  log(`  ${label}: first ${row.firstMs} ms; warm p50 ${row.warm.p50} p95 ${row.warm.p95} max ${row.warm.max} (n=${row.warm.count}) ${JSON.stringify(row.sample)}`);
  return row;
}

async function main() {
  const old = JSON.parse(await readFile(OLD, 'utf8'));
  const oldA = old.checkpoints.find(c => c.label === 'A');
  const terms = oldA.terms;
  const anchorOf = key => {
    if (key === 'project') return { kind: 'project' };
    if (key.startsWith('file:')) return { kind: 'file', path: key.slice(5) };
    if (key.startsWith('module:')) return { kind: 'module', moduleId: key.slice(7) };
    throw new Error(`unexpected anchor key ${key}`);
  };
  const anchors = { typicalFile: anchorOf(oldA.anchors.typicalFile.key), typicalModule: anchorOf(oldA.anchors.typicalModule.key),
    busiestModule: anchorOf(oldA.anchors.busiestModule.key), busiest: anchorOf(oldA.anchors.busiest.key) };
  const mostVersions = oldA.anchors.mostVersions.noteId;

  // Recover the in-memory ids of the first run (read-only, closed before the first platform open).
  const ledger = join(DATA, 'storage', 'ledger.sqlite');
  const db = new DatabaseSync(ledger, { readOnly: true });
  let recovered;
  try {
    const runRows = db.prepare("SELECT ref_key, snapshot_json FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'Run' AND json_extract(ref_key, '$.goalId') = 'g000'").all();
    const execRun = runRows.find(row => JSON.parse(row.snapshot_json).task?.taskId === 't1');
    const heads = "FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'NoteHead'";
    const conflict = db.prepare(`SELECT snapshot_json ${heads} AND json_array_length(json_extract(snapshot_json, '$.contradicts')) > 0 ORDER BY json_extract(snapshot_json, '$.createdAt'), json_extract(snapshot_json, '$.noteId') LIMIT 1`).get();
    const neighbor = db.prepare(`SELECT json_extract(snapshot_json, '$.noteId') AS noteId ${heads} AND json_extract(snapshot_json, '$.state') = 'reviewed' AND json_extract(snapshot_json, '$.version') >= 3 ORDER BY json_extract(snapshot_json, '$.createdAt'), json_extract(snapshot_json, '$.noteId') LIMIT 1`).get();
    const conflictHead = JSON.parse(conflict.snapshot_json);
    recovered = { executorRunRef: JSON.parse(execRun.ref_key), conflictNoteId: conflictHead.noteId, conflictAnchor: conflictHead.anchor,
      neighborNoteId: neighbor.noteId,
      counts: { noteHeads: Number(db.prepare(`SELECT count(*) AS n ${heads}`).get().n),
        noteVersions: Number(db.prepare("SELECT count(*) AS n FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'NoteVersion'").get().n) },
      textMetaBefore: db.prepare("SELECT name FROM sqlite_master WHERE name = 'next_text_meta'").get()
        ? db.prepare('SELECT * FROM next_text_meta').all().map(row => ({ ...row }))
        : { absent: true, legacyTables: db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'next_fts%' AND type = 'table' ORDER BY name").all().map(row => row.name) } };
  } finally { db.close(); }
  log(`recovered ${JSON.stringify(recovered)}`);
  const exec = () => workCtx(recovered.executorRunRef, executorBinding);
  const lookupTypical = p => p.notes.memoryLookup(hostCtx(), { v: 1, op: 'lookup', anchor: anchors.typicalFile, limit: 20, cursor: null });

  const out = { meta: { started: new Date().toISOString(), node: process.version, platform: `${os.type()} ${os.release()}`,
    cpus: os.cpus().length, repo: REPO, data: DATA, reps: REPS, oldResults: OLD,
    dataset: 'the measure-4b.mjs checkpoint-A dataset, reused (no rebuild of the data)', ledgerBytes: (await stat(ledger)).size },
  recovered, reopen: {}, rawSearch: [], reads: [] };

  // 1. The first open with the new code (the meta format changed: the round-1 table has no `through`).
  {
    const t0 = performance.now();
    const p = await openPlatform();
    const openMs = performance.now() - t0;
    const q0 = performance.now();
    const first = await lookupTypical(p);
    const firstLookupMs = performance.now() - q0;
    await p.close();
    const check = new DatabaseSync(ledger, { readOnly: true });
    const metaAfter = check.prepare('SELECT * FROM next_text_meta').all().map(row => ({ ...row }));
    const maxEvent = Number(check.prepare('SELECT MAX(id) AS m FROM events').get().m);
    check.close();
    out.reopen.rebuildAtOpen = { openMs: Math.round(openMs), firstLookupMs: Math.round(firstLookupMs * 100) / 100,
      firstLookup: summarize(first), metaAfter, maxEventIdAfter: maxEvent };
    log(`  rebuild at open: ${JSON.stringify(out.reopen.rebuildAtOpen)}`);
  }
  // 2. Plain reopens (no rebuild expected) and the first lookup after each.
  {
    const opens = []; const firsts = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      const p = await openPlatform();
      opens.push(performance.now() - t0);
      const q0 = performance.now();
      await lookupTypical(p);
      firsts.push(performance.now() - q0);
      await p.close();
    }
    out.reopen.plain = { open: stats(opens), firstLookupAfterOpen: stats(firsts) };
    log(`  reopen plain: ${JSON.stringify(out.reopen.plain)}`);
  }
  // 3. Raw searchText (platform closed; note schemas only; the same registration, so no rebuild).
  {
    const b0 = performance.now();
    const backend = createSqliteRecordBackend({ path: ledger, schemas: NOTE_RECORD_SCHEMAS });
    out.reopen.backendOpenNoteSchemasOnly = Math.round((performance.now() - b0) * 100) / 100;
    const records = backend.records;
    const search = (t, limit = 100, after) => records.searchText({ index: S4_NOTE_TEXT_LOOKUP, values: [PROJECT], terms: t, limit,
      ...(after === undefined ? {} : { after }) });
    const pageAll = async t => {
      let after; let total = 0; let pages = 0;
      for (;;) {
        const page = await search(t, 100, after);
        if (page.status !== 'ready') return { status: page.status, code: page.code, reason: page.reason };
        total += page.value.records.length; pages += 1;
        if (page.value.next === null) return { status: 'ready', value: { records: { length: total }, pages } };
        after = page.value.next;
      }
    };
    const raw = [
      ['searchText one term (first page, limit 100)', () => search([terms.single.w])],
      ['searchText two terms (first page, limit 100)', () => search([terms.pairA.w, terms.pairB.w])],
      ['searchText many-match term (first page, limit 100)', () => search([terms.many.w])],
      ['searchText no-match term', () => search([terms.none.w])],
      ['searchText one term, all pages', () => pageAll([terms.single.w])],
      ['searchText ~1,500-match term, all pages', () => pageAll([terms.cap.w])],
      ['searchText many-match term, all pages', () => pageAll([terms.many.w])],
    ];
    for (const [l, fn] of raw) {
      const row = await bench(l, fn, { reps: l.includes('all pages') && !l.includes('one term') ? Math.min(REPS, 5) : REPS });
      if (l.includes('all pages')) { const r = await fn(); row.pages = r.value?.pages; row.matches = r.value?.records.length; }
      out.rawSearch.push(row);
    }
    await backend.close();
  }
  // 4. The memory reads, the same plan as measure-4b.mjs.
  {
    const platform = await openPlatform();
    const notes = platform.notes;
    const host = hostCtx;
    const L = (anchor, ctx = host) => () => notes.memoryLookup(ctx(), { v: 1, op: 'lookup', anchor, limit: 20, cursor: null });
    const F = (t, match, extra = {}, ctx = host) => () => notes.memoryFind(ctx(), { v: 1, op: 'find', terms: t, match, limit: 20, cursor: null, ...extra });
    const plan = [
      ['memoryLookup typical file anchor (host)', L(anchors.typicalFile)],
      ['memoryLookup typical file anchor (executor of g000)', L(anchors.typicalFile, exec)],
      ['memoryLookup typical module anchor (host)', L(anchors.typicalModule)],
      ['memoryLookup busiest module anchor (host)', L(anchors.busiestModule)],
      ['memoryLookup busiest anchor (host)', L(anchors.busiest)],
      ['memoryLookup busiest anchor (executor of g000)', L(anchors.busiest, exec)],
      ['memoryLookup goal anchor with understanding (host)', L({ kind: 'goal', goalId: 'g000' })],
      ['memoryHistory note with most versions', () => notes.memoryHistory(host(), { v: 1, op: 'history', noteId: mostVersions, limit: 20, cursor: null })],
      ['memoryNeighbors reviewed note with predecessor', () => notes.memoryNeighbors(host(), { v: 1, op: 'neighbors', noteId: recovered.neighborNoteId, limit: 20, cursor: null })],
      ['memoryFind one term, any', F([terms.single.w], 'any')],
      ['memoryFind one English term, any', F([terms.singleEn.w], 'any')],
      ['memoryFind one term, any (executor of g000)', F([terms.single.w], 'any', {}, exec)],
      ['memoryFind two terms, any', F([terms.pairA.w, terms.pairB.w], 'any')],
      ['memoryFind two terms, all', F([terms.pairA.w, terms.pairB.w], 'all')],
      ['memoryFind ~1,500-match term, any (just over the candidate cap)', F([terms.cap.w], 'any')],
      ['memoryFind many-match term, any (candidate cap)', F([terms.many.w], 'any')],
      ['memoryFind many-match term + anchor filter (busiest module)', F([terms.many.w], 'any', { anchor: anchors.busiestModule })],
      ['memoryFind no-match term', F([terms.none.w], 'any')],
      ['memoryStale one goal', () => notes.memoryStale(host(), { v: 1, op: 'stale', goalId: 'g000', limit: 20, cursor: null })],
      ['memoryStale busiest module anchor', () => notes.memoryStale(host(), { v: 1, op: 'stale', anchor: anchors.busiestModule, limit: 20, cursor: null })],
      ['memoryConflicts anchor with a registered contradiction', () => notes.memoryConflicts(host(), { v: 1, op: 'conflicts', anchor: recovered.conflictAnchor, limit: 20, cursor: null })],
      ['memoryConflicts by noteId', () => notes.memoryConflicts(host(), { v: 1, op: 'conflicts', noteId: recovered.conflictNoteId, limit: 20, cursor: null })],
      ['memoryConflicts busiest anchor', () => notes.memoryConflicts(host(), { v: 1, op: 'conflicts', anchor: anchors.busiest, limit: 20, cursor: null })],
    ];
    for (const [l, fn] of plan) {
      const heavy = l.includes('candidate cap') || l.includes('many-match term +');
      out.reads.push(await bench(l, fn, heavy ? { reps: Math.min(REPS, 10) } : {}));
    }
    await platform.close();
  }
  // Old vs new side by side (warm p50/p95/max).
  const oldRows = new Map([...oldA.rawSearch, ...oldA.reads].map(r => [r.label, r]));
  out.comparison = [...out.rawSearch, ...out.reads].map(r => {
    const o = oldRows.get(r.label);
    return { label: r.label, old: o === undefined ? null : { p50: o.warm.p50, p95: o.warm.p95, max: o.warm.max, n: o.warm.count },
      new: { p50: r.warm.p50, p95: r.warm.p95, max: r.warm.max, n: r.warm.count } };
  });
  out.oldRebuild = oldA.reopen.forcedRebuild;
  out.oldReopenPlain = oldA.reopen.plain;
  const storage = {};
  for (const name of await readdir(join(DATA, 'storage'))) storage[name] = (await stat(join(DATA, 'storage', name))).size;
  out.storageFilesAfter = storage;
  out.finished = new Date().toISOString();
  await writeFile(OUT, JSON.stringify(out, null, 2));
  log(`done; wrote ${OUT}`);
}

main().then(() => process.exit(0), error => { log(`FAILED: ${error.stack ?? error}`); process.exit(1); });
