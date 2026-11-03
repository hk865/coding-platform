/**
 * RL-02 (`7d2-start-rulings.v4.md:8840` as the O1b run sheet `run-7d2-o1b.md:49` modifies it; book `:1305`;
 * lead-read-7d2.md:11): the person's `role-lines/open` and `role-lines/change-scope`.
 *
 * World: `openS7D2RoleLineWorld` (tests/helpers/S7D2-role-line-world.ts), memory. Its opening adviser A is the one
 * adviser, open on `[project]`; goal G is goal 1; `projects/role-limits/set` makes `open.adviser = 1`.
 *
 * Expected (from the row): a secretary opened on `[G]` is a new line with an open goal link; `change-scope` to
 * `[project]` closes that goal link and opens the project link in one commit (the goal link's `until` is the
 * project link's `since`); it commits beside the opening secretary's own open project link, so a secretary link
 * takes no `role-scope:` claim. An empty scribe scope opens a standby line: `sessions/read` shows `lifecycle:'active'`
 * and no open responsible link (its `unassigned` read reason is O5b-R2's, run sheet `:49`). A reviewer on module M is
 * accepted and takes no `role-scope:` claim, so `modules/assign-maintainer` of an executor line on M commits. An
 * `executor` open is `{status:'rejected',code:'invalid',reason:'role_line_duty'}`; an adviser open at the cap is the
 * literal `capacity` refusal with `detail:{duty:'adviser',holders:1,reservations:0,open:1,episode:null}` (1 holder =
 * A, 0 reservations, limit 1), and `decisions/queue` shows no `role_capacity` card.
 *
 * Named mutation: reject `reviewer` at `open`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { WorkLinkTarget } from '../../src/contracts/core/identity.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import {
  openS7D2RoleLineWorld, openTargetsOf, type S7D2RoleLineWorld,
} from '../helpers/S7D2-role-line-world.js';

const worlds: S7D2RoleLineWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

/** The card's `responsible` link on `target`, open or closed. */
function linkOn(card: SessionCard, target: WorkLinkTarget) {
  const link = card.links.find(entry => entry.ref.relation === 'responsible'
    && canonicalKey(entry.ref.target) === canonicalKey(target));
  if (link === undefined) throw new Error(`no link on ${JSON.stringify(target)}: ${JSON.stringify(card.links)}`);
  return link;
}

describe('RL-02', () => {
  it('RL-02 (memory): open, change-scope, standby, reviewer, executor and the cap through the person routes',
    async () => {
      const world = await openS7D2RoleLineWorld({ backend: 'memory' });
      worlds.push(world);
      await world.setOpen('adviser', 1, 's7d2-rl02-cap');
      const goalScope = { kind: 'goal' as const, goalRef: world.goal };
      const moduleM = world.modules.region;

      // The secretary on [G], then on [project]: the goal link closes and the project link opens in one commit.
      const secretary = await world.lineOf('s7d2-rl02-secretary', (await world.open({
        duty: 'secretary', scope: [goalScope], requestId: 's7d2-rl02-secretary' })).result);
      expect(openTargetsOf(await world.readCard(secretary))).toEqual([world.targets.goal]);
      const changed = await world.changeScope({ session: secretary, scope: [{ kind: 'project' }],
        requestId: 's7d2-rl02-change-scope' });
      expect(changed.result).toMatchObject({ status: 'committed', value: { session: secretary.ref } });
      const moved = await world.readCard(secretary);
      expect(openTargetsOf(moved)).toEqual([world.targets.project]);
      const goalLink = linkOn(moved, world.targets.goal);
      expect(goalLink.until).not.toBeNull();
      expect(linkOn(moved, world.targets.project).since).toBe(goalLink.until);
      expect(openTargetsOf(await world.readCard(world.lines.secretary))).toEqual([world.targets.project]);

      // O1B-R1-01: widening keeps the open project link as it is and reopens G (close = the links the scope drops).
      const projectSince = linkOn(moved, world.targets.project).since;
      const widened = await world.changeScope({ session: secretary, scope: [{ kind: 'project' }, goalScope],
        requestId: 's7d2-rl02-widen' });
      expect(widened.result).toMatchObject({ status: 'committed', value: { session: secretary.ref } });
      const wide = await world.readCard(secretary);
      const sortedTargetKeys = (targets: WorkLinkTarget[]) => targets.map((target) => canonicalKey(target)).sort();
      expect(sortedTargetKeys(openTargetsOf(wide)))
        .toEqual(sortedTargetKeys([world.targets.project, world.targets.goal]));
      expect(linkOn(wide, world.targets.project)).toMatchObject({ since: projectSince, until: null });

      // The empty scribe scope: a standby line.
      const standby = await world.lineOf('s7d2-rl02-scribe', (await world.open({
        duty: 'scribe', scope: [], requestId: 's7d2-rl02-scribe' })).result);
      const standbyCard = await world.readCard(standby);
      expect(standbyCard.record.lifecycle).toBe('active');
      expect(openTargetsOf(standbyCard)).toEqual([]);

      // The reviewer on module M is accepted with its module link.
      const reviewer = await world.lineOf('s7d2-rl02-reviewer', (await world.open({
        duty: 'reviewer', scope: [{ kind: 'region', moduleRef: moduleM }], requestId: 's7d2-rl02-reviewer' })).result);
      expect(openTargetsOf(await world.readCard(reviewer))).toEqual([{ kind: 'module', ref: moduleM }]);

      expect((await world.open({ duty: 'executor', scope: [goalScope], requestId: 's7d2-rl02-executor' })).result)
        .toEqual({ status: 'rejected', code: 'invalid', reason: 'role_line_duty' });

      expect((await world.open({ duty: 'adviser', scope: [goalScope], requestId: 's7d2-rl02-adviser-at-cap' })).result)
        .toEqual({
          status: 'rejected', code: 'capacity',
          reason: 'at_cap: adviser has 1 holder(s) and 0 reservation(s) against open limit 1',
          detail: { duty: 'adviser', holders: 1, reservations: 0, open: 1, episode: null },
        });

      // The reviewer holds no executor claim on M, so the maintainer assignment on M commits.
      const maintainer = await world.createWorkLine('s7d2-rl02-maintainer');
      expect(await world.assignMaintainer({ module: moduleM, line: maintainer, requestId: 's7d2-rl02-maintainer' }))
        .toMatchObject({ status: 'committed' });

      expect((await world.cards()).filter(card => card.source.kind === 'role_capacity')).toEqual([]);
    }, 180_000);
});
