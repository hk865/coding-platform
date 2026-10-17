#!/usr/bin/env node
/**
 * Slice 4 §11.7 (spec line 918, §12 item 12): the 20,000-note measurement before 4C-2 completes, on the code after
 * 4C-1, 4C-2 session A and session B (merge tree), READS ONLY, over a copy of the dataset measure-4b.mjs built
 * (20,034 note heads, 65,293 versions, 101 goals) as left by the speed-round-1 re-measurement (measure-s4f full-r1).
 * Records only; asserts nothing.
 *
 * Rows: the segmented "find" first page, `lookup`, `stale`, the Goal-card assembly (graphContext.readContextFacts
 * with includeInputs, which reads the memory material), and one heartbeat scribe check (the Host's
 * `runScribeReminderCheck` reads: ledger cursor; on a moved cursor the workspace's goal ids and readScribeTodos).
 * Each row: time of the first call, warm p50/p95/max, and the record-store calls of ONE warm call by method (and
 * readMany batches by aggregate type), counted by wrapping the SQLite backend's `records` object (loader hook on the
 * built module; the code under measurement is unchanged).
 *
 * Usage (WSL, Node 24; dist built with node_modules/.bin/tsc -p tsconfig.build.json):
 *   node measure-4c2.mjs --repo ~/dsh-work/measure-4c2/repo --data ~/dsh-work/measure-4c2/data \
 *     --old <measure-4b.out.json> --prev <measure-s4f.out.json> --out <out.json> [--reps 30]
 */
import { register } from 'node:module';
import { writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';

// The counting wrapper: rename the built factory and export a wrapper that hands the backend to a global hook.
const HOOK = `
export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (!url.endsWith('/core/record-store/sqlite-record-store.js')) return r;
  let src = typeof r.source === 'string' ? r.source : new TextDecoder().decode(r.source);
  const marker = 'export function createSqliteRecordBackend(';
  if (!src.includes(marker)) throw new Error('measure hook: factory not found');
  src = src.replace(marker, 'function __measureOrigCreateSqliteRecordBackend(');
  src += '\\nexport function createSqliteRecordBackend(options) { const b = __measureOrigCreateSqliteRecordBackend(options);'
    + ' return globalThis.__measureWrapBackend ? globalThis.__measureWrapBackend(b) : b; }\\n';
  return { ...r, source: src, shortCircuit: true };
}`;
register(`data:text/javascript,${encodeURIComponent(HOOK)}`, import.meta.url);

const counter = { active: false, calls: {}, readManyByType: {}, readManyKeys: 0, lookupByIndex: {}, wrapped: 0 };
function aggregateTypeOf(refKey) {
  try { return JSON.parse(refKey).aggregateType ?? '?'; } catch { return '?'; }
}
globalThis.__measureWrapBackend = backend => {
  counter.wrapped += 1;
  const records = backend.records;
  const wrapped = {};
  for (const [name, value] of Object.entries(records)) {
    wrapped[name] = typeof value !== 'function' ? value : function (...args) {
      if (counter.active) {
        counter.calls[name] = (counter.calls[name] ?? 0) + 1;
        if (name === 'readMany' && Array.isArray(args[0])) {
          counter.readManyKeys += args[0].length;
          const types = [...new Set(args[0].map(aggregateTypeOf))].sort().join('+') || '(empty)';
          counter.readManyByType[types] = (counter.readManyByType[types] ?? 0) + 1;
        } else if (args[0] !== null && typeof args[0] === 'object' && typeof args[0].index === 'string') {
          const key = `${name}:${args[0].index}`;
          counter.lookupByIndex[key] = (counter.lookupByIndex[key] ?? 0) + 1;
        }
      }
      return value.apply(records, args);
    };
  }
  return { ...backend, records: wrapped };
};
async function countedOnce(fn) {
  counter.calls = {}; counter.readManyByType = {}; counter.readManyKeys = 0; counter.lookupByIndex = {}; counter.active = true;
  const t0 = performance.now();
  let result;
  try { result = await fn(); } finally { counter.active = false; }
  const ms = performance.now() - t0;
  const total = Object.values(counter.calls).reduce((s, v) => s + v, 0);
  return { result, ms, reads: { total, byMethod: { ...counter.calls }, readManyByType: { ...counter.readManyByType },
    readManyKeys: counter.readManyKeys, lookupByIndex: { ...counter.lookupByIndex } } };
}

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
const REPO = resolve(expand(args.repo ?? '~/dsh-work/measure-4c2/repo'));
const DATA = resolve(expand(args.data ?? '~/dsh-work/measure-4c2/data'));
const OLD = resolve(expand(args.old ?? '/mnt/d/cc-lead-notes/impl/s4b/measure-4b.out.json'));
const PREV = args.prev === undefined ? null : resolve(expand(args.prev));
const OUT = resolve(expand(args.out ?? './measure-4c2.out.json'));
const REPS = Number(args.reps ?? 30);
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',')) : null;
const want = part => ONLY === null || ONLY.has(part);

