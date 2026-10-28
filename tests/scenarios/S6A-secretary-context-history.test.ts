/**
 * The secretary round's earlier-rounds history, through the public steps: the
 * request commands, the Host's own request driver, the scripted model of each
 * Session's Kernel runs, and the owner read of the request.
 *
 * Every expected input is `secretaryInputText` of the frozen samples, filled
 * only with what public steps returned (the request read's `since` and input,
 * the Session read's history cursor, the goals and workspace the memory
 * fixture read) and with the literals the test itself queued or submitted.
 * Each row checks the whole B-side input and then the fact it is named for:
 * the latest ten other-Session rounds, this Session's rounds not counted, a
 * drop-ended round absent, the 2 KiB answer cut at whole code points, a
 * two-input batch with its selected idea, and a round still running after a
 * Host crash.
 *
 * The copies in `docs/` name the rule; the samples say where the frozen rules
 * leave the text open. Nothing here reads a store, writes a record by hand or
 * builds a platform value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1, RequestRoundViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  answeredRound, buildAbsorbedSelection, buildDropEndedRound, buildLongAnswers, buildTenRoundEdge,
  followUp, initializeProject, newRequest, secretaryAnswer, submitRound, waitForRound,
  S6A_ANSWER_ASCII_2049, S6A_ANSWER_MULTIBYTE,
} from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { seedS6AMemory, type S6AMemory } from '../helpers/S6A-memory-fixture.js';
import {
  architectureSample, secretaryInputText, selectIdeaInputText,
  type SampleEarlierEntry, type SampleRound, type SecretaryInputSample,
} from '../helpers/S6A-prompt-samples.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { ready } from '../helpers/S5-application-support.js';

// The commit barrier holds the prepared commits the Host gates use; its two
// backend factories must be wrapped before any world opens, and the barrier is
// reset before the worlds close so no held commit keeps a close waiting.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
  expect(left).toEqual([]);
});

/** A SQLite world with the request driver on (its own loop runs every round); row 6 opens it off. */
async function openWorld(options: { requestDriver?: 'on' | 'off'; secretaryTools?: readonly string[] } = {}):
Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({
    backend: 'sqlite',
    ...(options.requestDriver === 'off' ? {} : { extraHostOptions: { requestDriver: 'on' } }),
    ...(options.secretaryTools === undefined ? {} : { secretaryTools: options.secretaryTools }),
  });
  worlds.push(world);
  return world;
}

/**
 * The project's two pointers (so a secretary round runs `semantic_query`) and
 * the goals and workspace the whole input shows, read by public steps. The
 * memory fixture is seeded here and its governance handed to the history
 * fixture, so neither helper replays the other's writes.
 */
async function seeded(world: S6AHostWorld): Promise<S6AMemory> {
  const memory = await seedS6AMemory(world, { architecture: true, policy: true, notes: false });
  await initializeProject(world, memory.governance);
  return memory;
}

/**
 * The sample's fixed sections: the workspace and goal facts the public reads
 * returned, the goal-card payload of a project with no notes, and the role.
 * `takesSessionHistory` is a fact of the round that runs: true when its Session
 * already held a completed round before this one.
 */
function baseSample(memory: S6AMemory, takesSessionHistory: boolean, tools: readonly string[] = ['read']):
Omit<SecretaryInputSample, 'round' | 'batched' | 'earlier'> {
  const goal = memory.goals.find(entry => entry.goalId === S6A_GOAL_1.goalId);
  if (goal === undefined) throw new Error('S6A history: the goal read did not list goal 1');
  const architecture = memory.governance.architecture;
  const policy = memory.governance.policy;
  return {
    role: { policyRevision: 's6a-secretary-binding@1', tools: [...tools], takesSessionHistory },
    workspace: { projectId: 'ag2b-collab-project', workspaceId: memory.workspace.workspaceId,
      revision: memory.workspace.revision },
    executionRoles: ['builder'],
    architecture: architecture === null ? null : architectureSample(architecture),
    policy: policy === null ? null : { policyId: policy.policyId, revision: policy.revision },
    goals: memory.goals.map(entry => ({ goalId: entry.goalId, desiredState: entry.desiredState, objective: entry.objective })),
    request: {
      kind: 'goal',
      goal: {
        goalId: goal.goalId, objective: goal.objective, autonomy: goal.autonomy,
        projectUnderstanding: null, goalUnderstanding: null, norms: [],
      },
      noteIndex: [],
    },
    executionKind: 'semantic_query',
  };
}

