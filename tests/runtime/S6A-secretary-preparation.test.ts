/**
 * A request round's preparation (R-10), through the public steps only: a request
 * submitted through `requests/submit`, its round claimed through `queries/claim`
 * with the profile `bootstrap` publishes, prepared through `queries/prepare`,
 * and started through `queries/start` with one scripted reply so the Session's
 * own model request can be read — its first user message is the rendered input
 * the secretary receives.
 *
 * The expected inputs are `secretaryInputText` of the frozen
 * `tests/helpers/S6A-prompt-samples.ts`, filled with values public steps
 * returned (`notes/write`'s note ids and versions, `goals/settings`, the
 * pointer reads, `workspaces/registration`, `queries/read`'s `since`).
 * Nothing is read from the store, no record is written by hand, and the reply
 * is the scripted model.
 *
 * Rows: a goal request's whole input; a no-goal request's workspace overview,
 * goal list, `secretary.noGoal` and the project understanding and norms; a
 * batch of two pending rounds with the later one in `task_batched`; a plain
 * Query whose Job has no Goal is still refused; the frozen manifest (its
 * digest is the digest of exactly the sampled input).
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { BootstrapExecutionQueryProfile } from '../../src/app/core-http-types.js';
import type { CoreRejection, ReadResult } from '../../src/contracts/core/results.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { ready } from '../helpers/S5-application-support.js';
import { seedS6AMemory, S6A_GOVERNANCE_CASES, type S6AMemory } from '../helpers/S6A-memory-fixture.js';
import {
  answerFormatText, architectureSample, QUERY_PRELUDE, secretaryInputText, type SecretaryInputSample,
  type SampleGoalPayload, type SampleNote, type SampleRound,
} from '../helpers/S6A-prompt-samples.js';
import {
  S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

/** The queued submit's refs; a rejection is a failed row, never a null. */
function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

/** The published profile as the claim takes it (`SecretaryProfileV1`: the bootstrap's `id` is its `profileId`). */
async function profileOf(world: S6AHostWorld): Promise<Record<string, unknown>> {
  const profiles: BootstrapExecutionQueryProfile[] = await world.readProfiles();
  const profile = profiles.find(candidate => candidate.id === S6A_SECRETARY_PROFILE_ID);
  if (profile === undefined) throw new Error('S6A: the secretary profile is not published');
  return { profileId: profile.id, sessionRole: profile.sessionRole, roleBinding: profile.roleBinding,
    runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId };
}

/** `queries/claim` of the round's current Run on the Session, pinned at the revisions read now. */
async function claim(world: S6AHostWorld, round: QueryJobRef, session: S6ASession): Promise<void> {
  const { job, run } = await readQuery(world.ag2b, round);
  const card = await world.readSession(session);
  const answer = await world.post('queries/claim', graphWrite(S6A_SCOPE, {
    queryRunRef: run.ref, sessionRef: session.ref, profile: await profileOf(world),
  }, `s6a-prep-claim-${round.queryJobId}`, [
    { ref: job.ref, revision: job.revision }, { ref: run.ref, revision: run.revision },
    { ref: card.record.ref, revision: card.record.revision },
  ]));
  expect(answer.body).toMatchObject({ status: 'committed' });
}

/** `queries/prepare` of the claimed round. */
async function prepare(world: S6AHostWorld, round: QueryJobRef): Promise<ReadResult<PreparedQueryExecution>> {
  return (await world.post('queries/prepare', body({
    queryRunRef: (await readQuery(world.ag2b, round)).run.ref, requestId: `s6a-prep-${round.queryJobId}`,
  }))).body as ReadResult<PreparedQueryExecution>;
}

/** The frozen manifest through the public `materials/open` route, before the start. */
async function manifestOf(world: S6AHostWorld, prepared: PreparedQueryExecution): Promise<PreparedQueryManifestV1> {
  const opened = await world.post('materials/open', body({ ref: prepared.bundleRef, usage: 'historical_explanation' }));
  const result = opened.body as ReadResult<{ body: string }>;
  if (result.status !== 'ready') throw new Error(`the prepared manifest must be openable: ${JSON.stringify(result)}`);
  return JSON.parse(result.value.body) as PreparedQueryManifestV1;
}

/**
 * One valid answer of the execution kind the frozen manifest names, so the
 * started round ends normally; the input is read whether or not it does.
 */
