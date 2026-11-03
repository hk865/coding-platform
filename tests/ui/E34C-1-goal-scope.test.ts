import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createHostClient } from '../../src/ui/host-client.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { until } from '../helpers/change-stream-reader.js';
import { bootPage, findClass } from './helpers/boot-page.js';

/** E3-4c item 1 (decision 104-1): `?goal=` names a Goal of any opened project.
 * The Host lists another project's workspace first, as a CLI start with a
 * placeholder workspace does; the page reads the Goal in the project that
 * holds it, not in the first workspace. */
let world: S6AHostWorld | undefined;
let root = '';

afterAll(async () => {
  await world?.close();
  world = undefined;
  if (root !== '') await rm(root, { recursive: true, force: true });
});

describe('E34C-1 the page reads a goal in the project that holds it', () => {
  it('E34C-1 a goal of the second workspace is the page data', async () => {
    world = await openS6AHostWorld({ backend: 'memory', defaultGoals: false });
    root = await mkdtemp(join(tmpdir(), 'e34c-1-'));
    const opened = await world.settings('workspaces/open', { path: root, writeAllowed: false, commandsAllowed: false });
    if (opened.status !== 'ready') throw new Error(`E34C-1: workspaces/open was refused: ${JSON.stringify(opened)}`);
    const scope = opened.value.scope;
    const listed = (await createHostClient(world.token, new URL(world.base).origin).bootstrap()).workspaces;
    expect(listed.map((entry) => entry.scope.projectId)).toEqual([S6A_SCOPE.projectId, scope.projectId]);
    await s6aCardsWorkspace(world, scope).createGoal('e34c-1-goal', 'E34C 第二个项目的目标');

    const host = world;
    const page = await bootPage({ name: 'TaskMap', search: '?goal=e34c-1-goal', token: host.token,
      request: async (url, init, realFetch) => realFetch(new URL(url, host.base).href, init) });
    try {
      await until(() => /这个目标还没有采用的计划|找不到这个目标/.test(page.root.textContent), 20_000);
      expect(page.root.textContent).not.toContain('找不到这个目标');
      expect(findClass(page.root, 'tm-gname')!.textContent).toBe('E34C 第二个项目的目标');
      expect(page.root.textContent).toContain('这个目标还没有采用的计划');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