/** One round as the public request read shows it. */
function roundOf(view: RequestCoreViewV1, ref: QueryJobRef): SampleRound {
  const found = view.rounds.find(entry => entry.ref.queryJobId === ref.queryJobId);
  if (found === undefined) throw new Error(`S6A history: the request read lists no round ${ref.queryJobId}`);
  return { since: found.since, input: found.input };
}

/** The round-view list itself, for rows that name a round by its input. */
function viewRoundOf(view: RequestCoreViewV1, ref: QueryJobRef): RequestRoundViewV1 {
  const found = view.rounds.find(entry => entry.ref.queryJobId === ref.queryJobId);
  if (found === undefined) throw new Error(`S6A history: the request read lists no round ${ref.queryJobId}`);
  return found;
}

/**
 * The rendered input: the newest user message of the last model request. A
 * later round of the same Session also carries that Session's history in its
 * request, so the rendered input is the last user message, not the first.
 */
async function lastInput(world: S6AHostWorld, session: S6ASession): Promise<string> {
  const requests = await world.scripted.requests(session);
  const last = requests.at(-1);
  if (last === undefined) throw new Error(`S6A history: ${session.label} served no model request`);
  const message = [...last.messages].reverse().find(entry => entry.role === 'user') as
    { role?: string; content?: unknown } | undefined;
  if (typeof message?.content !== 'string') {
    throw new Error(`S6A history: the last model request of ${session.label} has no user input`);
  }
  return message.content;
}

