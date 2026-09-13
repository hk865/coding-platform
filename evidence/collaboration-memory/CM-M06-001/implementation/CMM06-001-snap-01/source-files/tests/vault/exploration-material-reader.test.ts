import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import { ExplorationMaterialReader } from '../../src/data/artifact-vault/exploration-material-reader.js';
import { ExplorationContextDrive } from '../../src/control/dispatch-engine/exploration-context-drive.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { ExplorationScope } from '../../src/contracts/exploration.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const scope = { projectId: 'project', workspaceId: 'workspace', goalId: 'goal' };
const scopeKey = (scope: ExplorationScope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'exploration-materials-')); directories.push(directory);
  const planFile = join(directory, 'plan-' + sha256Hex(scopeKey(scope)) + '.json');
  // Raw historical JSON is intentionally opaque to the Data reader. Context validates its business meaning.
  const plan = { ...scope, planId: 'plan', planOrigin: 'operator', status: 'accepted', tasks: [] };
  await writeFile(planFile, JSON.stringify(plan));
  return { directory, planFile, plan, reader: new ExplorationMaterialReader({ directory }) };
}

it('reads the existing JSON identity directly, filters every scope component and reopens without its writers', async () => {
  const fixture = await setup();
  const report = { ...scope, runId: 'run', taskId: 'task', report: 'original report' };
  const review = { ...scope, reviewId: 'review', runId: 'run', taskId: 'task', verdict: 'FAIL', control: { status: 'pending' } };
  const reportFile = join(fixture.directory, 'report-' + sha256Hex(scopeKey(scope) + report.runId) + '.json');
  await writeFile(reportFile, JSON.stringify(report));
  await writeFile(join(fixture.directory, 'review-' + sha256Hex('review') + '.json'), JSON.stringify(review));
  for (const [key, value] of Object.entries(scope)) {
    const foreign = { ...scope, [key]: value + '-foreign', runId: 'run' };
    await writeFile(join(fixture.directory, 'report-' + sha256Hex(key) + '.json'), JSON.stringify(foreign));
    await writeFile(join(fixture.directory, 'review-' + sha256Hex(key) + '.json'), JSON.stringify(foreign));
  }
  await writeFile(join(fixture.directory, 'report-in-progress.tmp'), '{incomplete');
  const before = await readFile(fixture.planFile, 'utf8');
  const first = await fixture.reader.read(scope);
  expect(first).toEqual({ plan: fixture.plan, reports: [report], reviews: [review] });
  first.reports[0]!.report = 'changed caller memory';
  expect(await new ExplorationMaterialReader({ directory: fixture.directory }).read(scope))
    .toEqual({ plan: fixture.plan, reports: [report], reviews: [review] });
  await writeFile(reportFile, JSON.stringify({ ...report, report: 'persisted update' }));
  expect((await fixture.reader.read(scope)).reports[0]!.report).toBe('persisted update');
  expect(await readFile(fixture.planFile, 'utf8')).toBe(before);
});

it('does not recover pending plans, accept a foreign plan body, or invent a missing plan', async () => {
  const fixture = await setup();
  await writeFile(fixture.planFile, JSON.stringify({ ...fixture.plan, status: 'pending' }));
  await expect(fixture.reader.read(scope)).rejects.toThrow('该目标没有已接受的探索计划');
  expect(JSON.parse(await readFile(fixture.planFile, 'utf8')).status).toBe('pending');
  await writeFile(fixture.planFile, JSON.stringify({ ...fixture.plan, workspaceId: 'foreign' }));
  await expect(fixture.reader.read(scope)).rejects.toThrow('该目标没有已接受的探索计划');
  await expect(fixture.reader.read({ ...scope, goalId: 'missing' })).rejects.toThrow('该目标没有已接受的探索计划');
});

it('sends disk materials to Context before any grant and rejects a foreign execution scope before reading', async () => {
  const fixture = await setup();
  const read = vi.spyOn(fixture.reader, 'read');
  const select = vi.fn(async (): Promise<never> => { throw Error('Context rejected source or predecessor applicability'); });
  const unavailable = vi.fn(async (): Promise<never> => { throw Error('unexpected grant or artifact access'); });
  const drive = new ExplorationContextDrive({ materials: fixture.reader,
    context: { prerequisites: () => [], select, assemble: unavailable },
    control: { grantMaterialAccess: unavailable }, vault: { put: unavailable, open: unavailable } });
  const spec = { ...scope, mode: 'explore' as const, runId: 'run', taskId: 'task', root: '/source', instruction: 'read', budget: DEFAULT_RUNTIME_BUDGET };
  // The scope guard and the injected Context consume only these envelope fields in this test.
  const envelope = { ...scope, taskId: 'task', runRef: { runId: 'run' } } as TaskEnvelopeV1;
  await expect(drive.assembleRun({ ...spec, workspaceId: 'foreign' }, envelope)).rejects.toThrow('探索上下文范围不匹配');
  expect(read).not.toHaveBeenCalled();
  await expect(drive.assembleRun(spec, envelope)).rejects.toThrow('Context rejected source or predecessor applicability');
  expect(select).toHaveBeenCalledWith({ envelope, plan: fixture.plan, reports: [], reviews: [] });
  expect(unavailable).not.toHaveBeenCalled();
});