const SEMANTIC_ANSWER = JSON.stringify({ schemaVersion: 1, body: 'S6A answer', ideas: [], goalCardDrafts: [] });
const COORDINATION_ANSWER = JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'S6A summary',
  questions: ['S6A question'] });

/**
 * Starts the prepared round with one scripted reply and returns the rendered
 * input: the first user message of the Session's own model request.
 */
async function startAndReadInput(world: S6AHostWorld, session: S6ASession, prepared: ReadResult<PreparedQueryExecution>,
  executionKind: 'semantic_query' | 'initial_coordination'): Promise<string> {
  const value = ready<PreparedQueryExecution>(prepared);
  await world.scripted.script(session, [{ kind: 'text',
    text: executionKind === 'semantic_query' ? SEMANTIC_ANSWER : COORDINATION_ANSWER }]);
  const started = await world.post('queries/start', body({
    prepared: value, consumerId: 'ag2b-consumer', requestId: `s6a-prep-start-${value.queryRunRef.runId}`,
  }));
  expect(started.body).toMatchObject({ status: 'ready' });
  const requests = await world.scripted.requests(session);
  const first = requests[0];
  if (first === undefined) throw new Error('S6A: the Session served no model request');
  const message = first.messages[0] as { role: string; content: string };
  expect(message.role).toBe('user');
  return message.content;
}

/** One round's material as the public request read shows it. */
function roundSample(since: string, input: string): SampleRound {
  return { since, input };
}

/** The note index the read model lists for goal 1: the notes written on the goal anchor, in write order. */
function noteIndexOf(memory: S6AMemory): SampleNote[] {
  return memory.first.notes.map(note => ({ noteId: note.noteId, version: note.version, kind: note.kind,
    anchor: note.anchor, conclusion: note.conclusion, structural: note.structural }));
}

/** The selected goal's payload as the public reads describe it (newest norm first, as the read model lists them). */
function goalPayloadOf(memory: S6AMemory): SampleGoalPayload {
  const understanding = memory.first.understanding;
  const project = memory.project.understanding;
  if (understanding === null || project === null) throw new Error('S6A: the memory fixture wrote no understanding');
  return {
    goalId: memory.first.goalId, objective: memory.first.objective, autonomy: memory.first.autonomy,
    projectUnderstanding: { noteId: project.noteId, version: project.version, conclusion: project.conclusion,
      sections: project.sections },
    goalUnderstanding: { noteId: understanding.noteId, version: understanding.version,
      conclusion: understanding.conclusion, sections: understanding.sections },
    norms: [...memory.project.norms].reverse().map(note => ({ noteId: note.noteId, version: note.version,
      kind: note.kind, anchor: note.anchor, conclusion: note.conclusion, structural: note.structural })),
    normsOmitted: 0,
  };
}

/** The whole input of a goal request, hand-built from the samples and the public facts. */
function goalInputSample(memory: S6AMemory, since: string, text: string): SecretaryInputSample {
  const architecture = memory.governance.architecture;
  const policy = memory.governance.policy;
  return {
    role: { policyRevision: 's6a-secretary-binding@1', tools: ['read'], takesSessionHistory: false },
    workspace: { workspaceId: memory.workspace.workspaceId, revision: memory.workspace.revision },
    architecture: architecture === null ? null : architectureSample(architecture),
    policy: policy === null ? null : { policyId: policy.policyId, revision: policy.revision },
    goals: memory.goals.map(goal => ({ goalId: goal.goalId, desiredState: goal.desiredState, objective: goal.objective })),
    request: { kind: 'goal', goal: goalPayloadOf(memory), noteIndex: noteIndexOf(memory) },
    executionKind: 'semantic_query',
    round: roundSample(since, text),
  };
}

const GOAL_TEXT = 'S6A goal request';

async function prepareGoalRequest(world: S6AHostWorld, memory: S6AMemory,
  executionKind: 'semantic_query' | 'initial_coordination' = 'semantic_query'):
