/**
 * `G2-full-handoff-cap` (book `7d1:2020`, start rulings §5 `:2125`, RL-06, w56-01): a full handoff whose successor
 * borrows the source's seat moves the holder old→new exactly once, and a crash before the archive registration
 * resumes into the same archive stage. Two entries: a real secretary with empty tasks handed off by the person's
 * public `secretaries/handoff` route, and an executor with tasks (`seedS7D1HandoffScopeLight`) driven by
 * `restartBeforeArchive`. Both set `seedS7D1Cap` first, so the successor must borrow the source's seat instead of
 * reserving. The secretary entry holds the real archive registration, posts the route without waiting, crashes,
 * re-posts the same command, takes the operation from the returned progress and continues with the existing driver.
 *
 * Both entries are unproven on this tree: `seedS7D1Cap` reads the D2 `role-lines/allocation` route, which W has not
 * added, and stops with `S7D1_ALLOCATION_DEFERRED` (the transport's 404), so the row records that deferred first
 * error and writes no fake holder value. Named mutation (for W): the archive commit's holder move old→new
 * (`src/core/work-graph/state/session-archive-release.ts` / `session-lifecycle.ts` archive contribution) — dropping
 * it leaves the source holder and adds none, so the one-holder assertion goes red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandoffActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
import type { SessionOperationRecordOf, SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleLineDutyV1 } from '../../src/contracts/role-lines.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { sameRef } from '../../src/core/work-graph/state/ref-equality.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { driveS6BHandoff, teardownS6BHandoff } from '../helpers/S6B2-fixture.js';
import {
  readS7D1Allocation, restartBeforeArchive, restartSecretaryHandoff, seedS7D1Cap,
} from '../helpers/S7D1-allocation-world.js';
import { seedS7D1HandoffScopeLight, type S7D1HandoffScopeSeed } from '../helpers/S7D1-role-line-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const seeds: S7D1HandoffScopeSeed[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const seed of seeds.splice(0)) await seed.close().catch(() => undefined);
});

describe('G2-full-handoff-cap', () => {
  it.each(['secretary', 'executor'] as const)(
    'G2-full-handoff-cap (%s): the archive moves the holder old to new once across the restart', async duty => {
      const seed = await seedS7D1HandoffScopeLight({ backend: 'sqlite' });
      seeds.push(seed);
      const world = seed.world.world;
      const dutyName = duty as RoleLineDutyV1;

      let source = seed.source.ref;
      let operation = seed.operation;
      let beforeSessions: SessionCard[];
      let cap: Awaited<ReturnType<typeof seedS7D1Cap>>;
      let resumed: Awaited<ReturnType<typeof driveS6BHandoff>>;
      let pending: Promise<unknown> | null = null;

      if (duty === 'secretary') {
        // A real secretary line handed off by the person's public route. The cap is set before the command and the
        // archive registration is held, so the route's drive stops before the crash; the same command resumes it.
        const secretary = await world.createSecretary('s7d1-full-cap-secretary');
        source = secretary.ref;
        cap = await seedS7D1Cap(world, 'secretary');
        beforeSessions = await world.listSessions();
        ({ operation, resumed, pending } = await restartSecretaryHandoff(world, source));
      } else {
        cap = await seedS7D1Cap(world, 'executor');
        beforeSessions = await world.listSessions();
        resumed = await restartBeforeArchive(world, operation);
      }

      try {
        const sourceHolder = cap.report.duties[dutyName].holders.find(holder => sameRef(holder.session, source));
        if (sourceHolder === undefined) throw new Error(`G2-full-handoff-cap: the ${duty} source holds no seat`);
        const since = sourceHolder.since;
        const beforeKeys = new Set(beforeSessions.map(card => plainSessionRefKey(card.record.ref)));

        expect(resumed.progress).toMatchObject({ stage: 'finished', phase: 'completed', archived: true, lastRefusal: null });

        // The resume re-entered the archive stage and registered the same request once; the saved operation shows it.
        const record = ready<SessionOperationRecordOf<HandoffActionV1>>(
          await world.post('sessions/operation', plain(S6A_SCOPE, operation)), 'the resumed handoff operation');
        expect(record.phase).toBe('completed');
        expect(record.action.progress.archiveRequest?.receipt).not.toBeNull();

        const created = (await world.listSessions()).filter(card => !beforeKeys.has(plainSessionRefKey(card.record.ref)));
        expect(created).toHaveLength(1);
        const successor = resumed.progress!.successor;

        // One holder after the move: the source is gone, the successor is the holder, and the moved `since` survives.
        const after = await readS7D1Allocation(world);
        const holders = after.duties[dutyName].holders
          .filter(holder => sameRef(holder.session, source) || sameRef(holder.session, successor));
        expect(holders).toHaveLength(1);
        expect(sameRef(holders[0]!.session, successor)).toBe(true);
        expect(holders[0]!.since).toBe(since);
        expect(after.duties[dutyName].holders)
          .toHaveLength(cap.report.duties[dutyName].holders.length);
      } finally {
        await teardownS6BHandoff(resumed);
        await pending;
      }
    });
});
