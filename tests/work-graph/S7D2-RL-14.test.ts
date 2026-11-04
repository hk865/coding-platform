/**
 * RL-14 (`7d2-start-rulings.v4.md:8852`, read per `later-rows-merged.md:204–:206`; v4 §3.1.2 `:2501–:2503`, `:3013`):
 * a line whose move has an unknown burden is never split, by the maintenance page or by `propose_role_split`.
 *
 * World: `openS7D2ProjectWorld` (tests/helpers/S7D2-role-line-world.ts), memory, one fresh world per observation input
 * the world reaches through 8A's public adopt and capture (`adoptS7D2Governance`): `capture_failed`,
 * `ownership_ambiguous`, `containment_absent`; `adviserTools` with `propose_role_split` added to the world's three and
 * `scribeReminderPeriodMs: 25` on every Host start. L1 = `regionAdviser`, region `src`. The two inputs this world
 * cannot reach (no observation, a page cursor not exhausted) are O5b-R2's, with `role-lines/read`, the literal
 * `unknown` and "never one region is enough".
 *
 * Steps: (a) `role-lines/operations`; (b) one `workflow/advance` (`select_work` on goal 2, whose one Task already ran)
 * and one Host idle cycle, both running the maintenance page; (c) goal 1's one Plan with one Task linked to L1, whose
 * scripted Work Run calls `propose_role_split {move:[region src/a]}` once; (d) `role-lines/operations`,
 * `role-lines/allocation`, `sessions/read` of L1.
 *
 * Expected, by hand: (c) answers `{status:'rejected',code:'invalid',reason:'the move is not a strict subrange of the
 * caller line'}` (item 3: a move with an unknown burden is not split). `capture_failed`: the latest capture failed and
 * no later capture replaced it, so the observation failed and `src/a`'s position is `unknown` (an earlier capture's
 * files never stand in). `ownership_ambiguous`: the catalog's twin `src-twin` also owns `src`, a file's owners tie and
 * the position is `unknown` (`role-line-position.ts:65` on). `containment_absent`: no `containment`, so `src/a` is no
 * child region of `src` and the strictness proof fails. (d): no new split row (the `role_line` rows whose one step is
 * `split` equal those of (a)); L1 once among the adviser holders and its own create not among the reservations; L1
 * `active` with its `src` link open ("Seat and lifecycle still read normally"). No total is compared: (b) hands the
 * too-long L3 off. (b) plans nothing in this world (L1 is neither too long nor too slow); it shows that the page ran
 * and wrote no split for L1, and the refusal itself is caught by (c) (F11).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionCreateOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { adoptPLMixedPlan } from '../helpers/PL-consumption-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import {
  linkS7D2Scopes, openS7D2ProjectWorld, openTargetsOf, runS7D2Work, type S7D2ObservationVariant,
  type S7D2ProjectWorld,
} from '../helpers/S7D2-role-line-world.js';

const worlds: S7D2ProjectWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

/** The `role_line` rows whose one step is `split`. */
const isSplit = (row: RoleLineOperationReadV1): boolean =>
  row.action === 'role_line' && row.steps.map(step => step.key).join(',') === 'split';

/** The child create among the `role_line` rows' steps whose `plannedSessionRef` is `line` (its own creation). */
async function createOf(handle: S7D2ProjectWorld, line: SessionRef): Promise<OperationRef | null> {
  for (const row of await handle.operations()) {
    if (row.action !== 'role_line') continue;
    for (const step of row.steps) {
      if (step.childOperation === null) continue;
      const child = valueOf<SessionCreateOperationRecord>(await handle.main.route('sessions/operation',
        step.childOperation), 'ready', `the child create ${step.childOperation.operationId}`);
      if (child.action.plannedSessionRef.sessionId === line.sessionId) return step.childOperation;
    }
  }
  return null;
}

describe('RL-14', () => {
  /*
   * Named mutation (v4 :8852): `regionPositionOf` renders `unknown` as `{status:'region',moduleRef,burden:0}` ->
   * `capture_failed` and `ownership_ambiguous`: (c) answers `accepted` and a split row appears, red.
   * `containment_absent` is not sensitive to it (merged :204: its mutation shows only on the read, O5b-R2's).
   */
  it.each<S7D2ObservationVariant>(['capture_failed', 'ownership_ambiguous', 'containment_absent'])(
    'RL-14 (memory): %s — the unknown-burden move is refused and nothing is split', async observation => {
      const handle = await openS7D2ProjectWorld({ backend: 'memory', observation,
        adviserTools: ['read', 'send_session_message', 'create_member', 'propose_role_split'],
        extraHostOptions: { scribeReminderPeriodMs: 25 } });
      worlds.push(handle);
      const l1 = handle.regionAdviser;
      const before = (await handle.operations()).filter(isSplit);

      await handle.main.route('workflow/advance', { schemaVersion: 1, goalRef: handle.world.goals.second,
        flowId: `s7d2-rl14-${observation}`, sessionHint: null, kind: 'select_work' });
      const settled = handle.world.consumeBarrier();
      handle.world.clock.advance(25);
      await settled;

      if (l1.role.kind !== 'legacy_template') throw new Error(`RL-14: L1 has no template role: ${JSON.stringify(l1.role)}`);
      const { tasks } = await adoptPLMixedPlan(handle.world, { goal: handle.goal, label: 's7d2-rl14',
        tasks: [{ taskId: 'rl14-1', role: l1.role.templateId }] });
      const task = tasks[0]!;
      await linkS7D2Scopes(handle.world, { line: l1, label: 's7d2-rl14-task', targets: [{ kind: 'task', ref: task }] });
      await runS7D2Work(handle.world, { line: l1, goal: handle.goal, task, label: 'rl14-split', replies: [
        { kind: 'calls', calls: [{ callId: 'rl14-split', name: 'propose_role_split', args: {
          move: [{ kind: 'region', moduleRef: { projectId: S6A_SCOPE.projectId, moduleId: 'src/a' } }],
          reason: 'RL-14: src/a carries a burden of its own' } }] },
        { kind: 'text', text: 'RL-14 done' },
      ] });
      expect(jsonOf(await handle.world.scripted.requests(l1), 'rl14-split')).toEqual({ status: 'rejected',
        code: 'invalid', reason: 'the move is not a strict subrange of the caller line' });

      expect((await handle.operations()).filter(isSplit)).toEqual(before);
      const allocation = await handle.allocation();
      expect(allocation.duties.adviser.holders.filter(holder => holder.session.sessionId === l1.ref.sessionId))
        .toHaveLength(1);
      const own = await createOf(handle, l1.ref);
      expect(allocation.duties.adviser.reservations
        .filter(reservation => reservation.operationRef.operationId === own?.operationId)).toEqual([]);
      const card = await handle.readCard(l1);
      expect(card.record.lifecycle).toBe('active');
      expect(openTargetsOf(card).filter(target => target.kind === 'module'))
        .toEqual([{ kind: 'module', ref: handle.modules.region }]);
    }, 300_000);
});
