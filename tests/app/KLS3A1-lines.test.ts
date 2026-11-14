/**
 * KLS-3a1 (test writer, decision 117): the Host makes a workspace's line when the person opens a folder
 * (`workspaces/open`, start rulings draft §2.7) and `workspaces/lines` reads it (the lead's 11-13 ruling 4). Rows 3A1-01 and
 * 3A1-10 of the draft's §3: one `openKLS2CHost` (memory) whose settings route opens a new folder as a new project, as
 * the person does; then the public `workspaces/lines`, `goals/create` and `goals/read`. Expected values come from the test's
 * own git and realpath (F8); the line key is `canonicalJson([workspaceId, folder])` (ruling 2) and `firstCommit` is
 * nullable (ruling 3).
 *
 * Red today (7c862a02): there is no `workspaces/lines` route (the answer is not `ready`) and Goals carry no `lineRef`. Green
 * when KLS-3a1's Host registers the line on open (`platform.projects.registerLine`) and the route reads the records.
 */
import { realpathSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { kls3a1Checkout } from '../helpers/KLS2A-knowledge-world.js';
import { openKLS2CHost, type KLS2CHost } from '../helpers/KLS2C-knowledge-host.js';
import { gitIn, initGitWorkspace } from '../scenarios/support/git-workspace.js';
import { projectRef, workspaceRef } from './support/S8A-L8-host.js';

const hosts: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of hosts.splice(0)) await world.close();
  await cleanupRestart();
});

async function openHost(): Promise<KLS2CHost> {
  const world = await openKLS2CHost({ storage: 'memory', git: false });
  hosts.push(world);
  return world;
}

/** The person opens `folder` as a new project (`workspaces/open` without a projectId); the new scope. */
async function openFolder(world: KLS2CHost, folder: string): Promise<CoreScope> {
  const opened = await world.settings<{ status: string; value?: { scope: CoreScope } }>('workspaces/open',
    { path: folder, writeAllowed: false, commandsAllowed: false });
  if (opened.status !== 'ready' || opened.value === undefined) throw new Error(`workspaces/open: ${JSON.stringify(opened)}`);
  return opened.value.scope;
}

/** `workspaces/lines` of the scope's workspace: its lines, or the row fails with the answer. */
async function linesOf(world: KLS2CHost, scope: CoreScope): Promise<unknown[]> {
  const read = await world.call<{ status: string; value?: { lines: unknown[] } }>('workspaces/lines',
    plain(scope, { workspaceId: scope.workspaceId }));
  if (read.status !== 'ready' || read.value === undefined) throw new Error(`workspaces/lines: ${JSON.stringify(read)}`);
  return read.value.lines;
}

/** The line record the rulings give (the clock's `createdAt` aside). */
function lineRecord(scope: CoreScope, line: { repoKey: string; folder: string; branch: string; firstCommit: string | null },
  forkPoint: string | null) {
  return { ref: { aggregateType: 'Line', projectId: scope.projectId, workspaceId: scope.workspaceId,
    lineRef: JSON.stringify([scope.workspaceId, line.folder]) },
  revision: 1, ...line, forkPoint, status: 'open', createdAt: expect.any(String), closedAt: null };
}

describe('KLS-3a1 the Host makes the line of a folder the person opens', () => {
  it('3A1-01 a git folder: one open line with its repository, folder, branch, first commit and fork point', async () => {
    /* Named mutation: drop the Host's `platform.projects.registerLine` call on open — `workspaces/lines` is empty. */
    const world = await openHost();
    const folder = await tempDir('kls3a1-git-');
    await initGitWorkspace(folder);
    // A second commit, so the fork point (HEAD when the line is made) is not the first commit.
    gitIn(folder, 'commit', '--allow-empty', '-q', '-m', 'kls3a1 second');
    const scope = await openFolder(world, folder);
    const { line, head } = kls3a1Checkout(folder);
    expect(await linesOf(world, scope)).toEqual([lineRecord(scope, line, head)]);
  });

  it('3A1-10 a folder outside git is one line too (its realpath, no branch, no commit), and a Goal there takes it', async () => {
    /* Named mutation: the Host makes no line for a folder `identifyCheckout` answers `not_git` — `workspaces/lines` is
     * empty and the Goal's `lineRef` is null. */
    const world = await openHost();
    const folder = realpathSync(await tempDir('kls3a1-plain-'));
    const scope = await openFolder(world, folder);
    expect(await linesOf(world, scope)).toEqual([lineRecord(scope,
      { repoKey: folder, folder, branch: '', firstCommit: null }, null)]);
    const registration = await world.call<{ status: string; value: { project: { revision: number };
      workspace: { revision: number } } }>('workspaces/registration', plain(scope, scope));
    const created = await world.call<{ status: string }>('goals/create', graphWrite(scope,
      { goalId: 'kls3a1-10', workspace: scope, objective: 'KLS3A1 a folder outside git' }, 'kls3a1-10-goal',
      [{ ref: projectRef(scope), revision: registration.value.project.revision },
        { ref: workspaceRef(scope), revision: registration.value.workspace.revision }]));
    expect(created.status).toBe('committed');
    const goal = await world.call<{ status: string; value?: { goal: { lineRef?: unknown } } }>('goals/read',
      plain(scope, { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'kls3a1-10' }));
    expect(goal.value?.goal.lineRef).toEqual({ repoKey: folder, folder, branch: '' });
  });
});