const dist = p => import(pathToFileURL(join(REPO, 'dist', p)).href);
const { createTargetPlatform } = await dist('composition/create-platform.js');

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
// The deterministic binding measure-4b.mjs used for the g000 executor claim.
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
const r2 = v => (v === null ? null : Math.round(v * 100) / 100);
function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return { count: sorted.length, p50: r2(quantile(sorted, 0.5)), p95: r2(quantile(sorted, 0.95)), max: r2(sorted[sorted.length - 1] ?? null),
    min: r2(sorted[0] ?? null) };
}
function summarize(result) {
  if (result === undefined || result === null) return null;
  if (result.status !== 'ready') return { status: result.status, code: result.code, reason: result.reason };
  const v = result.value;
  const out = { status: 'ready', bytes: Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8') };
  if (Array.isArray(v)) { out.length = v.length; return out; }
  if (typeof v !== 'object' || v === null) { out.value = v; return out; }
  if (Array.isArray(v.items)) out.items = v.items.length;
  for (const key of ['complete', 'ranking', 'coverage', 'topicsComplete', 'boundary']) if (v[key] !== undefined) out[key] = v[key];
  if (v.related !== undefined && v.related !== null) out.related = { filesOmitted: v.related.filesOmitted,
    filesUnknownRuns: Array.isArray(v.related.filesUnknownRuns) ? v.related.filesUnknownRuns.length : v.related.filesUnknownRuns };
  if (v.project !== undefined) out.projectPart = v.project === null ? null : { keys: Object.keys(v.project) };
  if (v.next !== undefined) out.hasNext = v.next !== null;
  if (Array.isArray(v.warnings)) out.warnings = v.warnings.length;
  if (v.understanding !== undefined) out.understanding = v.understanding === null ? null : 'present';
  if (Array.isArray(v.items) && v.items.length > 0) {
    const segments = {};
    for (const item of v.items) if (item.segment !== undefined) segments[item.segment] = (segments[item.segment] ?? 0) + 1;
    if (Object.keys(segments).length > 0) out.segments = segments;
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
  const counted = await countedOnce(fn);
  const row = { label, firstMs: r2(firstMs), warm: stats(times), reads: counted.reads, sample: options.summarize ? options.summarize(first) : summarize(first) };
  if (options.ruler !== undefined) row.ruler = { ms: options.ruler, warmP50Within: row.warm.p50 <= options.ruler, warmP95Within: row.warm.p95 <= options.ruler };
  log(`  ${label}: first ${row.firstMs} ms; warm p50 ${row.warm.p50} p95 ${row.warm.p95} max ${row.warm.max} (n=${row.warm.count}); reads ${JSON.stringify(row.reads)}; ${JSON.stringify(row.sample)}`);
  return row;
}

async function main() {
  const loadStart = os.loadavg();
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

  // Ids kept only in memory by measure-4b.mjs, recovered read-only before the first platform open.
  const ledger = join(DATA, 'storage', 'ledger.sqlite');
  const db = new DatabaseSync(ledger, { readOnly: true });
  let recovered;
  try {
    const runRows = db.prepare("SELECT ref_key, snapshot_json FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'Run' AND json_extract(ref_key, '$.goalId') = 'g000'").all();
    const execRun = runRows.find(row => JSON.parse(row.snapshot_json).task?.taskId === 't1');
    const goal = JSON.parse(db.prepare("SELECT snapshot_json FROM snapshots WHERE ref_key = ?").get(JSON.stringify({ aggregateType: 'Goal', goalId: 'g000', projectId: PROJECT })).snapshot_json);
    const heads = "FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'NoteHead'";
    recovered = { executorRunRef: JSON.parse(execRun.ref_key), executorRunState: JSON.parse(execRun.snapshot_json).state ?? null,
      goalRef: goal.ref, planRef: goal.activePlanRevision,
      counts: { noteHeads: Number(db.prepare(`SELECT count(*) AS n ${heads}`).get().n),
        noteVersions: Number(db.prepare("SELECT count(*) AS n FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'NoteVersion'").get().n),
        pendingReview: Number(db.prepare(`SELECT count(*) AS n ${heads} AND json_extract(snapshot_json, '$.state') = 'pending_review'`).get().n),
        goals: Number(db.prepare("SELECT count(*) AS n FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'Goal'").get().n),
        currentPointers: Number(db.prepare("SELECT count(*) AS n FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'CurrentPointer'").get().n) },
      maxEventIdBefore: Number(db.prepare('SELECT MAX(id) AS m FROM events').get().m) };
  } finally { db.close(); }
  log(`recovered ${JSON.stringify(recovered)}`);
  const exec = () => workCtx(recovered.executorRunRef, executorBinding);

  const out = { meta: { started: new Date().toISOString(), node: process.version, platform: `${os.type()} ${os.release()}`,
    cpus: os.cpus().length, loadavgStart: loadStart.map(r2), repo: REPO, data: DATA, reps: REPS, oldResults: OLD, prevResults: PREV,
    dataset: 'a copy of measure-s4f full-r1 (the measure-4b.mjs checkpoint-A dataset after the speed-1 re-measurement)',
    ledgerBytes: (await stat(ledger)).size },
  recovered, open: {}, find: [], lookup: [], stale: [], goalCard: [], heartbeat: [] };

  // 0. The first open with this code (it may rebuild derived tables), then plain reopens.
  {
    const t0 = performance.now();
    const p = await openPlatform();
    out.open.firstOpenMs = Math.round(performance.now() - t0);
    out.open.backendsWrapped = counter.wrapped;
    await p.close();
    const opens = [];
    for (let i = 0; i < 3; i += 1) { const s = performance.now(); const q = await openPlatform(); opens.push(performance.now() - s); await q.close(); }
    out.open.plain = stats(opens);
    log(`  open: ${JSON.stringify(out.open)}`);
  }

  const platform = await openPlatform();
  const notes = platform.notes;
  const F = (t, match, extra = {}, ctx = hostCtx) => () => notes.memoryFind(ctx(), { v: 1, op: 'find', terms: t, match, limit: 20, cursor: null, ...extra });
  const L = (anchor, ctx = hostCtx) => () => notes.memoryLookup(ctx(), { v: 1, op: 'lookup', anchor, limit: 20, cursor: null });
  const relatedTask = { kind: 'task', goalId: 'g000', taskId: 't1' };
  const relatedModule = { kind: 'module', moduleId: anchors.busiestModule.moduleId };

  // 1. "find" first page, segmented (ruler 100 ms), plus the unsegmented baseline for the same terms.
  if (want('find')) for (const [label, fn, opts] of [
    ['find one term, any (executor of g000, default segmented by its task)', F([terms.single.w], 'any', {}, exec)],
    ['find two terms, any (executor of g000, segmented)', F([terms.pairA.w, terms.pairB.w], 'any', {}, exec)],
    ['find many-match term, any (executor of g000, segmented; candidate cap)', F([terms.many.w], 'any', {}, exec), { reps: Math.min(REPS, 10) }],
    ['find one term, any (host, related task g000/t1)', F([terms.single.w], 'any', { related: relatedTask })],
    ['find one term, any (host, related busiest module)', F([terms.single.w], 'any', { related: relatedModule })],
    ['find many-match term, any (host, related busiest module; candidate cap)', F([terms.many.w], 'any', { related: relatedModule }), { reps: Math.min(REPS, 10) }],
    ['find one term, any (executor of g000, related: null = unsegmented)', F([terms.single.w], 'any', { related: null }, exec)],
    ['find one term, any (host, unsegmented)', F([terms.single.w], 'any')],
  ]) out.find.push(await bench(label, fn, { ruler: 100, ...(opts ?? {}) }));

  // 2. lookup (ruler 50 ms).
  if (want('lookup')) for (const [label, fn] of [
    ['memoryLookup typical file anchor (host)', L(anchors.typicalFile)],
    ['memoryLookup typical file anchor (executor of g000)', L(anchors.typicalFile, exec)],
    ['memoryLookup typical module anchor (host)', L(anchors.typicalModule)],
    ['memoryLookup busiest anchor (host)', L(anchors.busiest)],
    ['memoryLookup goal anchor with understanding (host)', L({ kind: 'goal', goalId: 'g000' })],
    ['memoryLookup project anchor (host)', L({ kind: 'project' })],
  ]) out.lookup.push(await bench(label, fn, { ruler: 50 }));

  // 3. stale (ruler 250 ms).
  if (want('stale')) for (const [label, fn] of [
    ['memoryStale one goal', () => notes.memoryStale(hostCtx(), { v: 1, op: 'stale', goalId: 'g000', limit: 20, cursor: null })],
    ['memoryStale busiest module anchor', () => notes.memoryStale(hostCtx(), { v: 1, op: 'stale', anchor: anchors.busiestModule, limit: 20, cursor: null })],
  ]) out.stale.push(await bench(label, fn, { ruler: 250 }));

  // 4. The Goal-card assembly: the graph context facts with inputs (the memory material is read inside).
  const summarizeContext = result => {
    if (result.status !== 'ready') return summarize(result);
    const v = result.value;
    const memory = v.memory ?? v.notes ?? v.inputs?.memory ?? null;
    return { status: 'ready', bytes: Buffer.byteLength(JSON.stringify(v), 'utf8'), keys: Object.keys(v),
      memory: memory === null ? null : { bytes: Buffer.byteLength(JSON.stringify(memory), 'utf8'), keys: Object.keys(memory) } };
  };
  if (want('goalCard')) for (const [label, ctx] of [['Goal-card assembly g000 focus t1 (host)', hostCtx], ['Goal-card assembly g000 focus t1 (executor of g000)', exec]]) {
    out.goalCard.push(await bench(label, () => platform.graphContext.readContextFacts(ctx(), {
      goalRef: recovered.goalRef, planRef: recovered.planRef, focusTaskIds: ['t1'], includeInputs: true }), { summarize: summarizeContext }));
  }

  // 5. One heartbeat scribe check: the cursor read (unchanged ledger: the whole check), and the moved-cursor reads.
  if (want('heartbeat')) {
  out.heartbeat.push(await bench('heartbeat, ledger cursor unchanged (readLedgerCursor)', () => notes.readLedgerCursor(hostCtx())));
  const goalIds = await notes.goalIdsForWorkspace(hostCtx());
  out.heartbeat.push(await bench('heartbeat, cursor moved: goalIdsForWorkspace', () => notes.goalIdsForWorkspace(hostCtx())));
  if (goalIds.status === 'ready') {
    const summarizeTodos = result => {
      if (result.status !== 'ready') return summarize(result);
      let pending = 0; let updateDue = 0; let immediate = 0;
      for (const goal of result.value) { pending += goal.pending.length; updateDue += goal.updateDueTodos.length; if (goal.immediate) immediate += 1; }
      return { status: 'ready', goals: result.value.length, pending, updateDue, immediate };
    };
    out.heartbeat.push(await bench(`heartbeat, cursor moved: readScribeTodos over all ${goalIds.value.length} goals`,
      () => notes.readScribeTodos(hostCtx(), { goalIds: goalIds.value }), { summarize: summarizeTodos, reps: Math.min(REPS, 10) }));
    out.heartbeat.push(await bench('heartbeat, cursor moved: the whole read (cursor + goal ids + todos)', async () => {
      const c = await notes.readLedgerCursor(hostCtx());
      if (c.status !== 'ready') return c;
      const g = await notes.goalIdsForWorkspace(hostCtx());
      if (g.status !== 'ready') return g;
      return notes.readScribeTodos(hostCtx(), { goalIds: g.value });
    }, { summarize: summarizeTodos, reps: Math.min(REPS, 10) }));
  } else out.heartbeat.push({ label: 'goalIdsForWorkspace failed', sample: summarize(goalIds) });
  }
  await platform.close();

  // Previous measurement side by side (same label = same call).
  if (PREV !== null) {
    const prev = JSON.parse(await readFile(PREV, 'utf8'));
    const prevRows = new Map((prev.reads ?? []).map(r => [r.label, r]));
    out.comparison = [...out.find, ...out.lookup, ...out.stale].map(r => {
      const p = prevRows.get(r.label);
      return { label: r.label, prev: p === undefined ? null : { p50: p.warm.p50, p95: p.warm.p95, max: p.warm.max }, now: { p50: r.warm.p50, p95: r.warm.p95, max: r.warm.max } };
    }).filter(r => r.prev !== null);
  }
  const check = new DatabaseSync(ledger, { readOnly: true });
  out.maxEventIdAfter = Number(check.prepare('SELECT MAX(id) AS m FROM events').get().m);
  check.close();
  const storage = {};
  for (const name of await readdir(join(DATA, 'storage'))) storage[name] = (await stat(join(DATA, 'storage', name))).size;
  out.storageFilesAfter = storage;
  out.meta.loadavgEnd = os.loadavg().map(r2);
  out.meta.finished = new Date().toISOString();
  await writeFile(OUT, JSON.stringify(out, null, 2));
  log(`done; wrote ${OUT}`);
}

main().then(() => process.exit(0), error => { log(`FAILED: ${error.stack ?? error}`); process.exit(1); });
