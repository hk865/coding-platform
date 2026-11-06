/**
 * The secretary side of `requests/submit`'s `references` (UI1 request-refs 说明书 §5, ruling 22–25).
 *
 * The route rows live in `S6A-request-routes.test.ts`; the read-model rows in
 * `S6A-main-read.test.ts`; this file proves the two things only a running
 * secretary round can show: the references reach the model's round input as
 * their own section, and a references-only request (empty text) enters its
 * round. The expected values are the literals this test submits, never the
 * platform's output.
 *
 * Every step is public: `requests/submit` through the Host route, the published
 * secretary profile's `queries/claim`, `queries/prepare`, `queries/start`, and
 * the scripted model's captured request. No store read, no hand-written fact.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { asRecord } from '../helpers/S6A-memory-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

async function openReferencesWorld(backend: 'memory' | 'sqlite'): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend });
  worlds.push(world);
  return world;
}

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

/** A valid `initial_coordination` answer (the v2 initial-planning format), hand-written. */
const COORDINATION_ANSWER = '{"schemaVersion":2,"kind":"needs_decision","summary":"S6A references summary",'
  + '"questions":["S6A references question"]}';

/** Submits as the person and returns the queued receipt; a refusal fails the row. */
async function submitReferences(world: S6AHostWorld, commandId: string, session: S6ASession,
  text: string, references: readonly unknown[]): Promise<Record<string, unknown>> {
  const answer = await world.post('requests/submit', body({
    commandId, goalId: S6A_GOAL_1.goalId, text, continues: null, recipient: session.ref, references,
  }));
  const queued = asRecord(answer.body);
  if (queued['status'] !== 'queued') throw new Error(`S6A: the submit did not queue: ${JSON.stringify(answer.body)}`);
  return queued;
}

/** Claim, prepare and start one request round on its secretary; returns the prepared value. */
async function runRound(world: S6AHostWorld, round: QueryJobRef, session: S6ASession, label: string) {
  const claimed = await claimWithSecretaryProfile(world, round, session, `${label}-claim`);
  expect(claimed).toMatchObject({ status: 'committed' });
  const prepared = await prepareAttempt(world, round, `${label}-prepare`);
  expect(await start(world, prepared, `${label}-start`)).toMatchObject({ status: 'ready' });
}

describe.each(['memory', 'sqlite'] as const)('a secretary round with request references (%s)', backend => {
  // Ruling 22: the reference reaches the round input as its own section. The
  // literals below are chosen so the path, both line numbers and the snapshot
  // cannot come from the request text. Mutation: delete the references section
  // from the prepared facts/context assembly; this row is red on `toContain`.
  it('the model round input carries the path, both line numbers and the snapshot', async () => {
    const world = await openReferencesWorld(backend);
    const session = await world.createSecretary('refs-model');
    const submitted = await submitReferences(world, 's6a-refs-model', session, 'S6A references model',
      [{ path: 'src/reference-target.ts', startLine: 2718, endLine: 3141, snapshot: 'the selected draft' }]);
    await world.scripted.script(session, [{ kind: 'text', text: COORDINATION_ANSWER }]);
    await runRound(world, submitted['round'] as QueryJobRef, session, 'refs-model');

    const requests = await world.scripted.requests(session);
    expect(requests).toHaveLength(1);
    const input = (requests[0]!.messages[0] as { content: string }).content;
    expect(input).toContain('src/reference-target.ts');
    expect(input).toContain('2718');
    expect(input).toContain('3141');
    expect(input).toContain('the selected draft');
  });

  // Ruling 23: a references-only submit is a legal request. Mutation: keep
  // `text must be non-empty` unconditional; the submit is refused and this row
  // is red before it reaches the claim.
  it('a references-only submit with empty text enters and runs its round', async () => {
    const world = await openReferencesWorld(backend);
    const session = await world.createSecretary('refs-empty-model');
    const submitted = await submitReferences(world, 's6a-refs-empty-model', session, '',
      [{ path: 'src/reference-target.ts', startLine: 7, endLine: 7, snapshot: 'the whole draft' }]);
    const round = submitted['round'] as QueryJobRef;
    await world.scripted.script(session, [{ kind: 'text', text: COORDINATION_ANSWER }]);
    await runRound(world, round, session, 'refs-empty-model');

    const read = asRecord((await world.post('requests/read', body({ requestRoot: submitted['requestRoot'] }))).body);
    expect(read['status']).toBe('ready');
    const view = asRecord(read['value']);
    const viewRound = asRecord((view['rounds'] as unknown[])[0]);
    expect(viewRound['input']).toBe('');
    expect(viewRound['references']).toEqual([
      { path: 'src/reference-target.ts', startLine: 7, endLine: 7, snapshot: 'the whole draft' },
    ]);
    expect(await world.scripted.requests(session)).toHaveLength(1);
  });
});

describe('rejects: references on requests/ask', () => {
  // Ruling 25: ask does not take references. Mutation: drop the
  // `references are only accepted on a submit` check; the ask proceeds to the
  // card read and this row is red on the reason.
  it('an ask carrying references is invalid before any card is read', async () => {
    const world = await openReferencesWorld('memory');
    const session = await world.createSecretary('refs-ask');
    const submitted = await submitReferences(world, 's6a-refs-ask', session, 'S6A references ask', []);
    const round = submitted['round'] as QueryJobRef;
    const roundsBefore = (asRecord(asRecord((await world.post('requests/read',
      body({ requestRoot: submitted['requestRoot'] }))).body)['value'])['rounds'] as unknown[]).length;
    const refused = asRecord((await world.post('requests/ask', body({
      commandId: 's6a-refs-ask-empty', round, regenerate: false, text: 'S6A references ask question',
      cardRefs: [{ ref: { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId },
        revision: 1 }],
      references: [{ path: 'src/reference-target.ts', startLine: 1, endLine: 1, snapshot: 'draft' }],
    }))).body);
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'references are only accepted on a submit' });
    const after = asRecord(asRecord((await world.post('requests/read',
      body({ requestRoot: submitted['requestRoot'] }))).body)['value']);
    expect((after['rounds'] as unknown[]).length).toBe(roundsBefore);
  });
});
