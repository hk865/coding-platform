/**
 * P2 T9 (p2-frozen.md:324): an agent asks a copy of a busy line and of an archived
 * line; a line with no Goal can ask a copy. The copy answers and never occupies
 * the original line; the goal-less copy can start.
 *
 * Entry: the frozen row's `ask_copy` by name through the scripted model
 * (seams.md:63-74). The person's `queries/ask` route is NOT the row's entry.
 * Every row really sends the question through the asking round; the Host then
 * consumes the stored question by its message identity, derives the read-only
 * copy and runs the copy's own Query. The source's executions and occupancy are
 * read before and after the ask and must not move. The copy Query's deterministic
 * identity is the message ref, so another Host pass opens no second round.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { consultationQueryRefs } from '../../src/contracts/query-job.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import {
  heartbeat, heartbeatUntil, heartbeatUntilModel, readQueryAnswer, sessionExecutions,
} from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { P2_COORDINATION_TOOL_NAMES, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { messageOf, p1Worlds } from '../helpers/P1-reads.js';
import type { S6AHostWorld, S6AReply } from '../helpers/S6A-host-fixture.js';

const worlds: Array<{ close(): Promise<void> }> = [];
const LONG = 120_000;
const p1s = p1Worlds();
const COPY_ANSWER = 'P2 T9 the copy answered from the frozen facts';
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); await p1s.closeAll(); });

/** The frozen `ask_copy` call the asking round makes by name. */
function askCopy(callId: string, line: SessionRef, question: string): S6AReply {
  return { kind: 'calls', calls: [{ callId, name: 'ask_copy', args: { line, question } }] };
}

/** One refine-gap adviser planning round, held before its reply; its reply is the real `ask_copy` call. */
async function askingRound(opened: Awaited<ReturnType<typeof openPlanOnlyWorld>>, label: string,
  reply: S6AReply = { kind: 'text', text: `P2 T9 ${label} asks no copy` }) {
  const { world, goal, adviser } = opened;
  await startGoalDriver(world, goal, label);
  const snapshot = ready<CollaborationSnapshot>(await driverRead(world, goal), `the ${label} driver read`);
  expect(snapshot.last).toMatchObject({
    status: 'ready',
    value: { state: 'waiting', reason: expect.stringContaining('plan_refine_pending') },
  });
  const gate = await world.gates.modelRequest(adviser);
  await world.scripted.script(adviser, [reply, { kind: 'text', text: `P2 T9 ${label} asked` }]);
  const held = await heartbeatUntilModel(world, gate);
  return { gate, held };
}

/** The one stored copy question the asking line's outbox shows, through `messages/outbox`. */
async function storedCopyQuestion(world: S6AHostWorld, asker: S6ASession): Promise<SessionMessage> {
  const items = await heartbeatUntil(world, () => listed(world, 'outbox', asker),
    entries => entries.some(entry => entry.answeredBy === 'copy'), 24);
  const questions = items.filter(entry => entry.answeredBy === 'copy');
  expect(questions, 'one stored copy question').toHaveLength(1);
  return questions[0]!;
}

/** The stored question answered by the copy's formal Answer, through `messages/read`. */
async function answeredCopy(world: S6AHostWorld, question: SessionMessage): Promise<SessionMessage> {
  const answered = await heartbeatUntil(world, () => messageOf(world, question.ref),
    message => message.response !== null, 32);
  expect(answered).toMatchObject({ answeredBy: 'copy', status: 'responded' });
  return answered;
}

/** The copy Query and its read-only child Session, read by the question's deterministic refs. */
async function copyOf(world: S6AHostWorld, question: SessionMessage) {
  const refs = consultationQueryRefs(question.ref);
  const record = await readQuery(world.ag2b, refs.queryJobRef);
  const derivation = record.job.job.intent.execution.consultation?.derivation;
  expect(derivation, 'the frozen copy derivation').toBeDefined();
  const copy = await world.readSession(derivation!.childSessionRef);
  expect(copy.record.provenance).toMatchObject({ schemaVersion: 1, kind: 'readonly_copy' });
  expect(record.job.job.answerRefs.length, 'the copy answered').toBeGreaterThan(0);
  expect(await readQueryAnswer(world, refs.queryJobRef), 'the copy answer').toBe(COPY_ANSWER);
  return { record, copy };
}

/** The source line's real claims and occupancy, through `sessions/executions` and the session card. */
async function sourceState(world: S6AHostWorld, source: S6ASession) {
  return {
    executions: await sessionExecutions(world, source),
    occupancy: (await world.readSession(source)).record.occupancy,
  };
}

