#!/usr/bin/env node
/**
 * Speed round 2 write benchmark (adapted from the round-1 measurement) on round-1 code + rework, READS ONLY, over the
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

const N = Number(args.n ?? 200);
const TAG = String(args.tag ?? "w");
async function main() {
  const platform = await openPlatform();
  try {
    const notes = platform.notes;
    const host = hostCtx();
    const times = []; const statuses = {};
    for (let i = 0; i < N; i += 1) {
      const goalId = "g" + String(i % 100).padStart(3, "0");
      const draft = { kind: "convention", topic: "bench " + TAG + " " + i, conclusion: "bench write " + TAG + " " + i + ": keep the index small",
        anchor: { kind: "goal", goalId }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
        replaces: [], contradicts: [], coexistWith: [], body: "bench body " + i };
      const s = performance.now();
      const r = await notes.writeNote(host, { commandId: "bench-" + TAG + "-" + i, note: draft, expectedPointerRevision: null, goalId });
      times.push(performance.now() - s);
      const k = r.status === "rejected" ? "rejected:" + r.reason : r.status; statuses[k] = (statuses[k] ?? 0) + 1;
    }
    const out = { tag: TAG, repo: REPO, data: DATA, n: N, statuses, stats: stats(times) };
    console.log(JSON.stringify(out));
    await writeFile(OUT, JSON.stringify(out, null, 1));
  } finally { await platform.close(); }
}
await main();
