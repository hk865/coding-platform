/**
 * P2 T13 (p2-frozen.md:328): `failCommitOnce` lets the Answer land and makes the
 * candidate submit throw I/O once; after the Host restart the candidate is
 * written once (one Query, `previous === null`, the same proposal ref/rev).
 *
 * SQLite only. `world.crash()` abandons the Host and starts a new one on the
 * same store directory (`tests/helpers/S6A-host-fixture.ts:396-398`).
 *
 * RED today: nothing rebuilds the failed round-end candidate write after the
 * restart, so `plans/request-candidate` is still null.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  initializeProject, newRequest, secretaryAnswer, submitRound, threeIdeas, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
});

type PlanForm = {
  stages: unknown[];
  tasks: Record<string, unknown>[];
  assignments: { taskId: string; role: string; instruction: string }[];
  obligations: Record<string, unknown>[];
  taskHierarchy: { parentOf: unknown[] };
  executionDag: { dependsOn: unknown[] };
  taskRelations: unknown[];
  inputRequirements: unknown[];
};

/** A complete v2 plan (one required work Task, the goal gate, one acceptance obligation). */
function planForm(tag: string): PlanForm {
  const work = `${tag}-work`;
  const gate = `${tag}-gate`;
  return {
    stages: [],
    tasks: [
      { taskId: work, title: `${tag} work`, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: gate, title: `${tag} goal gate`, requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: work, role: S6A_WORK_ROLE.templateId, instruction: `${tag} instruction` }],
    obligations: [{
      obligationId: `${tag}-obligation`, title: `${tag} delivery`, requirementLevel: 'required',
      taskIds: [work, gate],
      verificationRequirements: [{ requirementId: `${tag}-check`, requirementLevel: 'required', kind: 'static',
        description: `${tag} static check` }],
    }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

function planCall(callId: string, summary: string, plan: PlanForm) {
  return { kind: 'calls' as const, calls: [{ callId, name: 'submit_plan_round',
    args: { answerKind: 'plan', summary, plan } }] };
}

type CandidateRead = {
  head: { ref: { proposalId: string }; revision: number } | null;
  status: string | null;
  previous: { ref: { proposalId: string }; revision: number } | null;
};

const candidateOf = async (world: S6AHostWorld, requestRoot: QueryJobRef): Promise<CandidateRead> => ready<CandidateRead>(await world.post('plans/request-candidate',
  plain(S6A_SCOPE, { goalRef: S6A_GOAL_1, requestRef: requestRoot })), 'plans/request-candidate');

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms));
}

describe('P2 T13: the candidate submit fails once and the restart writes it once', () => {
  it('Answer lands; the candidate commit throws; after the crash one candidate exists with no previous', async () => {
    const world = await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    await initializeProject(world);
    const secretary: S6ASession = await world.createSecretary('a');

    const ideas = threeIdeas('p2-t13');
    await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: 'P2 T13 ideas', ideas }) }]);
    const first = await submitRound(world, newRequest('p2-t13-request', secretary, 'P2 T13 question'));
    await waitForRound(world, first.requestRoot, first.round, 'ended');
    const selected = await world.selectIdea({ commandId: 'p2-t13-select', round: first.round, index: 1 });
    if (selected.status !== 'queued') throw new Error(`P2 T13: the selection was refused: ${JSON.stringify(selected)}`);
    const followup = selected.followupRound;

    // The follow-up round's plan answer lands first; the candidate write after it
    // is the one store call that fails once.
    await world.scripted.script(secretary, [planCall('p2-t13-plan', 'P2 T13 summary', planForm('p2-t13'))]);
    const fault = commitBarrier.failCommitOnce(commit =>
      commit.records.some(record => record.schemaId === 'PlanProposal@2'));
    void fault;
    await world.waitForRequest(first.requestRoot, view => {
      const round = view.rounds.find(entry => entry.ref.queryJobId === followup.queryJobId);
      return round !== undefined && round.status !== 'queued' && round.status !== 'running';
    }, 'the T13 follow-up to end');
    const before = await candidateOf(world, first.requestRoot);
    expect(before.head).toBeNull();

    await world.crash();
    let after = await candidateOf(world, first.requestRoot);
    for (let pass = 0; pass < 40 && after.head === null; pass += 1) {
      await sleep(100);
      after = await candidateOf(world, first.requestRoot);
    }
    expect(after.head).not.toBeNull();
    expect(after.status).toBe('candidate');
    expect(after.previous).toBeNull();

    // The once-only side: one Query and the same candidate on a second read.
    const queries = ready<{ items: Array<{ ref: { queryJobId: string } }> }>(await world.post('sessions/queries',
      plain(S6A_SCOPE, { sessionRef: secretary.ref, page: { limit: 100 } })), 'the T13 rounds');
    const sameQuestion = queries.items.filter(item => item.ref.queryJobId === followup.queryJobId);
    expect(sameQuestion).toHaveLength(1);
    const again = await candidateOf(world, first.requestRoot);
    expect(again.head?.ref).toEqual(after.head?.ref);
    expect(again.head?.revision).toBe(after.head?.revision);
  }, 300_000);
});
