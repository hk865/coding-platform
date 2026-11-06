/**
 * UI1 person-ask: the person's `queries/ask` (brief §1.2/§2/§5; lead ruling 9 for
 * the goal-less line). One inquiry is sent as the person, a read-only copy is
 * derived and its deterministic Query is queued; the source line is never
 * reopened, occupied or given a Work Run.
 *
 * Rows (brief §5 and the ruling):
 * - an archived line answers and stays archived (row 3);
 * - a retired line answers and stays retired (row 3, SQLite only: the line is
 *   retired by the real A8 crash path);
 * - an active line answers with a `readonly_copy` and writes nothing on the
 *   source (row 9);
 * - a line with no Goal answers (ruling 9);
 * - the same `commandId` replays one round and sends one inquiry (row 4);
 * - the same `commandId` with another question is `idempotency_conflict` and
 *   changes nothing (row 5);
 * - two different `commandId`s queue two different rounds and leave the source
 *   alone (row 7);
 * - rejects: a non-person caller, a line of another workspace (row 6), and the
 *   three input rules of brief §1.2. Each leaves the line's inbox as it was.
 *
 * Every state is made through public steps: the frozen request/planning worlds,
 * `sessions/create`/`sessions/archive-line`, the real `queries/ask` route, and
 * public reads (`lines/archived`, `lines/read`, `sessions/facts`,
 * `sessions/executions`, `messages/inbox`, `messages/read`, `queries/read`).
 * No store, record or call context is built here. Expected literals are the
 * brief's strings or hand-computed from the frozen fixtures.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ArchivedLinePageV1, LineRowV1, WorkLineDetailV1 } from '../../src/contracts/work-line.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { asRecord } from '../helpers/S6A-memory-fixture.js';
import {
  openS6ATwoWorkspaceWorld, S6A_SCOPE, S6A_SECOND_SCOPE, S6A_WORK_ROLE,
  type S6ARequestWorld, type S6ASecondWorkspace, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { openS7BDamagedWorld } from '../helpers/S7B3-damaged-world.js';
import { openS7BPlanningWorld, type S7BPlanningWorld } from '../helpers/S7B3-planning-world.js';

type Answer = Record<string, unknown>;
type AnswerBody = { body: unknown };

const worlds: Array<S6AHostWorld | S6ARequestWorld> = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

async function planningWorld(): Promise<S7BPlanningWorld> {
  const opened = await openS7BPlanningWorld({ backend: 'memory' });
  worlds.push(opened.world);
  return opened;
}

/** The line of goal 1 that is responsible for the adopted plan's work task. */
async function goalLine(world: S6ARequestWorld, goal: GoalRef, label: string): Promise<S6ASession> {
  const task: TaskTriple = { projectId: S6A_SCOPE.projectId, goalId: goal.goalId, taskId: AG2B_WORK_TASK_ID };
  const line = await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), {
    label, role: S6A_WORK_ROLE, tasks: [task],
  });
  return sessionOf(world, line);
}

/** The real route as the Host's human actor; the body is the plain `{scope, input}` the client sends. */
async function ask(world: S6ARequestWorld, line: S6ASession, question: string, commandId: string): Promise<Answer> {
  const answer = await world.post('queries/ask', plain(S6A_SCOPE, {
    sessionRef: line.ref, question, commandId,
  }));
  return asRecord((answer as AnswerBody).body);
}

function queued(body: Answer): QueryJobRef {
  expect(body['status']).toBe('queued');
  const round = body['round'];
  if (typeof round !== 'object' || round === null) throw new Error(`no round in ${JSON.stringify(body)}`);
  return round as QueryJobRef;
}

async function executions(world: S6ARequestWorld, line: S6ASession): Promise<unknown[]> {
  return ready<{ items: unknown[] }>(await world.post('sessions/executions',
    plain(S6A_SCOPE, { sessionRef: line.ref, page: { limit: 100 } })), 'sessions/executions').items;
}

async function factsOf(world: S6ARequestWorld, line: S6ASession): Promise<SessionFactsV1> {
  return ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, line.ref)), 'sessions/facts');
}

async function readLineRow(world: S6ARequestWorld, line: S6ASession): Promise<LineRowV1> {
  const detail = ready<WorkLineDetailV1 | { kind: 'branched'; heads: SessionRef[] }>(
    await world.post('lines/read', plain(S6A_SCOPE, { workspace: S6A_SCOPE, key: line.ref })), 'lines/read');
  if (detail.kind !== 'line') throw new Error(`lines/read answered ${detail.kind}`);
  return detail.row;
}

