/**
 * KLS-1b rows 01, 02, 09, 11, 12, 13 and 14: a Host starts one runtime per
 * project, keeps a manifest project whose store is gone unavailable, starts
 * with a listed project's workspace directory gone, registers a command-line
 * workspace only after its records exist, refuses the old single-store layout,
 * and publishes each project's store location.
 */
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart, publicDirectory, tempDir } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  hostProjectStoreDirectory, hostReconcile, openKLS1BTwoProjects,
  type KLS1BTwoProjects,
} from '../helpers/KLS1B-two-projects.js';

let fixture: KLS1BTwoProjects | undefined;

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
  await cleanupRestart();
});

const goalRef = (projectId: string, goalId: string) => ({ aggregateType: 'Goal' as const, projectId, goalId });

describe('KLS-1b start-up per project', () => {
  it('01 opens each project once and keeps both across a restart (SQLite only)', async () => {
    fixture = await openKLS1BTwoProjects({ backend: 'sqlite' });
    for (const [scope, goalId] of [[fixture.A, 'kls1b-01-a'], [fixture.B, 'kls1b-01-b']] as const) {
      const created = await fixture.createGoal(scope, goalId);
      expect(created.status).toBe(200);
      expect(created.body.status).toBe('committed');
    }

    await fixture.restart();

    const readA = await fixture.post(fixture.A, 'goals/read', plain(fixture.A, goalRef('kls1b-a', 'kls1b-01-a')));
    expect(readA.status).toBe(200);
    expect(readA.body.status).toBe('ready');
    const readB = await fixture.post(fixture.B, 'goals/read', plain(fixture.B, goalRef(fixture.B.projectId, 'kls1b-01-b')));
    expect(readB.status).toBe(200);
    expect(readB.body.status).toBe('ready');
    const listA = await fixture.post(fixture.A, 'goals/list', plain(fixture.A, { workspace: fixture.A }));
    expect(listA.body.value.goals.map((goal: any) => goal.ref.goalId)).toEqual(['kls1b-01-a']);
    const listB = await fixture.post(fixture.B, 'goals/list', plain(fixture.B, { workspace: fixture.B }));
    expect(listB.body.value.goals.map((goal: any) => goal.ref.goalId)).toEqual(['kls1b-01-b']);
    expect(hostReconcile(fixture.host, 'kls1b-a').report?.problems).toEqual([]);
    expect(hostReconcile(fixture.host, fixture.B.projectId).report?.problems).toEqual([]);
  }, 120_000);

  it.each([
    { label: 'B opened over the settings route', cliB: false },
    { label: 'B is a command-line workspace', cliB: true },
  ])('02 keeps a manifest project unavailable when its store is gone ($label, SQLite only)', async ({ cliB }) => {
    fixture = await openKLS1BTwoProjects({ backend: 'sqlite', cliB });
    if (cliB) await fixture.restart();
    const store = await hostProjectStoreDirectory(fixture.B.projectId, fixture.rootB);
    await fixture.close();
    await rm(store, { recursive: true, force: true });
    await fixture.start();

    const listB = await fixture.post(fixture.B, 'goals/list', plain(fixture.B, { workspace: fixture.B }));
    expect(listB.status).toBe(503);
    expect(listB.body).toEqual({ status: 'rejected', code: 'unavailable', reason: 'the project store is not available' });
    expect(existsSync(store)).toBe(false);
    const listA = await fixture.post(fixture.A, 'goals/list', plain(fixture.A, { workspace: fixture.A }));
    expect(listA.status).toBe(200);
  }, 120_000);

  it('14 starts when a listed project’s workspace directory is gone (SQLite only)', async () => {
    fixture = await openKLS1BTwoProjects({ backend: 'sqlite' });
    await fixture.createGoal(fixture.A, 'kls1b-14-a-before');
    await fixture.createGoal(fixture.B, 'kls1b-14-b-before');
    await fixture.close();
    await rm(fixture.rootB, { recursive: true, force: true });
    await fixture.start();

    const listB = await fixture.post(fixture.B, 'goals/list', plain(fixture.B, { workspace: fixture.B }));
    expect(listB.status).toBe(503);
    expect(listB.body).toEqual({ status: 'rejected', code: 'unavailable', reason: 'the project store is not available' });

    const created = await fixture.createGoal(fixture.A, 'kls1b-14-a-after');
    expect(created.status).toBe(200);
    expect(created.body.status).toBe('committed');
    const readA = await fixture.post(fixture.A, 'goals/read',
      plain(fixture.A, goalRef('kls1b-a', 'kls1b-14-a-after')));
    expect(readA.status).toBe(200);
    expect(readA.body.status).toBe('ready');
  });

  it('09 declares a command-line project only after its records exist (SQLite only)', async () => {
    fixture = await openKLS1BTwoProjects({ backend: 'sqlite' });
    expect(existsSync(await hostProjectStoreDirectory('kls1b-a', fixture.rootA))).toBe(true);

    await fixture.restart();
    const d = { scope: { projectId: 'kls1b-d', workspaceId: 'kls1b-d-ws' }, root: await tempDir('kls1b-09-d-') };
    await fixture.restart({ cli: [d] });

    const listA = await fixture.post(fixture.A, 'goals/list', plain(fixture.A, { workspace: fixture.A }));
    expect(listA.status).toBe(200);
    expect(listA.body.status).toBe('ready');
  }, 120_000);

  it('11 does not register a Kernel entry twice on restart (SQLite only)', async () => {
    fixture = await openKLS1BTwoProjects({ backend: 'sqlite' });
    const rootA2 = await tempDir('kls1b-11-ws-');
    const opened = await fixture.settings('workspaces/open', {
      path: rootA2, projectId: 'kls1b-a', writeAllowed: false, commandsAllowed: false,
    });
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('ready');
    const A2: CoreScope = opened.body.value.scope;
    await fixture.close();

    const kernelDir = await tempDir('kls1b-11-kernel-');
    await fixture.start({ extra: { kernelStores: { entries: [{
      adapterId: 'kls1b-11-kernel', storeKey: 'kls1b-11-kernel-store', workspace: A2,
      databasePath: join(kernelDir, 'kernel-a2.sqlite'),
    }] } } });

    const listA2 = await fixture.post(A2, 'goals/list', plain(A2, { workspace: A2 }));
    expect(listA2.status).toBe(200);
  }, 120_000);

  it('12 refuses the old single-store layout and names it', async () => {
    const directory = await tempDir('kls1b-12-store-');
    const root = await tempDir('kls1b-12-root-');
    const publicDir = await publicDirectory();
    await writeFile(join(directory, 'ledger.sqlite'), '');
    let started: LocalWorkbenchHost | undefined;
    const starting = createLocalWorkbenchHost({
      storage: { kind: 'sqlite', directory },
      actor: { kind: 'human', id: 'kls1b-12' },
      publicDir,
      workspaces: [{ scope: { projectId: 'kls1b-a', workspaceId: 'kls1b-a-ws' },
        name: 'kls1b-a-ws', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    }).then(host => { started = host; return host; });
    try {
      await expect(starting).rejects.toThrow(
        new Error('store layout changed: the old single-store layout is not loaded or migrated'));
    } finally {
      await started?.close();
    }
    expect(existsSync(await hostProjectStoreDirectory('kls1b-a', root))).toBe(false);
  }, 60_000);

  it('13 publishes each project workspace’s store location (SQLite only)', async () => {
    fixture = await openKLS1BTwoProjects({ backend: 'sqlite', gitA: true });
    const snapshot = await fixture.settings('snapshot', {});
    expect(snapshot.status).toBe(200);
    const workspaces = snapshot.body.value.workspaces as Array<{ scope: CoreScope; storeLocation?: unknown }>;
    const a = workspaces.find(workspace => workspace.scope.projectId === 'kls1b-a');
    const b = workspaces.find(workspace => workspace.scope.projectId === fixture!.B.projectId);
    expect(a?.storeLocation).toEqual({ place: 'git-common', reason: null });
    expect(b?.storeLocation).toEqual({ place: 'workspace-local', reason: null });
  }, 120_000);
});