describe('a secretary round shows the earlier rounds of other secretaries', () => {
  // Rule: the last ten finished rounds of the request that ran on another
  // Session, oldest first; the two rounds before them are left out, and the
  // round this Session ran itself is not an earlier entry.
  it('shows the latest ten other-Session rounds, oldest first, and not the first two', async () => {
    const world = await openWorld();
    const memory = await seeded(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const tag = 's6a-ten-edge';
    const built = await buildTenRoundEdge(world, { a, b, tag });
    const view = await world.readRequest(built.requestRoot);
    const earlier: SampleEarlierEntry[] = built.onA.slice(2).map((round, offset) => ({
      round: roundOf(view, round),
      result: { kind: 'answer', text: `${tag} answer ${String(offset + 3)} on A` },
    }));
    expect(earlier).toHaveLength(10);
    const input = await lastInput(world, b);
    expect(input).toBe(secretaryInputText({
      ...baseSample(memory, true), round: roundOf(view, built.final.round), earlier,
    }));
    // The two oldest rounds are outside the ten-entry window; their inputs
    // appear nowhere, including in the round material of any entry.
    const first = roundOf(view, built.onA[0]!);
    const second = roundOf(view, built.onA[1]!);
    expect(input).not.toContain(`- [${first.since}] ${first.input}`);
    expect(input).not.toContain(`- [${second.since}] ${second.input}`);
    // B's own earlier round is in the Session history, not in the entries.
    expect(input).not.toContain(`${tag} B question 1`);
  }, 300_000);

  // Rule: only rounds that ran on another Session are entries, so this
  // Session's own rounds make the history mode true but never become entries.
  it('does not count this Session\'s own rounds as earlier entries', async () => {
    const world = await openWorld();
    const memory = await seeded(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const tag = 's6a-ten-session';
    const built = await buildTenRoundEdge(world, { a, b, count: 2, earlierOnB: 2, tag });
    const view = await world.readRequest(built.requestRoot);
    const earlier: SampleEarlierEntry[] = built.onA.map((round, offset) => ({
      round: roundOf(view, round),
      result: { kind: 'answer', text: `${tag} answer ${String(offset + 1)} on A` },
    }));
    expect(earlier).toHaveLength(2);
    const input = await lastInput(world, b);
    expect(input).toBe(secretaryInputText({
      ...baseSample(memory, true), round: roundOf(view, built.final.round), earlier,
    }));
    // B's own earlier rounds are in its Session history (the completed
    // cursor) but their inputs are not entries of the B input.
    expect((await world.readSession(b)).record.historyCursor).not.toBeNull();
    expect(input).not.toContain(`${tag} B question 1`);
    expect(input).not.toContain(`${tag} B question 2`);
  }, 300_000);

  // Rule: a round a drop ended never entered the Kernel, so it is not an
  // earlier entry even though it is a closed round of the request; the
  // answered round before it is.
  it('never shows a round a drop ended and carries the answered round\'s answer', async () => {
    const world = await openWorld();
    const memory = await seeded(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const tag = 's6a-drop';
    const built = await buildDropEndedRound(world, { a, b, tag });
    const view = await world.readRequest(built.requestRoot);
    const answer = `${tag} answer on A`;
    const input = await lastInput(world, b);
    expect(input).toBe(secretaryInputText({
      ...baseSample(memory, false),
      round: roundOf(view, built.onB.round),
      earlier: [{ round: roundOf(view, built.answered), result: { kind: 'answer', text: answer } }],
    }));
    // The dropped follow-up's own input never reached the Kernel, so no text
    // of it appears anywhere in the input; the answered entry carries the
    // stored answer whole.
    const dropped = viewRoundOf(view, built.dropped);
    expect(input).not.toContain(dropped.input);
    expect(input).toContain(answer);
  }, 300_000);

  // Rule: an earlier answer is cut at 2,048 UTF-8 bytes on a whole code point,
  // with `(answer cut at 2 KiB)` on its own line; the ASCII answer is cut, and
  // the multi-byte cut drops the three-byte character crossing the boundary.
  it('cuts long earlier answers at 2,048 bytes on a whole code point', async () => {
    const world = await openWorld();
    const memory = await seeded(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const tag = 's6a-long';
    const built = await buildLongAnswers(world, { a, b, tag });
    const view = await world.readRequest(built.requestRoot);
    const input = await lastInput(world, b);
    expect(input).toBe(secretaryInputText({
      ...baseSample(memory, false),
      round: roundOf(view, built.onB.round),
      earlier: [
        { round: roundOf(view, built.ascii), result: { kind: 'answer', text: S6A_ANSWER_ASCII_2049 } },
        { round: roundOf(view, built.multibyte), result: { kind: 'answer', text: S6A_ANSWER_MULTIBYTE } },
      ],
    }));
    expect(input).toContain('a'.repeat(2048));
    expect(input).not.toContain('a'.repeat(2049));
    // The multi-byte answer's 2,046 `m`s are kept and `中` (the character that
    // would cross the 2,048-byte boundary) is dropped whole.
    expect(input).not.toContain('中');
  }, 300_000);

  // Rule: the batch slot holds every other round the executing round absorbed,
  // whole, in `since` order; a selected idea adds `Selected idea:` and
  // `<title>: <detail>`. The executing round then becomes an earlier entry on
  // the next Session, with the same absorbed rounds.
  it('shows both absorbed inputs whole, with the selected idea and its detail', async () => {
    const world = await openWorld();
    const memory = await seeded(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const tag = 's6a-absorbed';
    const built = await buildAbsorbedSelection(world, { a, routeTo: b, tag });
    const view = await world.readRequest(built.requestRoot);
    // The builder selects the second idea by its 0-based index (the person's
    // second option); the sample's helper takes that same 0-based index.
    const index = 1;
    const idea = built.ideas[index];
    if (idea === undefined) throw new Error('S6A history: the answer carried no idea');
    const selection: SampleRound = {
      ...roundOf(view, built.selection),
      selectedIdea: { title: idea.title, detail: idea.detail },
    };
    const plain = roundOf(view, built.plain);
    const executingInput = await lastInput(world, a);
    expect(executingInput).toBe(secretaryInputText({
      ...baseSample(memory, true),
      round: roundOf(view, built.executing),
      batched: [selection, plain],
    }));
    expect(executingInput).toContain(selectIdeaInputText(index, idea.title));
    expect(executingInput).toContain(`${idea.title}: ${idea.detail}`);

    const final = view.rounds.at(-1);
    if (final === undefined || final.input !== `${tag} final question`) {
      throw new Error(`S6A history: the request read's last round is not the round after the route: ${JSON.stringify(final)}`);
    }
    const bInput = await lastInput(world, b);
    expect(bInput).toBe(secretaryInputText({
      ...baseSample(memory, false),
      round: { since: final.since, input: final.input },
      earlier: [
        // A's first answered round is another Session's round too; the
        // executing round follows with the two inputs it absorbed.
        { round: roundOf(view, built.answered), result: { kind: 'answer', text: `${tag} answer with ideas` } },
        {
          round: roundOf(view, built.executing),
          absorbed: [selection, plain],
          result: { kind: 'answer', text: `${tag} batch answer` },
        },
      ],
    }));
  }, 300_000);

  // Rule: a round of another Session that is still running (or whose result
  // the crash left unknown) is an earlier entry with its material and
  // `(still running or result unknown)`. Built by the crash rule: the old Host
  // is abandoned with the tool call held, the new Host's reconcile reads the
  // round unknown, and the follow-up runs on B.
  it('shows a round still running after the Host crash as still running or unknown', async () => {
    const world = await openWorld({ requestDriver: 'off', secretaryTools: ['read', 'list_files'] });
    const memory = await seeded(world);
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const tag = 's6a-unknown';
    await world.scripted.script(a, [
      { kind: 'calls', calls: [{ callId: `${tag}-list`, name: 'list_files', args: {} }] },
      { kind: 'text', text: secretaryAnswer({ body: `${tag} never sent` }) },
    ]);
    const tool = await world.gates.toolCall(a, 'list_files');
    const submitted = await submitRound(world, newRequest(`${tag}-1`, a, `${tag} question on A`));
    expect(await claimWithSecretaryProfile(world, submitted.round, a, `${tag}-claim`))
      .toMatchObject({ status: 'committed' });
    const preparedBody = (await world.post('queries/prepare', {
      scope: S6A_SCOPE,
      input: {
        queryRunRef: (await readQuery(world.ag2b, submitted.round)).run.ref,
        requestId: `${tag}-prepare`,
      },
    })).body as ReadResult<PreparedQueryExecution>;
    const prepared = ready<PreparedQueryExecution>(preparedBody);
    // The start is not awaited: it is held in the Kernel tool call, and the
    // crash abandons the Host that owns it. The rejection after the crash is
    // expected and is not the row's assertion.
    const started = world.post('queries/start', {
      scope: S6A_SCOPE,
      input: { prepared, consumerId: 'ag2b-consumer', requestId: `${tag}-start` },
    });
    started.catch(() => undefined);
    await tool.reached;
    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    await waitForRound(world, submitted.requestRoot, submitted.round, 'unknown');
    const routed = await world.route({ commandId: `${tag}-route`, round: submitted.requestRoot, to: b });
    expect(routed.status).toBe('routed');
    const onB = await answeredRound(world, {
      session: b,
      answer: secretaryAnswer({ body: `${tag} answer on B` }),
      submit: followUp(`${tag}-2`, submitted.requestRoot, `${tag} after the crash`),
    });
    const view = await world.readRequest(submitted.requestRoot);
    const input = await lastInput(world, b);
    expect(input).toBe(secretaryInputText({
      ...baseSample(memory, false, ['read', 'list_files']),
      round: roundOf(view, onB.round),
      earlier: [{ round: roundOf(view, submitted.round), result: { kind: 'not_ended' } }],
    }));
    // The queued text after the held tool call was never sent: the round never
    // reached a second model request.
    expect(input).not.toContain(`${tag} never sent`);
    // The tool gate stays held; world.close() releases it and the abandoned
    // Host only after this row's assertions.
  }, 300_000);
});