async function archivedRow(world: S6ARequestWorld, line: S6ASession): Promise<LineRowV1 | undefined> {
  const page = ready<ArchivedLinePageV1>(await world.post('lines/archived',
    plain(S6A_SCOPE, { workspace: S6A_SCOPE, page: { limit: 100 } })), 'lines/archived');
  return page.rows.find(row => row.key.sessionId === line.ref.sessionId);
}

/** The copy the round's own frozen message names, read through `messages/read` and `sessions/read`. */
async function copyOf(world: S6AHostWorld, round: QueryJobRef):
Promise<{ copy: SessionCard; message: SessionMessage }> {
  const record = await readQuery(world.ag2b, round);
  const consultation = record.job.job.intent.execution.consultation;
  if (consultation === undefined) throw new Error(`the round ${round.queryJobId} is not a consultation`);
  const message = await readS7BMessage(world, consultation.messageRef);
  const child = message.consultationDerivation?.childSessionRef;
  if (child === undefined) throw new Error(`the inquiry ${message.ref.messageId} recorded no copy`);
  return { copy: await world.readSession(child), message };
}

async function secondInbox(world: S6ARequestWorld, second: S6ASecondWorkspace,
  line: S6ASession): Promise<SessionMessage[]> {
  return ready<{ items: SessionMessage[] }>(await world.dispatch('messages/inbox', second.humanContext(),
    plain(S6A_SECOND_SCOPE, { recipient: line.ref, page: { limit: 20 } })), 'the second inbox').items;
}

