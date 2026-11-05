/**
 * `G2-partial-handoff-cap` (book `7d1:2021`, start rulings §5 `:2126`, RL-07, DR-02): a partial handoff's successor
 * meets the executor cap on its own, gets `capacity/at_cap`, and borrows nothing; the public advance returns `busy`,
 * and the saved `action.progress.lastRefusal.code` is `busy` (no new field on the advance result).
 *
 * The world is `seedS7D1HandoffScopeLight({ partial: true })` (one of FH-1's Tasks stays unnamed, so the source is not
 * full and cannot borrow a seat). `seedS7D1Cap` fills `open.executor` to the duty's current holders + reservations;
 * the successor's create then meets the cap. Per DR-02 the row calls the published Workflow composite's
 * `continueHandoff` directly (not `driveS6BHandoff`, which converts `busy` into an exception) so the `busy` return
 * is caught, then reads the saved operation back through `sessions/operation`. No new field is added to the advance
 * result: the rejection carries exactly `status`/`code`/`reason`.
 *
 * Unproven on this tree: `seedS7D1Cap` reads the D2 `role-lines/allocation` route, which W has not added, and stops
 * with `S7D1_ALLOCATION_DEFERRED` (the transport's 404). The row records that deferred first error and writes no
 * fake successor or holder. Named mutation (for W): the refusal mark's `lastRefusal.code = 'busy'` (the successor
 * child's `capacity_blocked` → busy mapping) — writing another code, or dropping the mark, makes the saved read red.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HandoffActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
import type { SessionOperationRecordOf } from '../../src/core/work-graph/model/session-contracts.js';
import { sameRef } from '../../src/core/work-graph/state/ref-equality.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { readS7D1Allocation, seedS7D1Cap } from '../helpers/S7D1-allocation-world.js';
import { seedS7D1HandoffScopeLight, type S7D1HandoffScopeSeed } from '../helpers/S7D1-role-line-world.js';

const seeds: S7D1HandoffScopeSeed[] = [];
afterEach(async () => {
  for (const seed of seeds.splice(0)) await seed.close().catch(() => undefined);
});

describe('G2-partial-handoff-cap', () => {
  it('a partial handoff successor meets the cap, borrows nothing and the public advance answers busy', async () => {
    const scope = await seedS7D1HandoffScopeLight({ partial: true });
    seeds.push(scope);
    const world = scope.world.world;

    // The partial source is not full, so the successor must reserve its own executor seat: fill the duty to its
    // current count and the create answers `capacity/at_cap`.
    const cap = await seedS7D1Cap(world, 'executor');
    const beforeSessions = await world.listSessions();
    const composite = world.platform.workflow.sessionHandoff;
    if (composite === undefined) throw new Error('G2-partial-handoff-cap: the Workflow publishes no handoff composite');

    // DR-02: the published composite's advance catches the child's `busy` instead of the driver's exception.
    const advanced = await composite.continueHandoff(world.humanContext(), { operation: scope.operation });
    expect(advanced).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(Object.keys(advanced).sort()).toEqual(['code', 'reason', 'status']);
    expect((advanced as { reason: string }).reason).toContain('capacity');

    // The refusal is saved on the item the child named; `sessions/operation` reads the same busy code.
    const record = ready<SessionOperationRecordOf<HandoffActionV1>>(
      await world.post('sessions/operation', plain(S6A_SCOPE, scope.operation)), 'the refused handoff operation');
    expect(record.action.progress.lastRefusal).toMatchObject({ stage: 'successor', code: 'busy' });
    expect(record.action.progress.assignments[0]?.successor).toBeNull();
    expect(record.action.progress.assignments[0]?.createOperation).toBeNull();

    // The successor borrowed nothing and no line was created; the executor's holders/reservations are unchanged.
    expect(await world.listSessions()).toHaveLength(beforeSessions.length);
    const after = await readS7D1Allocation(world);
    expect(after.duties.executor.holders.map(holder => holder.session))
      .toEqual(cap.report.duties.executor.holders.map(holder => holder.session));
    expect(after.duties.executor.reservations).toEqual(cap.report.duties.executor.reservations);
    expect(after.duties.executor.holders.some(holder => sameRef(holder.session, scope.source.ref))).toBe(true);
  });
});
