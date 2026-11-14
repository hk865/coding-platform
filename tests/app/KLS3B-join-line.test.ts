/**
 * KLS-3b (test writer, decision 117): row 3B-01 of the start rulings draft v2 §3 with the lead's ruling 甲 on
 * `firstCommit` (next1113c "KLS-3b 草稿按 KLS-3a 实际代码重对"). The person opens another checkout of the project's
 * repository inside the project (`workspaces/open` with the projectId, as the page sends it): a `git worktree add`
 * (the same common git directory) or a separate full clone (the same single first commit) is a new line of the same
 * workspace, not a new workspace (draft §1 2, §10 rule 1); a shallow clone is not recognised by its first commit, so it
 * opens as a new workspace (ruling 甲: seen and explained, never merged by mistake). One `openKLS2CHost` (memory, a real
 * git root, a threshold no row reaches so only the named safe points run) per case; the reads are the Host's settings
 * `snapshot` and `workspaces/lines`. Expected values come from the test's own git (`kls3a1Checkout`, F8): a line is
 * `lineRecordFor(scope, line, HEAD at open)`; the shallow clone's one commit is the repository's first commit, so
 * only the shallow rule keeps it apart.
 *
 * Red today (a2b618dd) for the worktree and the clone: there is no join, so `workspaces/open` registers a new workspace
 * (a new `workspaceId`, one more settings workspace) and the main workspace keeps one line. Green when KLS-3b adds the
 * join branch to `openWorkspaceImpl` (`sameCheckout` on the project's lines, then `registerHostLine` on that
 * workspace). The shallow case is green today (no join at all) and guards ruling 甲 once the join exists.
 * Named mutations: drop the join branch, or let it fall through to `registerWorkspace` — the worktree and clone cases
 * get a new `workspaceId`; drop the 甲 guard (the first commit alone joins) — the shallow case joins the workspace.
 *
 * The two gap rows of run `7d2-gapkls3b` close cells the named mutations of `7d2-kls3bmut` left green: #37 an empty
 * repository's main line (before its first commit no ref resolves, and the line must still read `open` at revision 1)
 * and #38 a subfolder of a checkout (not a checkout root: it opens as a workspace of its own, never as a line). Their
 * expected values are hand-computed from the rulings, not read from `src`.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { kls3a1Checkout } from '../helpers/KLS2A-knowledge-world.js';
import { KLS2C_NEVER_IDLE_MS, openKLS2CHost, type KLS2CHost } from '../helpers/KLS2C-knowledge-host.js';
import { lineRecordFor } from '../helpers/KLS3A1-gap-world.js';
import { joinCheckout, workspaceLines } from '../helpers/KLS3B-git-lines.js';
import { addGitWorktree, gitIn } from '../scenarios/support/git-workspace.js';

const hosts: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of hosts.splice(0)) await world.close();
  await cleanupRestart();
});

async function openGitHost(): Promise<KLS2CHost> {
  const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
  hosts.push(world);
  return world;
}

/** How many workspaces the Host's settings snapshot lists. */
async function settingsWorkspaces(world: KLS2CHost): Promise<number> {
  const snapshot = await world.settings<{ status: string; value?: { workspaces: unknown[] } }>('snapshot', {});
  if (snapshot.status !== 'ready' || snapshot.value === undefined) throw new Error(`snapshot: ${JSON.stringify(snapshot)}`);
  return snapshot.value.workspaces.length;
}

/** The person's second checkout of the repository at `root`: a worktree on branch `wt`, or a (shallow) clone. */
async function secondCheckout(root: string, kind: 'worktree' | 'clone' | 'shallow'): Promise<string> {
  const folder = join(await tempDir('kls3b-checkout-'), kind);
  if (kind === 'worktree') return addGitWorktree(root, folder, 'wt');
  gitIn(root, 'clone', '-q', ...(kind === 'shallow' ? ['--depth', '1'] : []), `file://${realpathSync(root)}`, folder);
  return realpathSync(folder);
}

describe('KLS-3b 3B-01 another checkout of the same repository opened inside the project', () => {
  it.each(['worktree', 'clone'] as const)('3B-01 a %s is a new line of the same workspace', async kind => {
    const world = await openGitHost();
    const before = await settingsWorkspaces(world);
    const folder = await secondCheckout(world.root, kind);
    const scope = await joinCheckout(world.settings, world.scope.projectId, folder);
    expect([scope.workspaceId, await settingsWorkspaces(world)]).toEqual([world.scope.workspaceId, before]);
    const main = kls3a1Checkout(world.root);
    const second = kls3a1Checkout(folder);
    expect(await workspaceLines(world.call, world.scope, world.scope.workspaceId)).toEqual([
      lineRecordFor(world.scope, main.line, main.head), lineRecordFor(world.scope, second.line, second.head)]);
  });

  it('3B-01 a shallow clone with the same first commit opens as a new workspace (ruling 甲)', async () => {
    const world = await openGitHost();
    const before = await settingsWorkspaces(world);
    const folder = await secondCheckout(world.root, 'shallow');
    if (gitIn(folder, 'rev-parse', '--is-shallow-repository').trim() !== 'true') throw new Error('the clone is not shallow');
    const scope = await joinCheckout(world.settings, world.scope.projectId, folder);
    expect([scope.workspaceId === world.scope.workspaceId, await settingsWorkspaces(world),
      (await workspaceLines(world.call, world.scope, world.scope.workspaceId)).length]).toEqual([false, before + 1, 1]);
  });

  it('#37 an empty repository\'s main line stays open on its unborn branch, also at the already-bound open', async () => {
    /* Named mutation: `src/app/host.ts:1884` drops `|| baseHead === null` — before the first commit no ref resolves,
     * so the main line reads as a gone branch and the start-up sweep makes it `removed` (revision 2). */
    const folder = realpathSync(await tempDir('kls3b-empty-'));
    gitIn(folder, 'init', '-q', '-b', 'main');
    const world = await openKLS2CHost({ storage: 'memory', git: false, root: folder });
    hosts.push(world);
    /** `[branch, status, closedAt set, revision]` of each line of the main workspace. */
    const lines = async (): Promise<unknown[]> =>
      (await workspaceLines(world.call, world.scope, world.scope.workspaceId))
        .map(line => [line.branch, line.status, line.closedAt !== null, line.revision]);
    expect(await lines()).toEqual([['main', 'open', false, 1]]);
    await joinCheckout(world.settings, world.scope.projectId, folder);
    expect(await lines()).toEqual([['main', 'open', false, 1]]);
  });

  it('#38 a subfolder of a checkout opens as a workspace of its own, not a line', async () => {
    /* Named mutation: `src/app/host.ts:1924` drops `await gitTopLevel(canonical) === null` — the subfolder is probed as
     * its checkout's repository and joins the main workspace as a third line (same workspaceId, 3 lines). */
    const world = await openGitHost();
    const wt = await secondCheckout(world.root, 'worktree');
    await joinCheckout(world.settings, world.scope.projectId, wt);
    const before = await settingsWorkspaces(world);
    expect((await workspaceLines(world.call, world.scope, world.scope.workspaceId)).length).toBe(2);
    const scope = await joinCheckout(world.settings, world.scope.projectId, join(wt, 'src'));
    expect([scope.workspaceId === world.scope.workspaceId, await settingsWorkspaces(world),
      (await workspaceLines(world.call, world.scope, world.scope.workspaceId)).length]).toEqual([false, before + 1, 2]);
  });
});
