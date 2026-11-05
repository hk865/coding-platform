/**
 * `G2-first-accept` (book `7d1:2018`, start rulings §5 `:2123`, w56-06): the first acceptance skips the source's
 * goal/project scope links and their claims. The real `sessions/create` + `sessions/link` world is
 * `seedS7D1HandoffScope`: it has already run the platform's real `sessionHandoff.acceptHandoff` and stops there, so a
 * row observes the accepted operation before any successor exists (DR-04). The row reads the saved operation back
 * through `sessions/operation` (`action.progress.scope === null`, no successor/create arm) and both lines through
 * `sessions/read` (the source's goal link and the adviser's real module link are the same open links at the same
 * revisions; no other line holds either scope).
 *
 * The baseline behaviour already exists on the base tree, so the RED is the frozen named mutation (DR-06/w56-06): in
 * `newHandoffOperationRecord` (`src/core/work-graph/state/session-handoff.ts`) write `progress.scope` as a started
 * value (`{ targets: [], entries: [] }`) instead of `null`. The row goes red on the `scope === null` assertion;
 * restoring the line returns it green.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HandoffActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
import type { SessionOperationRecordOf } from '../../src/core/work-graph/model/session-contracts.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  openLinkOf, seedS7D1HandoffScope, type S7D1HandoffScopeSeed,
} from '../helpers/S7D1-role-line-world.js';

const seeds: S7D1HandoffScopeSeed[] = [];
afterEach(async () => {
  for (const seed of seeds.splice(0)) await seed.close().catch(() => undefined);
});

describe('G2-first-accept', () => {
  it('first acceptance writes no scope, keeps the source goal and adviser module links, and creates no successor link',
    async () => {
      const seed = await seedS7D1HandoffScope();
      seeds.push(seed);

      // The operation the real acceptance saved, read immediately and through the public route.
      const record = ready<SessionOperationRecordOf<HandoffActionV1>>(
        await seed.world.world.post('sessions/operation', plain(S6A_SCOPE, seed.operation)),
        'the accepted handoff operation');
      expect(record.action.kind).toBe('handoff');
      expect(record.action.progress.scope).toBeNull();
      expect(record.action.progress.assignments).toHaveLength(1);
      expect(record.action.progress.assignments[0]).toMatchObject({
        successor: null, createOperation: null, createInput: null,
      });
      expect(record.action.progress.fence).toBeNull();

      // The source's goal link and the adviser's module link are the same open links, at the same revisions.
      const sourceCard = await seed.world.world.readSession(seed.source.ref);
      const adviserCard = await seed.world.world.readSession(seed.adviser.ref);
      const goal = openLinkOf(sourceCard, 'goal');
      const module = openLinkOf(adviserCard, 'module');
      if (goal === undefined || module === undefined) {
        throw new Error('G2-first-accept: the accepted world lost its goal or module link');
      }
      expect(goal.revision).toBe(seed.links.goal.revision);
      expect(module.revision).toBe(seed.links.module.revision);
      expect(canonicalKey(goal.ref.target)).toBe(canonicalKey(seed.targets.goal));
      expect(canonicalKey(module.ref.target)).toBe(canonicalKey(seed.targets.module));

      // The source's held Tasks are untouched too: the acceptance moved no link of any kind.
      const heldTasks = sourceCard.links.filter(link => link.ref.relation === 'responsible'
        && link.until === null && link.ref.target.kind === 'task');
      expect(heldTasks).toHaveLength(seed.tasks.length);

      // No successor exists yet, so no second line may hold the goal or module scope. The adviser's own responsible
      // Goal link is the world's (the handoff fixture gives it one so a secretary's member creation has a responsible
      // adviser, O5a-2); it is not a successor.
      const cards = await seed.world.world.listSessions();
      const goalHolders = cards.filter(card => openLinkOf(card, 'goal') !== undefined
        && canonicalKey(openLinkOf(card, 'goal')!.ref.target) === canonicalKey(seed.targets.goal));
      const moduleHolders = cards.filter(card => openLinkOf(card, 'module') !== undefined
        && canonicalKey(openLinkOf(card, 'module')!.ref.target) === canonicalKey(seed.targets.module));
      expect(goalHolders.map(card => card.record.ref.sessionId).sort())
        .toEqual([seed.source.ref.sessionId, seed.adviser.ref.sessionId].sort());
      expect(moduleHolders.map(card => card.record.ref.sessionId)).toEqual([seed.adviser.ref.sessionId]);
      expect(cards.some(card => card.record.provenance.kind === 'handoff'
        && card.record.provenance.from.sessionId === seed.source.ref.sessionId)).toBe(false);
    });
});
