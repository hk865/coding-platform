/**
 * Group R, row KA-09 (spec §5.2 KA-09; L9, §9 M5): the continuation brief of a
 * same-Session continuation after the platform closed the dangling Kernel Turn.
 *
 * Entry: KE3, the real Host/Workflow drive, read through the public
 * `executions/brief` route. No private assembly helper is imported and no
 * platform record is fabricated: every fact the assertions use comes from a
 * durable platform/Kernel record created by the real flow, and the expected
 * message/steer/tool identities are the ones the public routes returned when
 * they were created. No database read verifies anything.
 */
import { afterEach, expect, it } from 'vitest';
import type { SubmittedControl } from '../../src/contracts/control-intent.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { AG2B_SCOPE, graphWrite, seedAG2bWorkGraph, startAG2bHost, type AG2bHost } from '../helpers/AG2b-collaboration-fixture.js';
import { post, publicDirectory, readExecution, selectWork, tempDir, workRow, writeStaleLock } from '../helpers/A2-restart-fixture.js';
import { cleanupScenarios, type InvariantTarget } from './harness.js';
import { driveChecked, operatorRequeue, readCall, requiredBriefOf, textReply } from './support/common.js';

afterEach(cleanupScenarios);

type Paused = { root: string; database: string; publicDir: string; inv: InvariantTarget; runRef: RunRef; s1: SessionRef;
  acceptedText: string; acceptedMessageId: string; steerId: string };

/**
 * One paused-interrupted Work Run whose Kernel Turn accepted a message and
 * applied a steer before the pause, then the first Host is closed and a stale
 * lock is written, exactly like the A8 restart scenarios.
 */
async function pausedInterruptedWithAcceptedMessage(prefix: string): Promise<Paused> {
  const root = await tempDir(`${prefix}-ws-`);
  const database = await tempDir(`${prefix}-db-`);
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const acceptedText = `${prefix}: a message the interrupted Turn already accepted`;
  const steerText = `${prefix}: a steer the interrupted Turn applied`;
  let first: AG2bHost | undefined;
  let pauseSubmitted: WriteResult<SubmittedControl> | undefined;
  let acceptedMessageId = '';
  let steerId = '';
  first = await startAG2bHost(publicDir, { root, database,
    replies: [readCall(`${prefix}-group1`), readCall(`${prefix}-group2`), textReply(`${prefix}: never reached`)],
    beforeReply: async (_request, index) => {
      if (first === undefined) return;
      const row = await workRow(first);
      if (row.execution === null) throw new Error('the work Task must have a Run while its Turn runs');
      if (index === 0) {
        const session = (await readExecution(first, row.execution)).session;
        const sent = await post<WriteResult<SessionMessage>>(first, 'messages/send', graphWrite(AG2B_SCOPE,
          { recipient: { projectId: session.ref.projectId, sessionId: session.ref.sessionId }, text: acceptedText },
          `${prefix}-accepted`, []));
        expect(sent, 'the accepted message commits while the Turn is open').toMatchObject({ status: 'committed' });
        if (sent.status !== 'committed') throw new Error('the accepted message must commit');
        acceptedMessageId = sent.value.ref.messageId;
        const run = (await readExecution(first, row.execution)).run;
        const steered = await post<WriteResult<SubmittedControl>>(first, 'controls/submit', graphWrite(AG2B_SCOPE,
          { runRef: row.execution, kind: 'steer', reason: steerText }, `${prefix}-steer`, [{ ref: row.execution, revision: run.revision }]));
        expect(steered, 'the steer commits while the Turn is open').toMatchObject({ status: 'committed' });
        if (steered.status !== 'committed') throw new Error('the steer must commit');
        steerId = steered.value.intent.ref.intentId;
      } else if (index === 1) {
        const run = (await readExecution(first, row.execution)).run;
        pauseSubmitted = await post<WriteResult<SubmittedControl>>(first, 'controls/submit', graphWrite(AG2B_SCOPE,
          { runRef: row.execution, kind: 'pause', reason: `${prefix}: pause after the accepted message` },
          `${prefix}-pause`, [{ ref: row.execution, revision: run.revision }]));
      }
    } });
  let runRef: RunRef;
  let s1: SessionRef;
  try {
    await seedAG2bWorkGraph(first);
    const driven = await driveChecked(first, inv, selectWork(`${prefix}-1`));
    expect(driven.last, 'the paused Turn waits at its safe point').toMatchObject({ state: 'waiting', next: null });
    expect(first.scripted.calls(), 'the message and steer were accepted at the second model boundary before the pause').toBe(2);
    if (pauseSubmitted?.status !== 'committed') throw new Error(`pause: ${JSON.stringify(pauseSubmitted)}`);
    const row = await workRow(first);
    if (row.execution === null) throw new Error('the work Task must select its Run');
    runRef = row.execution;
    const paused = await readExecution(first, runRef);
    s1 = { projectId: paused.session.ref.projectId, sessionId: paused.session.ref.sessionId };
    expect(paused.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: runRef.runId } });
  } finally {
    await first.host.close();
  }
  await writeStaleLock(database);
  return { root, database, publicDir, inv, runRef, s1, acceptedText, acceptedMessageId, steerId };
}

