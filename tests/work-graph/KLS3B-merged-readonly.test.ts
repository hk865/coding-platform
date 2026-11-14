/**
 * KLS-3b (test writer, decision 117): row 3B-12 of the start rulings draft v2 §3. A line whose work is merged back takes
 * no new work, and what was already on it stays readable (lead ruling KLS-3b 2, next1113c:211; draft §2.7): after the
 * person merges `wt` into `main` and the Host judges the line `merged`, `goals/create` and `sessions/create` naming its
 * folder are refused `invalid` "a closed line does not take new work" (a product rule: a merged line is history; new
 * work goes on an open line), the refused Goal does not exist, and the Goal created on the line before the merge still
 * reads with that line. The world is the line-end world of `tests/app/KLS3B-line-end.test.ts`: one `openKLS2CHost`
 * (memory, a real git root, no idle rounds), the worktree joined through `workspaces/open`, and the main root opened
 * again as the safe point that judges the line.
 *
 * Red today (a2b618dd): there is no join, so the worktree is a workspace of its own and the Goal on its folder is
 * refused at the first `goals/create` (`not_found`: the main workspace has no line there). Green when KLS-3b lands the
 * join, the line end and the `status !== 'open'` refusal in `lineForWrite`.
 * Named mutation: `lineForWrite` drops the `status !== 'open'` refusal — the Goal is committed and the Session is
 * created (not shown: the refusal lives in the package).
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { KLS2C_NEVER_IDLE_MS, kls2cScopePins, openKLS2CHost, type KLS2CHost } from '../helpers/KLS2C-knowledge-host.js';
import { commitFile, joinCheckout, mergeBranch } from '../helpers/KLS3B-git-lines.js';
import { addGitWorktree } from '../scenarios/support/git-workspace.js';

const hosts: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of hosts.splice(0)) await world.close();
  await cleanupRestart();
});

describe('rejects: a merged line takes no new Goal or Session (product rule, next1113c:211)', () => {
  it('3B-12 goals/create and sessions/create on the merged line are invalid; the Goal already on it still reads', async () => {
    const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
    hosts.push(world);
    const { scope } = world;
    const wt = addGitWorktree(world.root, join(await tempDir('kls3b-wt-'), 'wt'), 'wt');
    await joinCheckout(world.settings, scope.projectId, wt);
    const createWtGoal = async (goalId: string) => await world.call<{ status: string }>('goals/create', graphWrite(scope,
      { goalId, workspace: scope, objective: `KLS3B ${goalId}`, lineFolder: wt }, goalId, await kls2cScopePins(world)));
    const readWtGoal = async (goalId: string) => await world.call<{ status: string; value?: { goal: { lineRef: unknown } } }>(
      'goals/read', plain(scope, { aggregateType: 'Goal', projectId: scope.projectId, goalId }));
    expect((await createWtGoal('kls3b-12-old')).status).toBe('committed');
    commitFile(wt, 'src/wt.ts', 'export const wt = 1;\n');
    mergeBranch(world.root, 'wt');
    await joinCheckout(world.settings, scope.projectId, realpathSync(world.root));
    const refused = { status: 'rejected', code: 'invalid', reason: 'a closed line does not take new work' };
    expect(await createWtGoal('kls3b-12-new')).toMatchObject(refused);
    expect(await world.call('sessions/create', plain(scope, { workspace: scope,
      role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' }, recommendedRefs: [],
      initialLinks: [], meta: { requestId: 'kls3b-12-session', expected: [] }, lineFolder: wt }))).toMatchObject(refused);
    expect((await readWtGoal('kls3b-12-new')).status).toBe('not_found');
    expect((await readWtGoal('kls3b-12-old')).value?.goal.lineRef).toMatchObject({ folder: wt, branch: 'wt' });
  });

  it('3B-12 (Astra 1) a goals/create and a sessions/create that succeeded on the line before it merged replay unchanged '
    + 'after it', async () => {
    const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
    hosts.push(world);
    const { scope } = world;
    const wt = addGitWorktree(world.root, join(await tempDir('kls3b-wt-'), 'wt'), 'wt');
    await joinCheckout(world.settings, scope.projectId, wt);
    const goal = graphWrite(scope, { goalId: 'kls3b-12-replay', workspace: scope, objective: 'KLS3B replay', lineFolder: wt },
      'kls3b-12-replay', await kls2cScopePins(world));
    const session = plain(scope, { workspace: scope,
      role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' }, recommendedRefs: [],
      initialLinks: [], meta: { requestId: 'kls3b-12-replay-session', expected: [] }, lineFolder: wt });
    const first = { goal: await world.call<{ status: string; replayed?: boolean }>('goals/create', goal),
      session: await world.call<{ status: string; replayed?: boolean }>('sessions/create', session) };
    expect([first.goal.status, first.session.status]).toEqual(['committed', 'completed']);
    commitFile(wt, 'src/wt.ts', 'export const wt = 1;\n');
    mergeBranch(world.root, 'wt');
    await joinCheckout(world.settings, scope.projectId, realpathSync(world.root));
    // Named mutation: the closed-line refusal before the owner's receipt lookup → both answer `invalid`.
    expect(await world.call('goals/create', goal)).toMatchObject({ status: 'committed', replayed: true });
    expect(await world.call('sessions/create', session)).toMatchObject({ status: 'completed', replayed: true });
  });
});
