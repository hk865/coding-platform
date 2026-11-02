/**
 * `W-routes` (book :2036, `:554-555`, §3.16): the three project role-line routes exist with DTOs derived from
 * the ports. The two `projects/role-limits*` entries are person-only; `role-lines/allocation` is an open read.
 * The person's three HTTP entries are the real Host actor's; the non-person call is the Host's system context
 * through `world.dispatch`. No record is read, no DTO is restated.
 * Named mutation (not run here): drop `personEntry` from `projects/role-limits/set`; the system dispatch commits.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ProjectsRoleLimitsBody, ProjectsRoleLimitsSetBody, RoleLinesAllocationBody,
} from '../../src/app/core-http-types.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6ACardsWorld, type S6ACardsWorld } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

const worlds: S6ACardsWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

const projectRef = { projectId: S6A_SCOPE.projectId };

describe('W-routes: the three role-line routes and the person-only pair', () => {
  it('the person reads defaults, sets open.secretary 2, and the allocation read answers; the system is refused by both limits routes', async () => {
    const cards = await openS6ACardsWorld({ backend: 'memory' });
    worlds.push(cards);
    const world = cards.world;
    const readBody = plain(S6A_SCOPE, { projectRef }) as ProjectsRoleLimitsBody;
    const limits = await world.post('projects/role-limits', readBody);
    expect(limits.body).toMatchObject({ status: 'ready', value: { projectRef, revision: 0,
      open: { secretary: 8, adviser: 8, scribe: 4, executor: 16 } } });

    const setBody = plain(S6A_SCOPE, { commandId: 's7d1-w-routes-open',
      expectedRevision: 0, open: { secretary: 2 } }) as ProjectsRoleLimitsSetBody;
    expect((await world.post('projects/role-limits/set', setBody)).body).toMatchObject({ status: 'committed',
      value: { projectRef, revision: 1, open: { secretary: 2, adviser: 8 } } });

    const allocationBody = plain(S6A_SCOPE, {}) as RoleLinesAllocationBody;
    const allocation = await world.post('role-lines/allocation', allocationBody);
    expect(allocation.body).toMatchObject({ status: 'ready', value: { projectRef,
      duties: { secretary: { duty: 'secretary', limit: 2, holders: [], reservations: [] } } } });

    const forbidden = { status: 'rejected', code: 'forbidden', reason: 'only the person may call this route' };
    expect(await world.dispatch('projects/role-limits', world.systemContext(), plain(S6A_SCOPE, { projectRef })))
      .toEqual(forbidden);
    expect(await world.dispatch('projects/role-limits/set', world.systemContext(), plain(S6A_SCOPE,
      { commandId: 's7d1-w-routes-system', expectedRevision: 1, open: { secretary: 3 } }))).toEqual(forbidden);
    expect(await world.dispatch('role-lines/allocation', world.systemContext(), plain(S6A_SCOPE, {})))
      .toMatchObject({ status: 'ready', value: { duties: { secretary: { limit: 2 } } } });
  }, 120_000);
});
