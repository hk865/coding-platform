import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { ensureHostBootstrap } from '../../src/app/host-bootstrap.js';

const historical = resolve('evidence/rat-03/platform-dispatch/recovery-exactly-once-trial-1/gui-data');
const projectId = 'local-0e240f792710932932cd';
const runtimeFile = 'real-runs/39d5cf7701762a6451128d384e826bec6d347e424e8f50969c2d97875ce15f48.json';
// Explicit public-data allowlist: never walk/copy private model settings or kernel session databases.
const files = ['ledger.sqlite', 'readmodel.sqlite', 'project-folders.json',
  `projects/${projectId}/ledger.sqlite`, `projects/${projectId}/readmodel.sqlite`, runtimeFile];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

it('recognizes metadata-polluted bootstrap history without rewriting it and refuses another workspace identity', async () => {
  const h = await createPersistentPlatform();
  try {
    const oldEntries = [{ projectId: 'legacy-mounted', workspaceId: 'workspace-main', root: '/previous/mount', name: 'Previous display name' }];
    const old = buildBootstrapCommand({ schemaVersion: 1, entries: oldEntries }, { commandId: 'old-host', correlationId: 'old-host', submittedAt: '2026-09-07T00:00:00.000Z' });
    expect(await h.bootstrap(old)).toMatchObject({ status: 'committed' });
    const before = await h.ledger.events({ afterCursor: null, limit: 100 });
    const normalized = buildBootstrapCommand({ schemaVersion: 1, entries: [{ projectId: 'legacy-mounted', workspaceId: 'workspace-main' }] }, { commandId: 'new-host', correlationId: 'new-host', submittedAt: '2026-09-07T00:00:00.000Z' });
    expect(await h.bootstrap(normalized)).toMatchObject({ status: 'rejected', code: 'not_empty' });
    await ensureHostBootstrap(h.ledger, command => h.bootstrap(command), [{ projectId: 'legacy-mounted', workspaceId: 'workspace-main' }]);
    expect(await h.ledger.events({ afterCursor: null, limit: 100 })).toEqual(before);
    await expect(ensureHostBootstrap(h.ledger, command => h.bootstrap(command), [{ projectId: 'legacy-mounted', workspaceId: 'different-workspace' }])).rejects.toThrow('not_empty');
    expect(await h.ledger.load({ aggregateType: 'Workspace', projectId: 'legacy-mounted', workspaceId: 'different-workspace' })).toMatchObject({ status: 'not_found' });
    expect(await h.ledger.events({ afterCursor: null, limit: 100 })).toEqual(before);
  } finally { await h.cleanup(); }
});
function canonicalRows(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare('SELECT snapshot_json FROM snapshots ORDER BY ref_key').all().map(row => JSON.parse(String(row['snapshot_json']))); }
  finally { db.close(); }
}