Promise<{ session: S6ASession; round: QueryJobRef; since: string; input: string; manifest: PreparedQueryManifestV1 }> {
  const session = await world.createSecretary('a');
  const submitted = await world.submit({ commandId: 's6a-prep-submit', goalId: S6A_GOAL_1.goalId, text: GOAL_TEXT });
  expect(submitted).toMatchObject({ status: 'queued', assignment: 'assigned' });
  const round = queued(submitted).round;
  await claim(world, round, session);
  const prepared = ready<PreparedQueryExecution>(await prepare(world, round));
  const manifest = await manifestOf(world, prepared);
  const input = await startAndReadInput(world, session, { status: 'ready', value: prepared }, executionKind);
  const since = (await readQuery(world.ag2b, round)).job.since;
  return { session, round, since, input, manifest };
}

describe.each(['memory', 'sqlite'] as const)('a goal request prepares from the secretary facts (%s)', backend => {
  it('the whole input is the sampled secretary input of the project state', async () => {
    const world = await openS6AHostWorld({ backend });
    worlds.push(world);
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    const { since, input } = await prepareGoalRequest(world, memory);
    expect(input).toBe(secretaryInputText(goalInputSample(memory, since, GOAL_TEXT)));
  });

  it('the prepared answer names exactly the sampled input digest and the round is bound', async () => {
    const world = await openS6AHostWorld({ backend });
    worlds.push(world);
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    const session = await world.createSecretary('a');
    const submitted = await world.submit({ commandId: 's6a-prep-digest', goalId: S6A_GOAL_1.goalId, text: GOAL_TEXT });
    const { requestRoot, round } = queued(submitted);
    await claim(world, round, session);
    // The revisions the facts froze are the ones the public read shows after
    // the claim, before preparation binds its own manifest.
    const claimed = await readQuery(world.ag2b, round);
    const prepared = ready<PreparedQueryExecution>(await prepare(world, round));
    const expected = secretaryInputText(goalInputSample(memory, (await readQuery(world.ag2b, round)).job.since, GOAL_TEXT));
    expect(prepared.queryRunRef).toEqual((await readQuery(world.ag2b, round)).run.ref);
    expect(prepared.inputDigest).toBe(createHash('sha256').update(expected, 'utf8').digest('hex'));

    // The frozen manifest is opened through the public materials route before
    // the start, and every field the public steps returned is compared exactly.
    const manifest = await manifestOf(world, prepared);
    const { job, run } = claimed;
    const goalRead = (await world.post('goals/read', body(S6A_GOAL_1))).body as ReadResult<{ goal: { ref: unknown; revision: number } }>;
    const goal = ready<{ goal: { ref: unknown; revision: number } }>(goalRead).goal;
    const view = await world.readRequest(requestRoot);
    const tail = view.rounds[view.rounds.length - 1];
    if (tail === undefined) throw new Error('S6A: the request read lists no round');
    expect(manifest.goal).toEqual({ ref: goal.ref, revision: goal.revision });
    expect(manifest.request).toEqual({
      requestRoot,
      round: {
        ref: round, revision: job.revision, runRef: run.ref, runRevision: run.revision,
        since: job.since, text: GOAL_TEXT, selectedIdea: null, relatedCards: [],
      },
      batch: [],
      preparationCursor: tail.since,
      effectiveGoalId: S6A_GOAL_1.goalId,
      executionKind: 'semantic_query',
    });
    expect(manifest.contextAssembly.callKind).toBe('secretary');

    // The frozen manifest is legal: the start's own checks accept it and the round enters.
    const started = await world.post('queries/start', body({
      prepared, consumerId: 'ag2b-consumer', requestId: 's6a-prep-digest-start',
    }));
    expect(started.body).toMatchObject({ status: 'ready' });
    const entered = await readQuery(world.ag2b, round);
    expect(entered.run.run.executionState?.phase).not.toBe('claimed');
  });
});