describe('P2 T9: ask a copy of a busy line, an archived line and a goal-less line', () => {
  it('the asking round sends `ask_copy` for an archived source; the copy answers and the archive does not move', async () => {
    const opened = await openPlanOnlyWorld('p2-t9-archived', { tools: P2_COORDINATION_TOOL_NAMES });
    worlds.push(opened);
    const main = s6aCardsWorkspace(opened.world, S6A_SCOPE);
    const source = await sessionOf(opened.world, await createS6BLine(main, {
      label: 'p2-t9-archived-line', role: S6A_WORK_ROLE,
    }));
    const archived = await opened.world.archive(source);
    expect(archived.record.lifecycle).toBe('archived');
    const before = await sourceState(opened.world, source);
    opened.world.scriptReplies([{ kind: 'text', text: COPY_ANSWER }]);

    const { gate, held } = await askingRound(opened, 'p2-t9-archived',
      askCopy('p2-t9-archived-ask', source.ref, 'P2 T9 what does this archived line already know?'));
    gate.release();
    await held.settled;

    const question = await storedCopyQuestion(opened.world, opened.adviser);
    expect(question.answeredBy).toBe('copy');
    await answeredCopy(opened.world, question);
    await copyOf(opened.world, question);
    expect(await sourceState(opened.world, source)).toEqual(before);
    expect((await opened.world.readSession(source)).record.lifecycle).toBe('archived');
  }, LONG);

  it('the asking round sends `ask_copy` for a line with no Goal; the copy Query is goal-less and prepares', async () => {
    const opened = await openPlanOnlyWorld('p2-t9-goal-less', { tools: P2_COORDINATION_TOOL_NAMES });
    worlds.push(opened);
    const main = s6aCardsWorkspace(opened.world, S6A_SCOPE);
    // A bare line: no Task link, so the asked line and its copy Query have no Goal.
    const source = await sessionOf(opened.world, await createS6BLine(main, {
      label: 'p2-t9-goal-less-line', role: S6A_WORK_ROLE,
    }));
    const before = await sourceState(opened.world, source);
    opened.world.scriptReplies([{ kind: 'text', text: COPY_ANSWER }]);

    const { gate, held } = await askingRound(opened, 'p2-t9-goal-less',
      askCopy('p2-t9-goal-less-ask', source.ref, 'P2 T9 what does this goal-less line know?'));
    gate.release();
    await held.settled;

    const question = await storedCopyQuestion(opened.world, opened.adviser);
    await answeredCopy(opened.world, question);
    const { record, copy } = await copyOf(opened.world, question);
    expect(record.job.job.goalId, 'the goal-less copy Query').toBe(null);
    expect(record.job.job.intent.goalId, 'the goal-less copy intent').toBe(null);
    expect(record.run.run.executionState?.prepared, 'the goal-less copy prepares').toBeDefined();
    expect(copy.record.provenance).toMatchObject({ schemaVersion: 1, kind: 'readonly_copy' });
    expect(await sourceState(opened.world, source)).toEqual(before);
  }, LONG);

  it('the asking round sends `ask_copy` for a busy line; the running source is not occupied or claimed', async () => {
    const p1 = await p1s.open({ running: true });
    const before = await sourceState(p1.world, p1.lines.E);
    p1.world.scriptReplies([{ kind: 'text', text: COPY_ANSWER }]);
    // Pre-script the asking reply; `hold` appends its own closing text after it.
    await p1.world.scripted.script(p1.lines.A,
      [askCopy('p2-t9-busy-ask', p1.lines.E.ref, 'P2 T9 what does this busy line already know?')]);
    const held = await p1.hold(p1.lines.A, 'p2-t9-busy');
    await held.end();

    const question = await storedCopyQuestion(p1.world, p1.lines.A);
    await answeredCopy(p1.world, question);
    await copyOf(p1.world, question);
    expect(await sourceState(p1.world, p1.lines.E)).toEqual(before);
  }, LONG);

  it('the no-Goal copy can start: one stored question and one copy round after a replay pass', async () => {
    const opened = await openPlanOnlyWorld('p2-t9-goal-less-start', { tools: P2_COORDINATION_TOOL_NAMES });
    worlds.push(opened);
    const main = s6aCardsWorkspace(opened.world, S6A_SCOPE);
    const source = await sessionOf(opened.world, await createS6BLine(main, {
      label: 'p2-t9-goal-less-start-line', role: S6A_WORK_ROLE,
    }));
    const before = await sourceState(opened.world, source);
    opened.world.scriptReplies([{ kind: 'text', text: COPY_ANSWER }]);
    const ask = askCopy('p2-t9-ask', source.ref, 'P2 T9 what does this line already know?');

    const { gate, held } = await askingRound(opened, 'p2-t9-goal-less-start', ask);
    gate.release();
    await held.settled;

    const question = await storedCopyQuestion(opened.world, opened.adviser);
    await answeredCopy(opened.world, question);
    const { record } = await copyOf(opened.world, question);
    expect(record.job.job.goalId).toBe(null);

    // `ask_copy` has no commandId argument; the stored message ref is the copy
    // Query's deterministic identity. Another Host pass (the reachable replay)
    // opens no second round and sends no second question.
    await heartbeat(opened.world, 60_000);
    await heartbeat(opened.world, 60_000);
    const afterReplay = await listed(opened.world, 'outbox', opened.adviser);
    expect(afterReplay.filter(entry => entry.answeredBy === 'copy'), 'one stored copy question after replay')
      .toHaveLength(1);
    expect((await readQuery(opened.world.ag2b, consultationQueryRefs(question.ref).queryJobRef)).job.ref)
      .toEqual(record.job.ref);
    expect(await sourceState(opened.world, source)).toEqual(before);
  }, LONG);
});