it('current production HTTP host reads preserved RAT03 Goal and completed Run without inventing Evidence or replaying the model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'legacy-host-')), data = join(dir, 'data');
  const sourceHashes = new Map<string, string>();
  let app: Awaited<ReturnType<typeof createGuiServer>> | undefined;
  let providerCalls = 0;
  const registry = createBuiltinProviderRegistry();
  const options = { modelSettings: { directory: join(dir, 'isolated-synthetic-settings'), registry: {
    list: () => registry.list(), get: (id: string) => registry.get(id),
    create: () => { providerCalls++; throw Error('Historical compatibility test forbids provider invocation'); },
  } } };
  try {
    for (const name of files) {
      sourceHashes.set(name, hash(await readFile(join(historical, name))));
      await mkdir(dirname(join(data, name)), { recursive: true });
      await copyFile(join(historical, name), join(data, name));
    }
    // Remount historical project identities to isolated empty folders. This changes
    // only the local mount registry; original Run source provenance stays intact.
    const mounts = JSON.parse(await readFile(join(data, 'project-folders.json'), 'utf8'));
    for (const mount of mounts) { mount.root = join(dir, 'workspace', mount.projectId); await mkdir(mount.root, { recursive: true }); }
    await writeFile(join(data, 'project-folders.json'), JSON.stringify(mounts));
    const record = JSON.parse(await readFile(join(data, runtimeFile), 'utf8'));
    const scope = { projectId, workspaceId: record.spec.workspaceId, goalId: record.spec.goalId };
    const prior = canonicalRows(join(data, 'projects', projectId, 'ledger.sqlite'));
    const run = prior.find(row => row.ref.aggregateType === 'Run');
    const goal = prior.find(row => row.ref.aggregateType === 'Goal');
    expect(record.status).toBe('completed'); expect(run.status).toBe('ended'); expect(run.outcome).toBe('completed');
    expect(prior.filter(row => row.ref.aggregateType === 'Evidence')).toEqual([]);
    const rounds: unknown[] = [];
    for (let iteration = 0; iteration < 2; iteration++) {
      app = await createGuiServer(data, options);
      await new Promise<void>(done => app!.server.listen(0, '127.0.0.1', done));
      const base = 'http://127.0.0.1:' + (app.server.address() as { port: number }).port;
      const meta = await (await fetch(base + '/api/meta')).json() as any;
      expect(meta.scopes.find((row: any) => row.projectId === projectId)).toMatchObject({ projectId, workspaceId: scope.workspaceId });
      const post = async (path: string, body: unknown) => {
        const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': meta.workspaceToken }, body: JSON.stringify(body) });
        const result = await response.json(); expect(response.status).toBe(200); return result as any;
      };
      const state = await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json() as any;
      expect(state.graph.status).toBe('ready');
      expect(state.graph.graph.tasks.map((task: any) => task.taskId).sort()).toEqual(['coding-task', 'gate-goal']);
      const visible = state.liveRuns.find((row: any) => row.spec.runId === record.spec.runId);
      expect(visible).toMatchObject({ status: 'completed', canonicalStatus: 'ended', spec: { projectId, goalId: scope.goalId, taskId: 'coding-task' } });
      expect(visible.events).toEqual(record.events);
      // This endpoint returns one TaskEvidence view per matrix row, not raw
      // Evidence records. The legacy run has no verification/index to project.
      expect(state.evidence).toHaveLength(2);
      for (const view of state.evidence) expect(view).toMatchObject({ status: 'not_ready', observedCursor: state.observedCursor, requiredCursor: state.observedCursor });
      expect(state.goalStatus.status === 'ready' && state.goalStatus.goal.phase === 'COMPLETED').toBe(false);
      const receipt = await post('/api/receipts', { ...scope, kind: 'real-task', requestId: record.spec.runId.slice('real-'.length) });
      expect(receipt).toMatchObject({ found: true, runId: record.spec.runId, runStatus: 'ended', runtimeStatus: 'completed' });
      expect(await post('/api/receipts', { ...scope, kind: 'goal', requestId: scope.goalId })).toMatchObject({ found: true, goalStatus: scope.goalId });
      expect(await post('/api/receipts', { ...scope, kind: 'command-check', requestId: 'absent-historical-check' })).toMatchObject({ found: false, check: null });
      await app.close(); app = undefined;
      const after = canonicalRows(join(data, 'projects', projectId, 'ledger.sqlite'));
      expect(after.find(row => row.ref.aggregateType === 'Run')).toEqual(run);
      expect(after.find(row => row.ref.aggregateType === 'Goal')).toEqual(goal);
      expect(after.filter(row => row.ref.aggregateType === 'Evidence')).toEqual([]);
      expect(providerCalls).toBe(0);
      rounds.push({ runId: record.spec.runId, canonicalStatus: receipt.runStatus, runtimeStatus: receipt.runtimeStatus, evidenceCount: after.filter(row => row.ref.aggregateType === 'Evidence').length, verificationViews: state.evidence.map((view: any) => view.status), taskIds: state.graph.graph.tasks.map((row: any) => row.taskId), providerCalls });
    }
    const outputRoot = process.env['EVIDENCE_OUTPUT_DIR'];
    const output = outputRoot === undefined ? resolve('evidence/collaboration-memory/batch/integration/legacy-host') : resolve(outputRoot, 'legacy-host');
    await mkdir(output, { recursive: true });
    const outputName = outputRoot === undefined ? 'result-' + Date.now() + '-' + randomUUID() + '.json' : 'result.json';
    await writeFile(join(output, outputName), JSON.stringify({ historical, sourceHashes: Object.fromEntries(sourceHashes), rounds,
      boundary: 'Current production HTTP host with preserved public ledger/readmodel/runtime record; local mounts isolated. Original source checkout, Vault bodies, verification journal and kernel private sessions are absent/not copied. No real credential read, no model provider invocation; not a complete historical source-material recovery proof.' }, null, 2));
  } finally {
    await app?.close();
    for (const [name, before] of sourceHashes) expect(hash(await readFile(join(historical, name)))).toBe(before);
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);