/** The person's `继续` (TASK-27) for the paused Run; must commit. */
async function continueRun(host: AG2bHost, runRef: RunRef, requestId: string): Promise<Extract<TaskRequeueOutcomeV1, { kind: 'requeued' }>['requeue']> {
  const continued = await operatorRequeue(host, runRef, requestId, '继续');
  if (continued.status !== 'committed' || continued.value.kind !== 'requeued') {
    throw new Error(`continue: ${JSON.stringify(continued)}`);
  }
  return continued.value.requeue;
}

it('KA-09 (KE3, L9/M5): the continuation brief of the same-Session continuation names the interrupted Turn, lists the accepted message, the applied steer and the tool facts by their known ids, and never carries the assistant transcript', async () => {
  const { root, database, publicDir, inv, runRef, s1, acceptedText, acceptedMessageId, steerId } = await pausedInterruptedWithAcceptedMessage('kr09');
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-09 continued in the same Session')] });
  try {
    await continueRun(second, runRef, 'kr09-continue');
    // The continuation Run binds its brief at `start` (the entry authorization),
    // which runs the Turn to its end; the drive stops right after the
    // continuation Run, before its checks, so the facts read are exactly the
    // continuation's.
    const driven = await driveChecked(second, inv, selectWork('kr09-continue', true), { stopBefore: 'open_checks' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops after the continuation Run').toBe('open_checks');
    const row = await workRow(second);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    const { brief } = await requiredBriefOf(second, row.execution);

    // The continuation is in the original Session without the previous Turn in
    // its model history (L9), and the closed Turn is reported `interrupted` (M5).
    expect(brief.session.continuity).toBe('same_session_without_previous_turn');
    expect(brief.session.sessionRef.sessionId).toBe(s1.sessionId);
    expect(brief.stoppedAt.turnStatus).toBe('interrupted');
    expect(brief.stoppedAt.lastAssistant).toBeNull();
    // The accepted message is listed by the id `messages/send` returned.
    expect(brief.acceptedInputs.messages.map((entry) => entry.messageRef.messageId)).toContain(acceptedMessageId);
    expect(brief.acceptedInputs.messages.map((entry) => entry.excerpt.text)).toContain(acceptedText);
    // The applied steer is listed by the id `controls/submit` returned.
    expect(brief.acceptedInputs.steers.map((entry) => entry.intentRef.intentId)).toContain(steerId);
    // The tool facts of the interrupted Turn name the real read call.
    expect(brief.toolCalls.confirmed.map((call) => call.callId)).toContain('kr09-group1-read');
    // The platform Run recorded no end position (it was interrupted), so the
    // brief's boundary is null and the Kernel identity decided the window.
    expect(brief.session.boundaryPosition).toBeNull();
  } finally {
    await second.host.close();
  }
}, 240_000);

it('KA-09 (KE3, L6/L9): a Host restart between the close and the claim rebuilds the same continuation brief from the Kernel identity', async () => {
  const { root, database, publicDir, inv, runRef, s1, acceptedMessageId } = await pausedInterruptedWithAcceptedMessage('kr09r');
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-09 first continuation')] });
  let third: AG2bHost | undefined;
  try {
    await continueRun(second, runRef, 'kr09r-continue');
    const firstClose = await driveChecked(second, inv, selectWork('kr09r-a', true), { stopBefore: 'claim_task' });
    expect(firstClose.next?.kind === 'perform' ? firstClose.next.operation.kind : null, 'the drive stops before the claim commits').toBe('claim_task');
    await second.host.close();
    third = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-09 after the restart')] });
    const restored = await driveChecked(third, inv, selectWork('kr09r-b', true), { stopBefore: 'start' });
    expect(restored.next?.kind === 'perform' ? restored.next.operation.kind : null, 'the drive stops at the restart re-claim').toBe('start');
    const row = await workRow(third);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    const { brief } = await requiredBriefOf(third, row.execution);
    expect(brief.session.continuity).toBe('same_session_without_previous_turn');
    expect(brief.session.sessionRef.sessionId).toBe(s1.sessionId);
    expect(brief.stoppedAt.turnStatus).toBe('interrupted');
    expect(brief.stoppedAt.lastAssistant).toBeNull();
    expect(brief.acceptedInputs.messages.map((entry) => entry.messageRef.messageId)).toContain(acceptedMessageId);
  } finally {
    if (third !== undefined) await third.host.close();
    else await second.host.close();
  }
}, 300_000);
