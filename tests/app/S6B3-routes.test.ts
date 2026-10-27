/**
 * Row 39: the four `plain` routes. The table rows; a foreign envelope refused at the
 * parse; the person guard on the three commands, while `goals/copy-draft` stays a read any trusted caller may make;
 * each suffix answered by its own owner; and the adoption route of a Host that binds no adoption owner. Memory,
 * fixture steps 1 and 2: every answer is the real Host's, over HTTP as the person or through the world's in-process
 * dispatch with its non-person Host actor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';
import type {
  CoreRouteSuffix, GoalsConfirmDraftBody, GoalsConfirmDraftResponse, GoalsCopyConfirmBody, GoalsCopyConfirmResponse,
  GoalsCopyDraftBody, GoalsCopyDraftResponse, InitializationAdoptBody, InitializationAdoptResponse,
} from '../../src/app/core-http-types.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { configureS6B3SecondWorkspace, openS6B3World, type S6B3World } from '../helpers/S6B3-fixture.js';
import { EXPECTED_ROUTE_ROWS, S6B3_ROUTES } from '../helpers/S6B3-route-suffixes.js';

let world: S6B3World;
let second: { projectId: string; workspaceId: string };
let active: GoalSnapshot;

beforeAll(async () => {
  world = await openS6B3World({ backend: 'memory' });
  const opened = await configureS6B3SecondWorkspace(world, { name: 'S6B3 routes', goals: 2 });
  second = opened.scope;
  active = opened.goals[0]!;
});
afterAll(async () => { await world.close(); });

/** The Goals of both workspaces, through the platform's own Goal listing. */
async function goalCounts(): Promise<number[]> {
  const counts: number[] = [];
  for (const scope of [world.mainScope, second]) {
    const read = await world.host.platform.reconcile.candidates.listGoals(scope, new AbortController().signal);
    if (read.status !== 'ready') throw new Error(`S6B3 row 39: the Goals are not readable: ${JSON.stringify(read)}`);
    counts.push(read.value.records.length);
  }
  return counts;
}

const PERSON = 'only the person may call this route';
const COPIED_ONLY = 'a Goal can be copied only from a cancelled source';

/** The four bodies of one scope; the round, Goal and answer refs are values a person could send. */
function bodies(scope: { projectId: string; workspaceId: string }, goal: { ref: GoalSnapshot['ref']; revision: number }) {
  return {
    'goals/confirm-draft': plain(scope, { commandId: 'row-39-confirm', index: 0,
      round: { aggregateType: 'QueryJob', ...scope, queryJobId: 'row-39-no-round' } } satisfies GoalsConfirmDraftBody['input']),
    'goals/copy-draft': plain(scope, { goalRef: goal.ref } satisfies GoalsCopyDraftBody['input']),
    'goals/copy-confirm': plain(scope, { commandId: 'row-39-copy', sourceGoalRef: goal.ref,
      expectedSourceRevision: goal.revision, selectedInterventions: [] } satisfies GoalsCopyConfirmBody['input']),
    'initialization/adopt': plain(scope, { commandId: 'row-39-adopt', expectedAnswerDigest: '0'.repeat(64),
      source: { kind: 'prepared_goal', answerRef: { aggregateType: 'QueryJobAnswer', ...scope,
        queryJobId: 'row-39-no-round', answerId: 'row-39-no-answer' } },
      expectedGoal: { ref: goal.ref, revision: goal.revision } } satisfies InitializationAdoptBody['input']),
  };
}

describe('row 39: the four routes (memory)', () => {
  it('publishes each suffix as a plain row with its named binding and owner', () => {
    for (const suffix of S6B3_ROUTES satisfies readonly CoreRouteSuffix[]) {
      expect(CORE_ROUTE_SPECS[suffix], suffix).toEqual(EXPECTED_ROUTE_ROWS[suffix]);
    }
  });

  describe('rejects: the four routes', () => {
    it.each(S6B3_ROUTES.flatMap(suffix => [
      [suffix, 'request', { request: { input: {}, meta: { requestId: `row-39-${suffix}`, expected: [] } } }],
      [suffix, 'extra', { input: {}, extra: true }],
    ] as const))('%s refuses the "%s" key at the parse', async (suffix, key, rest) => {
      const before = await goalCounts();
      expect(await world.host.post(suffix, { scope: world.mainScope, ...rest })).toEqual({ httpStatus: 400,
        body: { status: 'rejected', code: 'invalid', reason: `the request body may not carry "${key}"` } });
      expect(await goalCounts()).toEqual(before);
    });

    // Over HTTP as the person: each suffix reaches its own owner, which refuses the value.
    it.each([
      ['goals/confirm-draft', 'main', { status: 'rejected', code: 'not_found',
        reason: 'the round is not a request round of this workspace' } satisfies GoalsConfirmDraftResponse],
      ['goals/copy-draft', 'second', { status: 'rejected', code: 'invalid', reason: COPIED_ONLY } satisfies GoalsCopyDraftResponse],
      ['goals/copy-confirm', 'second', { status: 'rejected', code: 'invalid', reason: COPIED_ONLY } satisfies GoalsCopyConfirmResponse],
    ] as const)('%s, called by the person, is answered by its own owner', async (suffix, where, answer) => {
      const before = await goalCounts();
      const scope = where === 'main' ? world.mainScope : second;
      expect(await world.host.post(suffix, bodies(scope, active)[suffix]))
        .toEqual({ httpStatus: 200, body: expect.objectContaining(answer) });
      expect(await goalCounts()).toEqual(before);
    });

    // In process with the world's non-person Host actor: the guard answers before the owner; the preview is a read.
    it.each([
      ['goals/confirm-draft', { status: 'rejected', code: 'forbidden', reason: PERSON } satisfies GoalsConfirmDraftResponse],
      ['goals/copy-confirm', { status: 'rejected', code: 'forbidden', reason: PERSON } satisfies GoalsCopyConfirmResponse],
      ['goals/copy-draft', { status: 'rejected', code: 'not_found',
        reason: 'goal row-39-missing does not exist' } satisfies GoalsCopyDraftResponse],
      ['initialization/adopt', { status: 'rejected', code: 'unsupported',
        reason: 'the Host does not publish initialization adoption' } satisfies InitializationAdoptResponse],
    ] as const)('%s, called by a non-person actor, answers before any write', async (suffix, answer) => {
      const before = await goalCounts();
      const missing = { ref: { aggregateType: 'Goal' as const, projectId: world.mainScope.projectId,
        goalId: 'row-39-missing' }, revision: 1 };
      expect(await world.host.dispatch(suffix, world.host.systemContext(), bodies(world.mainScope, missing)[suffix]))
        .toEqual(answer);
      expect(await goalCounts()).toEqual(before);
    });

    // Over HTTP on a Host whose configured actor is not the person: the adoption guard answers before the owner.
    it('initialization/adopt, posted to a Host with a system actor, is forbidden', async () => {
      const automation = await openS6B3World({ backend: 'memory', actor: { kind: 'system', id: 'row-39-system' } });
      try {
        const missing = { ref: { aggregateType: 'Goal' as const, projectId: automation.mainScope.projectId,
          goalId: 'row-39-missing' }, revision: 1 };
        expect(await automation.host.post('initialization/adopt',
          bodies(automation.mainScope, missing)['initialization/adopt']))
          .toEqual({ httpStatus: 200, body: { status: 'rejected', code: 'forbidden', reason: PERSON } });
      } finally {
        expect(commitBarrier.reset()).toEqual([]);
        await automation.close();
      }
    });
  });
});
