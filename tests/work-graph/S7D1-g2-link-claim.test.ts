/**
 * G2-link-claim and G2-link-kinds (book `7d1:2012-2013`; start rulings §5 `:1937-1938`, w4 G2-1-09).
 *
 * G2-link-claim is a service row on memory and SQLite: opening a scope link takes the claim, a second line on the same
 * scope answers `revision_conflict` with `scopeOwned.holder` naming the holding line, closing releases it, and the
 * original request replays from its receipt. The named mutation is dropping the `open` claim in
 * `runLinkAttempt`'s commit. The book's "close with a different expected owner" sub-case is gone (w4 G2-1-09: the link
 * and its claim are one commit, so no lawful world can change the owner of a live link alone).
 *
 * G2-link-kinds is the memory row for the two target arms: a cross-workspace Goal of the same project is lawful and
 * `sessions/read` shows `target.kind === 'goal'`; a project link shows `'project'`. Mutations: deleting the `goal`
 * arm (or the `project` arm) in `validateWorkLinkTarget` answers `unsupported` and no link exists.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7D1RoleLineWorld, type S7D1RoleLineWorld } from '../helpers/S7D1-role-line-world.js';

const worlds: S7D1RoleLineWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

const moduleScope = { kind: 'region' as const, moduleRef: { projectId: S6A_SCOPE.projectId, moduleId: 's6a-core' } };

describe('G2-link-claim', () => {
  it.each(['memory', 'sqlite'] as const)(
    'G2-link-claim (%s): a scope link takes and releases the claim, and its receipt replays', async backend => {
      const world = await openS7D1RoleLineWorld({ backend });
      worlds.push(world);
      const target = world.targets.module;

      // The secretary already has a module link, but a secretary link takes no claim: no adviser holder yet.
      expect(await world.claimHolder(target)).toBeNull();

      const firstOpen = await world.openLink({
        line: world.lines.first, target, requestId: 's7d1-claim-open-first',
      });
      expect(firstOpen.result).toMatchObject({ status: 'committed', replayed: false });
      expect(await world.claimHolder(target)).toEqual(world.lines.first.ref);

      const secondOpen = await world.openLink({
        line: world.lines.second, target, requestId: 's7d1-claim-open-second',
      });
      expect(secondOpen.result).toMatchObject({
        status: 'rejected', code: 'revision_conflict',
        scopeOwned: { duty: 'adviser', target: moduleScope, holder: world.lines.first.ref },
      });
      if (secondOpen.result.status !== 'rejected') throw new Error(JSON.stringify(secondOpen.result));
      expect(secondOpen.result.reason.startsWith('scope_owned:')).toBe(true);

      const close = await world.openLink({
        line: world.lines.first, target, active: false, requestId: 's7d1-claim-close-first',
      });
      expect(close.result.status).toBe('committed');
      expect(await world.claimHolder(target)).toBeNull();

      const secondRetry = await world.openLink({
        line: world.lines.second, target, requestId: 's7d1-claim-open-second-retry',
      });
      expect(secondRetry.result.status).toBe('committed');
      expect(await world.claimHolder(target)).toEqual(world.lines.second.ref);

      // The same request body again: the receipt is restored, no second claim is taken.
      const replay = await firstOpen.replay();
      expect(replay).toMatchObject({ status: 'committed', replayed: true });
      expect(await world.claimHolder(target)).toEqual(world.lines.second.ref);
    });
});

describe('G2-link-kinds', () => {
  it.each([
    { arm: 'goal', line: 'second' as const, target: 'goal' as const },
    { arm: 'project', line: 'first' as const, target: 'project' as const },
  ])('G2-link-kinds ($arm): a lawful link names its target and appears in the target page',
    async ({ arm, line, target }) => {
      const world = await openS7D1RoleLineWorld({ backend: 'memory' });
      worlds.push(world);
      if (arm === 'goal') {
        expect(world.goalB).toMatchObject({ aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's7d1-goal-b' });
      }

      const session = world.lines[line];
      const wanted = world.targets[target];
      const card = await world.readCard(session);
      const link = card.links.find(entry => entry.ref.relation === 'responsible' && entry.ref.target.kind === target);
      if (link === undefined) throw new Error(`no ${arm} link on the ${line} line: ${JSON.stringify(card.links)}`);
      expect(link.ref.target).toEqual(wanted);
      expect(link.until).toBeNull();
      expect(link.since).not.toBeNull();

      expect((await world.findByTarget(wanted)).map(entry => entry.record.ref.sessionId))
        .toContain(session.ref.sessionId);
    });
});
