/**
 * KLS-1b rows 04 and 04b: `readAcrossProjects` reads every requested project
 * once, in the caller's order, with that project's own `readThrough`; an
 * unopened project is `unavailable` while the others still read.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { tempDir } from '../helpers/A2-restart-fixture.js';
import {
  hostCtx, realFactory, realLease, reliableLocation, runtimeModule,
} from '../helpers/KLS1A-project-store-fixture.js';

const WS = 'kls1b-ws';
const wsRef = (projectId: string) => ({ aggregateType: 'Workspace' as const, projectId, workspaceId: WS });
const goalRef = (projectId: string) => ({ aggregateType: 'Goal' as const, projectId, goalId: 'kls1b-goal' });
const wsKey = (projectId: string) => canonicalJson(wsRef(projectId));
const goalKey = (projectId: string) => canonicalJson(goalRef(projectId));

async function openProjects(backend: 'memory' | 'sqlite') {
  const modules = await runtimeModule();
  const legacyDirectory = await tempDir('kls1b-04-legacy-');
  const rootA = await tempDir('kls1b-04-a-');
  const rootB = await tempDir('kls1b-04-b-');
  const registry = await modules['createProjectRuntimeRegistry']?.({
    storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', legacyDirectory },
    acquireLease: realLease,
    createPlatform: realFactory([]),
    location: reliableLocation,
  });
  expect(registry, 'createProjectRuntimeRegistry must be available').toBeTruthy();
  return { registry, readAcrossProjects: modules['readAcrossProjects'], rootA, rootB };
}

async function seedProject(registry: any, projectId: string, root: string): Promise<any> {
  const opened = await registry.open(projectId, [{ workspaceId: WS, root }], { create: true });
  expect(opened.status, `open ${projectId}`).toBe('ready');
  const ctx = hostCtx(projectId, WS);
  const platform = registry.get(projectId).platform;
  const project = { aggregateType: 'Project' as const, projectId };
  const workspace = wsRef(projectId);
  const goal = goalRef(projectId);
  const created = await platform.projects.createProject(ctx, {
    input: { projectId }, meta: { requestId: `kls1b-04-${projectId}-p`, expected: [{ ref: project, revision: 0 }] },
  });
  expect(created.status).toBe('committed');
  const registered = await platform.projects.registerWorkspace(ctx, {
    input: { workspace: { projectId, workspaceId: WS } },
    meta: { requestId: `kls1b-04-${projectId}-w`, expected: [{ ref: project, revision: 1 }, { ref: workspace, revision: 0 }] },
  });
  expect(registered.status).toBe('committed');
  const goalCreated = await platform.goals.createGoal(ctx, {
    input: { goalId: 'kls1b-goal', workspace: { projectId, workspaceId: WS }, objective: 'KLS-1b 04' },
    meta: { requestId: `kls1b-04-${projectId}-g`, expected: [{ ref: project, revision: 1 }, { ref: workspace, revision: 1 }] },
  });
  expect(goalCreated.status).toBe('committed');
  return { ctx, platform, goal, goalCreated };
}

describe('KLS-1b read across projects', () => {
  it.each(['memory', 'sqlite'] as const)('04 reads each project once with its own readThrough (%s)', async backend => {
    const { registry, readAcrossProjects, rootA, rootB } = await openProjects(backend);
    try {
      const b = await seedProject(registry, 'kls1b-b', rootB);
      const a = await seedProject(registry, 'kls1b-a', rootA);
      const cancelled = await a.platform.goals.setGoalControl(a.ctx, {
        input: { goalRef: a.goal, control: 'cancel', reason: 'KLS-1b 04' },
        meta: {
          requestId: 'kls1b-04-a-cancel',
          expected: [{ ref: a.goal, revision: 1 },
            { ref: { aggregateType: 'GoalPhase', projectId: 'kls1b-a', goalId: 'kls1b-goal' }, revision: 0 }],
        },
      });
      expect(cancelled.status).toBe('committed');
      const last = { A: cancelled, B: b.goalCreated };
      const keys = [wsKey('kls1b-a'), goalKey('kls1b-a'), wsKey('kls1b-b'), goalKey('kls1b-b')];

      expect(readAcrossProjects, 'readAcrossProjects must be available').toBeTypeOf('function');
      const out = await readAcrossProjects(registry, ['kls1b-b', 'kls1b-a'], async (records: any) => {
        const read = await records.readMany(keys);
        if (read.status !== 'ready') throw new Error(read.reason);
        return read.value;
      });

      expect(out.map((entry: any) => entry.projectId)).toEqual(['kls1b-b', 'kls1b-a']);
      const bKeys = [wsKey('kls1b-b'), goalKey('kls1b-b')].sort();
      const aKeys = [wsKey('kls1b-a'), goalKey('kls1b-a')].sort();
      expect(out[0].result.value.records.map((record: any) => record.refKey).sort()).toEqual(bKeys);
      expect(out[0].result.value.missing.slice().sort()).toEqual(aKeys);
      expect(out[1].result.value.records.map((record: any) => record.refKey).sort()).toEqual(aKeys);
      expect(out[1].result.value.missing.slice().sort()).toEqual(bKeys);
      expect(out[0].result.value.readThrough).toBe(last.B.cursor);
      expect(out[1].result.value.readThrough).toBe(last.A.cursor);
    } finally {
      await registry.closeAll();
    }
  }, 120_000);

  it('04b reports an unopened project as unavailable without failing the others (memory)', async () => {
    const { registry, readAcrossProjects, rootA } = await openProjects('memory');
    try {
      const opened = await registry.open('kls1b-a', [{ workspaceId: WS, root: rootA }], { create: true });
      expect(opened.status).toBe('ready');
      expect(readAcrossProjects, 'readAcrossProjects must be available').toBeTypeOf('function');
      const out = await readAcrossProjects(registry, ['missing', 'kls1b-a'],
        async (records: any) => (await records.readMany([])).status);
      expect(out[0].result).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(out[1].result).toEqual({ status: 'ready', value: 'ready' });
    } finally {
      await registry.closeAll();
    }
  }, 60_000);
});
