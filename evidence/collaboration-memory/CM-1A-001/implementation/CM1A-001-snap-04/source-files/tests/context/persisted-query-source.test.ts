import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { QueryWorkspaceSourceReader } from '../../src/data/workspace-reader/query-workspace-source-reader.js';
import { QuerySourceContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import { RuntimeObservationJournal } from '../../src/data/artifact-vault/runtime-observation-journal.js';
import type { QuerySourceObservationPort } from '../../src/contracts/query-execution-context.js';
import { planningScenario, planningScope } from '../control/planning-fixture.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type Observation = ReturnType<QuerySourceObservationPort['all']>[number];
const keyFor = (record: Observation) => createHash('sha256').update(JSON.stringify(record.runRef)).digest('hex');
const serialize = (record: Observation) => JSON.stringify(record);

it('reads reopened query observations and native current source without a runtime instance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar09-query-sources-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'workspace'), records = join(dir, 'records'); await mkdir(root); await writeFile(join(root, 'visible.txt'), 'original\n');
  await mkdir(join(root, '.oracle')); await writeFile(join(root, '.oracle', 'private.txt'), 'excluded input');
  const source = new QueryWorkspaceSourceReader((projectId, workspaceId) => {
    if (projectId !== planningScope.projectId || workspaceId !== planningScope.workspaceId) throw Error('outside registered scope');
    return root;
  });
  const original = await source.sourceRevision(planningScope.projectId, planningScope.workspaceId);
  const native = await WorkspaceSandbox.create(root, { deniedPrefixes: ['.evaluator', '.oracle', 'hidden-tests', '.git', '.env', '.env.local', '.platform-runtime'] });
  expect(original).toBe((await native.captureBaseline()).revision);
  expect(original).not.toBeNull();
  expect(await source.sourceRevision('other-project', planningScope.workspaceId)).toBeNull();
  const scenario = await planningScenario();
  const record: Observation = {
    runRef: { aggregateType: 'QueryRun', projectId: planningScope.projectId, workspaceId: planningScope.workspaceId, queryJobId: 'stored-query', runId: 'shared-local-run' },
    status: 'completed', sourceAfter: original,
    input: JSON.stringify({ material: { goalContext: { ref: { aggregateType: 'Goal', projectId: planningScope.projectId, goalId: planningScope.goalId }, revision: 1, workspaceRevision: 1 } } }),
  };
  const journal = new RuntimeObservationJournal<Observation>(records, { keyFor, serialize, writeOrder: 'global' }); await journal.init();
  await journal.save(record);
  await journal.save({ ...record, runRef: { ...record.runRef, projectId: 'other-project' }, sourceAfter: 'foreign-source' });
  // A fresh Data reader is sufficient; there is no runtime object to call.
  const reopened = new RuntimeObservationJournal<Observation>(records, { keyFor, serialize, writeOrder: 'global' }); await reopened.init();
  const compiler = new QuerySourceContextCompiler({ ledger: () => scenario.h.ledger, observations: reopened.observations, source });
  expect(await compiler.currentness(planningScope.projectId, planningScope.workspaceId)).toEqual(new Map([['stored-query', true]]));
  expect(await compiler.currentness(planningScope.projectId, 'unregistered-workspace')).toEqual(new Map());
  expect(await compiler.currentness('other-project', planningScope.workspaceId)).toEqual(new Map([['stored-query', false]]));
  await writeFile(join(root, 'visible.txt'), 'changed\n');
  expect(await compiler.currentness(planningScope.projectId, planningScope.workspaceId)).toEqual(new Map([['stored-query', false]]));
});