describe('queries/ask', () => {
  it('an archived line answers with a readonly copy and stays archived', async () => {
    // Mutation: line-ask's `consumeConsultation` call is replaced with
    // `handleIntervention`; the round and the archived tag both leave this row.
    const opened = await planningWorld();
    const line = opened.sessionRef;
    const card = await opened.world.archive(line);
    expect(card.record.lifecycle).toBe('archived');
    const runsBefore = await executions(opened.world, line);

    const round = queued(await ask(opened.world, line, 'what did this line learn?', 'la-archived-ask'));

    const archived = await archivedRow(opened.world, line);
    expect(archived?.status.archivedTag).toBe('plain');
    expect(archived?.status.readOnly).toBe(true);
    expect(await executions(opened.world, line)).toEqual(runsBefore);
    expect((await readQuery(opened.world.ag2b, round)).job.ref.queryJobId).toBe(round.queryJobId);
    const { copy } = await copyOf(opened.world, round);
    expect(copy.record.provenance).toMatchObject({ schemaVersion: 1, kind: 'readonly_copy' });
  });

  it('a retired line answers with a readonly copy and stays retired (SQLite only)', async () => {
    // Mutation: line-ask's `consumeConsultation` call is replaced with
    // `handleIntervention`; the round and the retired tag both leave this row.
    // SQLite only: `makeUnavailableSecretary` retires the line through a real Host restart.
    const opened = await openS7BDamagedWorld({ defect: 'retired' });
    worlds.push(opened.world);
    const line = opened.source;
    const card = await opened.world.archive(line);
    expect(card.record.lifecycle).toBe('archived');
    const runsBefore = await executions(opened.world, line);

    const round = queued(await ask(opened.world, line, 'what is still known here?', 'la-retired-ask'));

    const archived = await archivedRow(opened.world, line);
    expect(archived?.status.archivedTag).toBe('retired');
    expect(archived?.status.readOnly).toBe(true);
    expect(await executions(opened.world, line)).toEqual(runsBefore);
    expect((await readQuery(opened.world.ag2b, round)).job.ref.queryJobId).toBe(round.queryJobId);
    const { copy } = await copyOf(opened.world, round);
    expect(copy.record.provenance).toMatchObject({ schemaVersion: 1, kind: 'readonly_copy' });
  });

  it('an active line answers with a readonly copy and writes nothing on the source', async () => {
    // Mutation: the copy is replaced by claiming the Query on the source Session
    // (consultation's `createSession` call); the source occupancy then moves.
    const opened = await planningWorld();
    const line = await goalLine(opened.world, opened.goalRef, 'la-active');
    const before = await factsOf(opened.world, line);
    const runsBefore = await executions(opened.world, line);

    const round = queued(await ask(opened.world, line, 'what does this line know?', 'la-active-ask'));

    const after = await factsOf(opened.world, line);
    expect(after.session.lifecycle).toBe(before.session.lifecycle);
    expect(after.session.occupancy).toEqual(before.session.occupancy);
    expect(after.latestWork).toEqual(before.latestWork);
    expect(await executions(opened.world, line)).toEqual(runsBefore);
    expect((await readLineRow(opened.world, line)).status.readOnly).toBe(false);
    const { copy } = await copyOf(opened.world, round);
    expect(copy.record.provenance).toMatchObject({ schemaVersion: 1, kind: 'readonly_copy' });
  });

  it('an execution line with only a secretary profile starts its copy with the line Role', async () => {
    // Mutation: Host's fallback uses the first profile's `roleBinding`; the copy's
    // Query then cannot claim (legacy role mismatch) and has no prepared state.
    const opened = await planningWorld();
    // The world's configured profiles are secretary first, so the first-profile
    // budget fallback really is the secretary, not the line's own Role.
    expect(opened.world.profiles[0]?.kind).toBe('secretary');
    const line = await goalLine(opened.world, opened.goalRef, 'la-profile-fallback');

    const round = queued(await ask(opened.world, line, 'what does the execution line know?', 'la-profile-fallback-ask'));

    const { copy } = await copyOf(opened.world, round);
    expect(copy.record.role).toEqual(line.role);
    const record = await readQuery(opened.world.ag2b, round);
    expect(record.run.run.executionState?.prepared).toBeDefined();
  });

  it('a line with no Goal can ask (goal-less inquiry)', async () => {
    // Mutation: line-ask's `goal === null` branch answers `unsupported` again
    // (ruling 9's goal-less exception removed); this row then has no round.
    const opened = await planningWorld();
    const line = opened.noPlanSessionRef;

    const round = queued(await ask(opened.world, line, 'what is this line doing?', 'la-goalless-ask'));

    const record = await readQuery(opened.world.ag2b, round);
    expect(record.job.job.goalId).toBeNull();
    expect(record.job.job.intent.goalId).toBeNull();
    const { copy } = await copyOf(opened.world, round);
    expect(copy.record.provenance).toMatchObject({ schemaVersion: 1, kind: 'readonly_copy' });
  });

  it('the same commandId replays one round and sends one inquiry', async () => {
    // Mutation: line-ask's `meta.requestId` loses `queries-ask:${commandId}`
    // (a random id); the second ask sends a second inquiry and a second round.
    const opened = await planningWorld();
    const line = await goalLine(opened.world, opened.goalRef, 'la-replay');

    const first = queued(await ask(opened.world, line, 'why this line?', 'la-replay-command'));
    expect(await inboxOf(opened.world, line.ref)).toHaveLength(1);
    const second = queued(await ask(opened.world, line, 'why this line?', 'la-replay-command'));

    expect(second.queryJobId).toBe(first.queryJobId);
    expect(await inboxOf(opened.world, line.ref)).toHaveLength(1);
  });

  it('the same commandId with another question is idempotency_conflict and changes nothing', async () => {
    // Mutation: mailbox-send's receipt lookup (the `lookupCommit` before the
    // admission) is removed; the second send no longer reports the conflict.
    const opened = await planningWorld();
    const line = await goalLine(opened.world, opened.goalRef, 'la-conflict');

    const first = queued(await ask(opened.world, line, 'the first question', 'la-conflict-command'));
    const before = await inboxOf(opened.world, line.ref);

    const refused = await ask(opened.world, line, 'a different question', 'la-conflict-command');

    expect(refused).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await inboxOf(opened.world, line.ref)).toEqual(before);
    expect((await readQuery(opened.world.ag2b, first)).job.job.intent.question).toBe('the first question');
  });

  it('two different commandIds queue two rounds and leave the source alone', async () => {
    // Mutation: the Query identity is hashed from the source Session instead of
    // the message (`consultationQueryRefs`); both rounds then name one QueryJob.
    const opened = await planningWorld();
    const line = await goalLine(opened.world, opened.goalRef, 'la-concurrent');
    const before = await factsOf(opened.world, line);

    const [left, right] = await Promise.all([
      ask(opened.world, line, 'the first of two', 'la-concurrent-a'),
      ask(opened.world, line, 'the second of two', 'la-concurrent-b'),
    ]);
    const first = queued(left);
    const second = queued(right);

    expect(first.queryJobId).not.toBe(second.queryJobId);
    expect(await inboxOf(opened.world, line.ref)).toHaveLength(2);
    const after = await factsOf(opened.world, line);
    expect(after.session.lifecycle).toBe(before.session.lifecycle);
    expect(after.session.occupancy).toEqual(before.session.occupancy);
    expect(await executions(opened.world, line)).toEqual([]);
  });

  const INVALID_INPUT = [
    { name: 'a missing commandId', question: 'why this line?', commandId: '',
      reason: 'the command requires a commandId' },
    { name: 'an empty question', question: '', commandId: 'la-invalid-empty',
      reason: 'question must be non-empty' },
    { name: 'a question over 16 KiB of UTF-8', question: 'x'.repeat(16 * 1024 + 1),
      commandId: 'la-invalid-long', reason: 'question must be at most 16 KiB of UTF-8' },
  ] as const;

  describe('rejects: queries/ask', () => {
    it.each(INVALID_INPUT)('rejects $name', async ({ question, commandId, reason }) => {
      // Mutation: the matching line-ask guard is removed (`nonEmpty(input.commandId)`
      // or the `queryTextProblem` call); the route then queues the inquiry.
      const opened = await planningWorld();
      const line = await goalLine(opened.world, opened.goalRef, `la-invalid-${commandId || 'missing'}`);
      const refused = await ask(opened.world, line, question, commandId);
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid', reason });
      expect(await inboxOf(opened.world, line.ref)).toHaveLength(0);
    });

    it('rejects a null input as invalid instead of failing the request', async () => {
      // Mutation: Host reads `input.sessionRef` before validating the public
      // input; the null reaches the Session read and the HTTP answer is 500.
      const opened = await planningWorld();
      const answer = await opened.world.post('queries/ask', plain(S6A_SCOPE, null));
      expect(answer.httpStatus).toBe(200);
      expect(asRecord(answer.body)).toMatchObject({ status: 'rejected', code: 'invalid' });
    });

    it('rejects a sessionRef of another project as forbidden before reading it', async () => {
      // Mutation: the project comparison moves after the Session read; the scoped
      // reader hides the foreign line as not_found.
      const opened = await planningWorld();
      const answer = asRecord((await opened.world.post('queries/ask', plain(S6A_SCOPE, {
        sessionRef: { projectId: 'la-other-project', sessionId: 'la-other-session' },
        question: 'another project?', commandId: 'la-cross-project',
      }))).body);
      expect(answer).toMatchObject({ status: 'rejected', code: 'forbidden',
        reason: 'the recipient Session belongs to another project' });
    });

    it('rejects a caller that is not the person, at the route', async () => {
      // Mutation: core-routes binds `queries/ask` without `personEntry`; a system
      // caller then reaches the send instead of the route's forbidden answer.
      const opened = await planningWorld();
      const line = await goalLine(opened.world, opened.goalRef, 'la-system');
      const refused = asRecord(await opened.world.dispatch('queries/ask', opened.world.systemContext(),
        plain(S6A_SCOPE, { sessionRef: line.ref, question: 'system question', commandId: 'la-system-command' })));
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden',
        reason: 'only the person may call this route' });
      expect(await inboxOf(opened.world, line.ref)).toHaveLength(0);
    });

    it('rejects a line of another workspace', async () => {
      // Mutation: the Session read's same-workspace compare
      // (`session-directory.ts`, the `session.workspaceId !== scope.workspaceId`
      // branch) is removed; the line becomes readable and the answer changes.
      const { world, second } = await openS6ATwoWorkspaceWorld({ backend: 'memory' });
      worlds.push(world);
      const line = await second.createSecretary('la-second-workspace');
      const before = await secondInbox(world, second, line);
      const answer = await world.post('queries/ask', plain(S6A_SCOPE, {
        sessionRef: line.ref, question: 'another workspace?', commandId: 'la-cross-workspace',
      }));
      expect(asRecord(answer.body)).toMatchObject({ status: 'rejected', code: 'not_found',
        reason: 'the requested record does not exist' });
      expect(await secondInbox(world, second, line)).toEqual(before);
    });
  });
});
