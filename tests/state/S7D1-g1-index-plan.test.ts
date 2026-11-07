/**
 * `G1-index-plan` (book :2005, `:204-210`): the two project-wide lookups behind `sessions/find` page the
 * responsible stream for a goal target and a project target in byte order, stably across a page and without
 * duplication; `targetRelationPlan` routes each target kind to its own lookup.
 * Named mutations (not run here): (a) route a goal target to the project lookup → an empty page; (b) drop
 * `ref.relation` from the goal lookup → the lookup's argument count refuses first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { SessionCard, SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import { plainSessionRef } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
import { openS7D1RoleLineWorld, type S7D1RoleLineWorld } from '../helpers/S7D1-role-line-world.js';

const worlds: S7D1RoleLineWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

async function pageOf(lines: S7D1RoleLineWorld, target: WorkLinkTarget,
  cursor: string | null = null): Promise<SessionPage<SessionCard>> {
  const body = asRecord((await lines.world.post('sessions/find', plain(lines.world.scope, {
    workspace: { ...lines.world.scope }, target, includeArchived: false,
    page: { limit: 1, ...(cursor === null ? {} : { cursor }) },
  }))).body);
  expect(body['status']).toBe('ready');
  return body['value'] as unknown as SessionPage<SessionCard>;
}

describe.each(['memory', 'sqlite'] as const)('G1-index-plan (%s): one lookup per target kind, one ordered stream', backend => {
  it('a goal target and a project target page the two responsible lines in byte order, stably and without duplication', async () => {
    const lines = await openS7D1RoleLineWorld({ backend });
    worlds.push(lines);
    const goal = lines.goalB;
    const project = { projectId: lines.world.scope.projectId };
    // The goal stream and the project stream each get a second line through a real public link. The secretary
    // and the fresh worker take no scope claim, so they may sit beside the adviser that already holds one; two
    // advisers on one scope would be `scope_owned`.
    const pages = async (target: WorkLinkTarget, expected: string[]): Promise<void> => {
      const first = await pageOf(lines, target);
      expect(first.items.map(card => card.record.ref.sessionId)).toEqual([expected[0]]);
      expect(first.nextCursor).not.toBeNull();
      const second = await pageOf(lines, target, first.nextCursor);
      expect(second.items.map(card => card.record.ref.sessionId)).toEqual([expected[1]]);
      expect(second.nextCursor).toBeNull();
      // Re-reading the first page after the second stays on the same key and row.
      const reread = await pageOf(lines, target);
      expect(reread.items.map(card => card.record.ref.sessionId)).toEqual([expected[0]]);
    };

    // The goal stream first, with the project stream empty: routing the goal target to the project lookup then
    // answers an empty page. The adviser's own project link is closed through the same public link route.
    const closed = await lines.openLink({ line: lines.lines.first, target: { kind: 'project', ref: project },
      active: false, requestId: 's7d1-g1-close-project-first' });
    expect(closed.result.status).toBe('committed');
    const goalOpened = await lines.openLink({ line: lines.lines.secretary, target: { kind: 'goal', ref: goal },
      requestId: 's7d1-g1-goal-secretary' });
    expect(goalOpened.result.status).toBe('committed');
    await pages({ kind: 'goal', ref: goal }, [
      plainSessionRef(lines.lines.secretary.ref).sessionId,
      plainSessionRef(lines.lines.second.ref).sessionId,
    ].sort());

    const reopened = await lines.openLink({ line: lines.lines.first, target: { kind: 'project', ref: project },
      requestId: 's7d1-g1-reopen-project-first' });
    expect(reopened.result.status).toBe('committed');
    const worker = await lines.world.createWorkSession('s7d1-g1-project-worker');
    const projectOpened = await lines.openLink({ line: worker, target: { kind: 'project', ref: project },
      requestId: 's7d1-g1-project-worker' });
    expect(projectOpened.result.status).toBe('committed');
    await pages({ kind: 'project', ref: project }, [
      plainSessionRef(worker.ref).sessionId,
      plainSessionRef(lines.lines.first.ref).sessionId,
    ].sort());
  }, 180_000);
});