describe.each(['memory', 'sqlite'] as const)('a no-goal request (%s)', backend => {
  it('shows the workspace, the goal list, no goal card and the project understanding and norms', async () => {
    const world = await openS6AHostWorld({ backend });
    worlds.push(world);
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    const understanding = memory.project.understanding;
    if (understanding === null) throw new Error('S6A: the memory fixture wrote no project understanding');
    const sample: SecretaryInputSample = {
      role: { policyRevision: 's6a-secretary-binding@1', tools: ['read'], takesSessionHistory: false },
      workspace: { workspaceId: memory.workspace.workspaceId, revision: memory.workspace.revision },
      architecture: memory.governance.architecture === null ? null : architectureSample(memory.governance.architecture),
      policy: memory.governance.policy === null ? null : { policyId: memory.governance.policy.policyId,
        revision: memory.governance.policy.revision },
      goals: memory.goals.map(goal => ({ goalId: goal.goalId, desiredState: goal.desiredState, objective: goal.objective })),
      request: { kind: 'no_goal',
        projectUnderstanding: { noteId: understanding.noteId, version: understanding.version,
          conclusion: understanding.conclusion, sections: understanding.sections },
        norms: [...memory.project.norms].reverse().map(note => ({ noteId: note.noteId, version: note.version,
          kind: note.kind, anchor: note.anchor, conclusion: note.conclusion, structural: note.structural })),
        normsOmitted: 0 },
      executionKind: 'semantic_query',
      round: { since: 'SINCE', input: 'S6A no-goal request' },
    };
    const session = await world.createSecretary('a');
    const submitted = await world.submit({ commandId: 's6a-prep-nogoal', goalId: null, text: 'S6A no-goal request' });
    expect(submitted).toMatchObject({ status: 'queued', assignment: 'assigned' });
    const round = queued(submitted).round;
    await claim(world, round, session);
    const input = await startAndReadInput(world, session, await prepare(world, round), 'semantic_query');
    const since = (await readQuery(world.ag2b, round)).job.since;
    expect(input).toBe(secretaryInputText({ ...sample, round: { since, input: 'S6A no-goal request' } }));
    // Named facts of the rows, spelled out: no goal card, the no-goal line, both memory lines.
    expect(input).toContain('This request has no goal yet.');
    expect(input).not.toContain(`goal: ${S6A_GOAL_1.goalId}`);
    expect(input).toContain('项目 当前理解');
    expect(input).toContain('约定(项目)');
    expect(input).toContain('决定(项目)');
  });
});

describe.each(['memory', 'sqlite'] as const)('a batch of two pending rounds (%s)', backend => {
  it('renders the later round whole in the batched slot', async () => {
    const world = await openS6AHostWorld({ backend });
    worlds.push(world);
    const memory = await seedS6AMemory(world, { architecture: true, policy: true });
    const session = await world.createSecretary('a');
    const first = queued(await world.submit({ commandId: 's6a-prep-batch-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A first round' }));
    const second = await world.submit({ commandId: 's6a-prep-batch-2', goalId: S6A_GOAL_1.goalId,
      text: 'S6A second round', continues: first.requestRoot });
    expect(second).toMatchObject({ status: 'queued' });
    const view = await world.readRequest(first.requestRoot);
    expect(view.rounds.map(round => round.status)).toEqual(['queued', 'queued']);
    const secondSince = view.rounds[1]!.since;
    await claim(world, first.round, session);
    const input = await startAndReadInput(world, session, await prepare(world, first.round), 'semantic_query');
    const expected = secretaryInputText({
      ...goalInputSample(memory, (await readQuery(world.ag2b, first.round)).job.since, 'S6A first round'),
      batched: [roundSample(secondSince, 'S6A second round')],
    });
    expect(input).toBe(expected);
    expect(input).toContain('## Also queued in this request\n- [' + secondSince + '] S6A second round');
  });
});

