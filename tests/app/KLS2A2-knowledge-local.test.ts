/**
 * KLS-2a-2 rows H2 and H3 (level 1): "architecture and notes stay local" on a real Host (memory) whose project A
 * is a command-line workspace on a real git root (`openKLS1BTwoProjects` with `gitA`); project B opens through the
 * public settings `workspaces/open`. The steps are the settings routes `knowledge-local` and `snapshot`; the checks
 * are the product's own outputs: `<git-common-dir>/info/exclude` (here `<root>/.git/info/exclude`) and the snapshot.
 */
import { existsSync, readFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { openKLS1BTwoProjects, type KLS1BTwoProjects } from '../helpers/KLS1B-two-projects.js';

const MARKER = '# dsh: architecture and notes stay local';
const worlds: KLS1BTwoProjects[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.dispose(); });

async function openWorld(): Promise<KLS1BTwoProjects> {
  const world = await openKLS1BTwoProjects({ backend: 'memory', gitA: true });
  worlds.push(world);
  return world;
}

const excludeOf = (world: KLS1BTwoProjects): string => join(world.rootA, '.git', 'info', 'exclude');
const linesOf = (path: string): string[] => readFileSync(path, 'utf8').split('\n');

async function setLocalOnly(world: KLS1BTwoProjects, scope: CoreScope, localOnly: boolean): Promise<unknown> {
  return (await world.settings('knowledge-local', { projectId: scope.projectId, workspaceId: scope.workspaceId, localOnly })).body;
}

/** The snapshot's entry for one workspace (`POST settings/snapshot {}`). */
async function snapshotEntry(world: KLS1BTwoProjects, scope: CoreScope): Promise<unknown> {
  const body = (await world.settings('snapshot', {})).body as { value?: { workspaces?: Array<{ scope: CoreScope }> } };
  return body.value?.workspaces?.find(entry => entry.scope.projectId === scope.projectId
    && entry.scope.workspaceId === scope.workspaceId);
}

it('H2 knowledge-local writes its marked block into info/exclude once, the snapshot shows it, and off removes only that block', async () => {
  const world = await openWorld();
  const exclude = excludeOf(world);
  // The person's own `.workbench/` line, already the last line before the setting is touched.
  await appendFile(exclude, '.workbench/\n');
  expect(await setLocalOnly(world, world.A, true)).toMatchObject({ status: 'ready' });
  const on = linesOf(exclude);
  const at = on.indexOf(MARKER);
  expect(on.slice(at, at + 2)).toEqual([MARKER, '.workbench/']);
  expect(existsSync(join(world.rootA, '.gitignore'))).toBe(false);
  expect(await setLocalOnly(world, world.A, true)).toMatchObject({ status: 'ready' });
  expect(linesOf(exclude)).toHaveLength(on.length);
  expect(await snapshotEntry(world, world.A)).toMatchObject({ knowledgeLocalOnly: true });
  expect(await setLocalOnly(world, world.A, false)).toMatchObject({ status: 'ready' });
  const off = linesOf(exclude);
  expect(off).toContain('.workbench/');
  expect(off).toEqual([...on.slice(0, at), ...on.slice(at + 2)]);
}, 120_000);

it('H3 two projects on one git checkout share the setting: B sees A turn it on, with one block in info/exclude', async () => {
  const world = await openWorld();
  const opened = await world.settings('workspaces/open',
    { path: world.rootA, projectId: world.B.projectId, writeAllowed: false, commandsAllowed: false });
  const shared = (opened.body as { value?: { scope?: CoreScope } }).value?.scope;
  if (shared?.projectId !== world.B.projectId) throw new Error(`project B did not open the git root: ${JSON.stringify(opened.body)}`);
  expect(await setLocalOnly(world, world.A, true)).toMatchObject({ status: 'ready' });
  expect(await snapshotEntry(world, shared)).toMatchObject({ knowledgeLocalOnly: true });
  expect(linesOf(excludeOf(world)).filter(line => line === MARKER)).toHaveLength(1);
}, 120_000);
