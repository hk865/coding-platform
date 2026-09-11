import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeObservationJournal } from '../../src/data/artifact-vault/runtime-observation-journal.js';
import { CodingAgentRuntime, type RuntimeRecord, type RunSpec, type BoundModel } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import { ReadOnlyQueryRuntime, type QueryRuntimeRecord } from '../../src/execution/worker-runtime/read-only-query-runtime.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'ar09-observations-')); cleanup.push(() => rm(dir, { recursive: true, force: true })); return dir; }
const noModel = async (): Promise<BoundModel> => { throw Error('recovery must not bind a model'); };
const runtimeKey = (spec: RunSpec) => sha(JSON.stringify([spec.projectId, spec.goalId, spec.runId]));

describe('persisted runtime observation journal', () => {
  it.each(['duplicate', 'wrong_filename'] as const)('retains ambiguous disk facts and prevents Runtime recovery or overwrite (%s)', async corruption => {
    const dir = await directory();
    type Observation = { id: string; status: string };
    const key = sha('review-run'), valid = { id: key, status: 'failed' }, uncertain = { id: key, status: 'outcome_unknown' };
    const original = JSON.stringify(valid), other = JSON.stringify(uncertain);
    if (corruption === 'duplicate') await writeFile(join(dir, key + '.json'), original);
    const misplaced = join(dir, sha('another-file') + '.json');
    await writeFile(misplaced, corruption === 'duplicate' ? other : original);
    const journal = new RuntimeObservationJournal<Observation>(dir, { keyFor: record => record.id, serialize: JSON.stringify, writeOrder: 'per_record' });
    expect(await journal.init()).toEqual([]);
    expect(journal.observations.integrityIssues!()).toHaveLength(1);
    expect(journal.observations.all()).toHaveLength(corruption === 'duplicate' ? 2 : 1);
    if (corruption === 'duplicate') expect(journal.observations.all()).toContainEqual(uncertain);
    await expect(journal.save(valid)).rejects.toThrow();
    expect(await readFile(misplaced, 'utf8')).toBe(corruption === 'duplicate' ? other : original);
    if (corruption === 'duplicate') expect(await readFile(join(dir, key + '.json'), 'utf8')).toBe(original);
    // Re-reading does not accumulate synthetic duplicates or erase diagnostics.
    expect(await journal.init()).toEqual([]);
    expect(journal.observations.all()).toHaveLength(corruption === 'duplicate' ? 2 : 1);
  });
  it.each(['global', 'per_record'] as const)('captures queued bytes and only publishes committed snapshots (%s)', async writeOrder => {
    const dir = await directory();
    type Observation = { id: string; payload: { revision: number }; status: string };
    const journal = new RuntimeObservationJournal<Observation>(dir, { keyFor: record => record.id, serialize: record => JSON.stringify(record) + '\n', writeOrder });
    await journal.init();
    const record = { id: sha('one'), payload: { revision: 1 }, status: 'running' };
    const first = journal.save(record);
    record.payload.revision = 2;
    const second = journal.save(record);
    record.payload.revision = 99;
    expect(journal.observations.all()).toEqual([]);
    await Promise.all([first, second]);
    const expected = { ...record, payload: { revision: 2 } };
    expect(await readFile(join(dir, record.id + '.json'), 'utf8')).toBe(JSON.stringify(expected) + '\n');
    expect(journal.observations.all()).toEqual([expected]);
    journal.observations.all()[0]!.payload.revision = 100;
    expect(journal.observations.all()).toEqual([expected]);
    const blocked = { id: sha('blocked'), payload: { revision: 3 }, status: 'completed' };
    await mkdir(join(dir, blocked.id + '.json'));
    await expect(journal.save(blocked)).rejects.toThrow();
    expect(journal.observations.all()).toEqual([expected]);
    await rm(join(dir, blocked.id + '.json'), { recursive: true });
    await journal.save(blocked);
    expect(journal.observations.all()).toEqual([expected, blocked]);
    expect((await readdir(dir)).every(file => /^[a-f0-9]{64}\.json$/.test(file))).toBe(true);
    const reopened = new RuntimeObservationJournal<Observation>(dir, { keyFor: record => record.id, serialize: record => JSON.stringify(record) + '\n', writeOrder });
    await reopened.init();
    expect(reopened.observations.all().sort((a, b) => a.id.localeCompare(b.id))).toEqual([expected, blocked].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('recovers both Runtime protocols without executing, retaining old identities, bytes and scope', async () => {
    const dir = await directory(), root = join(dir, 'workspace'), runs = join(dir, 'runs'), queries = join(dir, 'queries');
    await mkdir(root); await mkdir(runs); await mkdir(queries);
    const spec: RunSpec = { projectId: 'project-a', workspaceId: 'workspace-a', goalId: 'same-goal', taskId: 'task', runId: 'same-run', root, instruction: 'old input', budget: DEFAULT_RUNTIME_BUDGET };
    const base: RuntimeRecord = { spec, status: 'running', sessionId: 'old-session', configuration: null, events: [], trace: [], usage: [], error: null, nodeSha256: null, workspaceRevision: null, cancelRequested: false };
    const other: RuntimeRecord = { ...base, spec: { ...spec, projectId: 'project-b', workspaceId: 'workspace-b' }, status: 'completed' };
    const originalOther = JSON.stringify(other);
    await writeFile(join(runs, runtimeKey(base.spec) + '.json'), JSON.stringify(base));
    await writeFile(join(runs, runtimeKey(other.spec) + '.json'), originalOther);
    const runtime = new CodingAgentRuntime(runs, noModel); await runtime.init(); cleanup.push(() => runtime.close());
    const recovered = runtime.observations.all().find(r => r.spec.projectId === 'project-a')!;
    expect(recovered).toMatchObject({ status: 'outcome_unknown', error: '宿主服务中断；工作区副作用须核对，未自动重跑。', spec });
    expect(await readFile(join(runs, runtimeKey(spec) + '.json'), 'utf8')).toBe(JSON.stringify(recovered) + '\n');
    expect(await readFile(join(runs, runtimeKey(other.spec) + '.json'), 'utf8')).toBe(originalOther);
    runtime.all = () => { throw Error('Data reads must not call live Runtime'); };
    expect(runtime.observations.all()).toHaveLength(2);
    expect(runtime.observations.all().find(r => r.spec.projectId === 'project-b')?.spec.workspaceId).toBe('workspace-b');

    const query: QueryRuntimeRecord = { id: sha('query-id'), runRef: { aggregateType: 'QueryRun', projectId: 'project-a', workspaceId: 'workspace-a', queryJobId: 'old-query', runId: 'old-query-run' }, fingerprint: sha('original-request'), sessionId: 'old-query-session', status: 'running', kind: 'semantic_query', roleBinding: null, input: '{}', inputDigest: sha('{}'), budget: DEFAULT_RUNTIME_BUDGET, configuration: null, usage: [], trace: [], sourceBefore: 'source-before', sourceAfter: null, result: null };
    await writeFile(join(queries, query.id + '.json'), JSON.stringify(query));
    const queryRuntime = new ReadOnlyQueryRuntime(queries, { materials: { assemble: async () => { throw Error('recovery must not compile materials'); } }, rootFor: () => root, bind: noModel });
    await queryRuntime.init(); cleanup.push(() => queryRuntime.close());
    queryRuntime.all = () => { throw Error('Data reads must not call live QueryRuntime'); };
    expect(queryRuntime.observations.all()).toEqual([{ ...query, status: 'outcome_unknown' }]);
    expect(await readFile(join(queries, query.id + '.json'), 'utf8')).toBe(JSON.stringify({ ...query, status: 'outcome_unknown' }));
  });

  it('does not expose a prepared live record when its first durable save fails', async () => {
    const dir = await directory(), root = join(dir, 'workspace'), runs = join(dir, 'runs'); await mkdir(root);
    const runtime = new CodingAgentRuntime(runs, async () => ({ configuration: { revision: 'test', provider: 'test', model: 'test', baseUrl: 'http://unused.invalid' }, client: {} as BoundModel['client'] }));
    await runtime.init(); cleanup.push(() => runtime.close());
    const spec: RunSpec = { projectId: 'project', workspaceId: 'workspace', goalId: 'goal', taskId: 'task', runId: 'run', root, instruction: 'never started', budget: DEFAULT_RUNTIME_BUDGET };
    await mkdir(join(runs, runtimeKey(spec) + '.json'));
    await expect(runtime.prepare(spec)).rejects.toThrow();
    expect(runtime.all()).toHaveLength(1);
    expect(runtime.observations.all()).toEqual([]);
  });
});