describe.each(['memory', 'sqlite'] as const)('a plain Query is never a secretary round (%s)', backend => {
  describe('rejects: a plain Query without a goal', () => {
  it('a plain Query with no Goal is refused before it can be claimed', async () => {
    const world = await openS6AHostWorld({ backend });
    worlds.push(world);
    const queryJobId = 's6a-plain-no-goal';
    const submitted = (await world.post('queries/submit', graphWrite(S6A_SCOPE, {
      queryJobId, runId: `${queryJobId}-run`, intent: {
        schemaVersion: 1, intentId: queryJobId, projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
        goalId: null, question: 'S6A no-goal plain Query', focusTaskRefs: [],
        budget: { maxTokens: 200000, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 's6a-plain-corr',
        execution: { kind: 'semantic_query', roleBinding: { schemaVersion: 1, bindingId: 's6a-plain-binding',
          templateId: 's6a-plain-role', templateRevision: 's1.1', bindingVersion: 1, policyRevision: 'legacy-template' },
          runtimeBudget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 16,
            maxToolCalls: 16, timeoutMs: 60000, perResponseTokens: 512 } },
      },
    }, 's6a-plain-no-goal-submit', [
      { ref: { aggregateType: 'QueryJob', projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId, queryJobId }, revision: 0 },
      { ref: { aggregateType: 'QueryRun', projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
        queryJobId, runId: `${queryJobId}-run` }, revision: 0 },
    ]))).body as CoreRejection;
    expect(submitted).toMatchObject({ status: 'rejected', code: 'unsupported',
      reason: 'this batch requires a real goalId' });
    // No Job was written: the public read cannot find it.
    const read = (await world.post('queries/read', body({ aggregateType: 'QueryJob', projectId: S6A_SCOPE.projectId,
      workspaceId: S6A_SCOPE.workspaceId, queryJobId }))).body;
    expect((read as { status: string }).status).toBe('not_found');
  });
  });

  it('a plain Query with a Goal keeps its own Query input', async () => {
    const world = await openS6AHostWorld({ backend });
    worlds.push(world);
    const session = await world.createSecretary('a');
    const refs = await world.occupy(session);
    const input = await startAndReadInput(world, session, await prepare(world, refs.queryJobRef), 'semantic_query');
    expect(input).toContain(`goal: ${S6A_GOAL_1.goalId}`);
    expect(input).not.toContain('This request has no goal yet.');
    expect(input).not.toContain('## This round');
    expect(input).not.toContain('## Workspace');
  });
});

describe.each(['memory', 'sqlite'] as const)('the four answer formats of a no-goal request (%s)', backend => {
  it('the sampled no-goal input of each execution kind ends with its own answer format', async () => {
    for (const governanceCase of S6A_GOVERNANCE_CASES) {
      const world = await openS6AHostWorld({ backend });
      worlds.push(world);
      const memory = await seedS6AMemory(world, { architecture: governanceCase.architecture, policy: governanceCase.policy });
      const session = await world.createSecretary('a');
      const submitted = await world.submit({ commandId: `s6a-prep-gov-${governanceCase.name}`.replace(/ /g, '-'),
        goalId: null, text: 'S6A governance request' });
      const round = queued(submitted).round;
      await claim(world, round, session);
      const executionKind = governanceCase.architecture && governanceCase.policy ? 'semantic_query' : 'initial_coordination';
      const prepared = ready<PreparedQueryExecution>(await prepare(world, round));
      const manifest = await manifestOf(world, prepared);
      expect(manifest.request?.executionKind, `case ${governanceCase.name} freezes ${executionKind}`)
        .toBe(executionKind);
      const input = await startAndReadInput(world, session, { status: 'ready', value: prepared }, executionKind);
      expect(input.endsWith(answerFormatText({ executionKind, noGoal: true })),
        `case ${governanceCase.name} uses ${executionKind}`).toBe(true);
      // S10: the drafts note follows the v2 format only for a no-goal coordination round.
      const drafts = 'You MAY add a top-level "goalCardDrafts" array';
      expect(input.includes(drafts)).toBe(executionKind === 'initial_coordination');
      expect(input.startsWith(QUERY_PRELUDE)).toBe(true);
      expect(memory.governance.architecture === null).toBe(!governanceCase.architecture);
    }
  });

  it('a goal request takes the same branch from the same two pointers', async () => {
    for (const governanceCase of S6A_GOVERNANCE_CASES) {
      const world = await openS6AHostWorld({ backend });
      worlds.push(world);
      const memory = await seedS6AMemory(world, { architecture: governanceCase.architecture, policy: governanceCase.policy });
      const expected: 'semantic_query' | 'initial_coordination' =
        governanceCase.architecture && governanceCase.policy ? 'semantic_query' : 'initial_coordination';
      const { since, input, manifest } = await prepareGoalRequest(world, memory, expected);
      expect(manifest.request?.executionKind, `case ${governanceCase.name} freezes ${expected}`).toBe(expected);
      expect(input.endsWith(answerFormatText({ executionKind: expected, noGoal: false })),
        `case ${governanceCase.name} uses ${expected}`).toBe(true);
      // The drafts note is the no-goal branch's alone; a goal request never carries it.
      expect(input.includes('You MAY add a top-level "goalCardDrafts" array')).toBe(false);
      // The goal card is there in both branches.
      expect(input).toContain(`goal: ${S6A_GOAL_1.goalId}`);
      expect(input).toContain(`- [${since}] ${GOAL_TEXT}`);
    }
  });
});
