/**
 * AG2b Stage-1 continuous-communication contract tests.
 *
 * The frozen shape (docs/refactor/tasks/AG2b-continuous-communication-2026-09-28.md):
 *   - A's original Work Run sends `send_session_message(replyMode='wait')` and
 *     waits; the Host drives B's original Session through the AG2a consumer;
 *     the saved answer returns to A's SAME Run as the original tool result;
 *   - a busy B makes A wait with NO replacement Session; when the real occupying
 *     Query is released the driver auto-consults B, then the loop repeats, A
 *     really writes the isolated project, the registered check runs and the
 *     Task/Goal complete;
 *   - a real human stop releases the wait, the original Run is confirmed
 *     ended/cancelled through `executions/read`, and the next step is not
 *     advanced;
 *   - a reopened Host only reads the original messages/Query/history and another
 *     scope can never read/stop this driver.
 *
 * Production publishes no driver route and no wait branch yet, so every
 * scenario's FIRST red is the REAL HTTP boundary (404 unpublished route
 * `workflow/driver-start` / `workflow/driver-read`), never a missing import or
 * a wrong Host fixture. Everything after that first assertion is the frozen
 * final expectation for Stage 2.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessage, SessionRef, TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import {
  AG2B_GOAL_REF,
  AG2B_QUERY_PROFILE_ID,
  AG2B_QUERY_ROLE,
  AG2B_RESULT_FILE,
  AG2B_RESULT_TEXT,
  AG2B_SCOPE,
  AG2B_WORK_TASK_ID,
  claimBusyQuery,
  cleanupAG2b,
  corePost,
  createAG2bSession,
  listSessions,
  plain,
  readBootstrap,
  seedAG2bWorkGraph,
  sendPlainNotify,
  sessionCount,
  startAG2bHost,
  startBusyQuery,
  type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';

const projectDir = resolve(fileURLToPath(new URL('../../', import.meta.url)));
let publicDir = '';

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'ag2b-collab-public-'));
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: projectDir, encoding: 'utf8', env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  if (build.status !== 0) throw new Error(`workbench build failed: ${build.stdout}\n${build.stderr}`);
}, 60_000);

afterAll(async () => {
  await cleanupAG2b();
  await rm(publicDir, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// Small provider/tool assertions reused by the scenarios.
// --------------------------------------------------------------------------

/** The frozen `send_session_message(replyMode='wait')` tool result. */
type WaitToolResult = { message: SessionMessage; response: { text: string } | null };

function toolMessage(request: ModelRequest, callId: string) {
  return request.messages.find(message => message.role === 'tool' && message.callId === callId);
}
function toolJson(request: ModelRequest, callId: string): unknown {
  const message = toolMessage(request, callId);
  if (message === undefined || message.role !== 'tool' || message.result.status !== 'success') return undefined;
  const block = message.result.output.find(candidate => candidate.kind === 'json');
  return block?.kind === 'json' ? block.value : undefined;
}
function callArgs(reply: ScriptedReply | undefined): Record<string, unknown> | undefined {
  return reply !== undefined && reply.kind === 'calls' ? reply.calls[0]?.args : undefined;
}
/** Locate the ORIGINAL wait tool result by its Kernel callId, never by a whole
 * transcript string search. */
function waitResult(request: ModelRequest, callId: string): WaitToolResult | undefined {
  return toolJson(request, callId) as WaitToolResult | undefined;
}

async function readDriver(host: AG2bHost): Promise<ReadResult<CollaborationSnapshot>> {
  const response = await corePost(host.base, 'workflow/driver-read', host.token, plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  return await response.json() as ReadResult<CollaborationSnapshot>;
}

async function waitForDriver(
  host: AG2bHost, predicate: (snapshot: CollaborationSnapshot) => boolean, timeoutMs = 30_000,
): Promise<CollaborationSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last: ReadResult<CollaborationSnapshot> | undefined;
  while (Date.now() < deadline) {
    const response = await corePost(host.base, 'workflow/driver-read', host.token, plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
    if (response.status === 200) {
      last = await response.json() as ReadResult<CollaborationSnapshot>;
      if (last.status === 'ready' && predicate(last.value)) return last.value;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error(`the collaboration driver did not reach the expected state: ${JSON.stringify(last)}`);
}

async function inboxOf(host: AG2bHost, recipient: SessionRef): Promise<SessionMessage[]> {
  const response = await corePost(host.base, 'messages/inbox', host.token,
    plain(AG2B_SCOPE, { recipient, page: { limit: 20 } }));
  const body = await response.json() as ReadResult<{ items: SessionMessage[] }>;
  if (body.status !== 'ready') throw new Error(`the real inbox was not ready: ${JSON.stringify(body)}`);
  return body.value.items;
}

async function readExecution(host: AG2bHost, runRef: RunRef): Promise<ReadResult<TaskExecutionRecord>> {
  const response = await corePost(host.base, 'executions/read', host.token, plain(AG2B_SCOPE, runRef));
  expect(response.status).toBe(200);
  return await response.json() as ReadResult<TaskExecutionRecord>;
}

const startBody = {
  advance: { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: 'ag2b-flow', sessionHint: null, kind: 'select_work' },
  queryProfileIds: [AG2B_QUERY_PROFILE_ID],
};

const isQueryRole = (card: { record: { role: unknown } }): boolean =>
  JSON.stringify(card.record.role) === JSON.stringify(AG2B_QUERY_ROLE);

describe('AG2b continuous communication over the real Host HTTP', () => {
  // ------------------------------------------------------------------
  // 1. The normal loop: B is first occupied by a real Query, A waits with no
  //    consultation, B is released and auto-consulted, two wait rounds run,
  //    A writes the isolated project and the formal Task/Goal complete.
  // ------------------------------------------------------------------
  it('releases a busy B, runs two wait rounds and completes the real Task/Goal', async () => {
    const busyQuestion = 'AG2b busy release query one';
    const busyReleaseAnswer = 'AG2b busy query release answer';
    const firstQuestion = 'AG2b round one: who owns the isolated module?';
    const firstAnswer = 'AG2b round-one saved companion answer';
    const secondQuestion = 'AG2b round two: confirm the follow-up fact';
    const secondAnswer = 'AG2b round-two saved companion answer';
    let workTarget: WorkLinkTarget | undefined;
    let bSession: SessionRef | undefined;
    let round1Run: RunRef | undefined;
    let round1Session: SessionRef | undefined;
    let round2Run: RunRef | undefined;
    let round2Session: SessionRef | undefined;
    const replies: ScriptedReply[] = [
      { kind: 'calls', calls: [{ callId: 'ag2b-find', name: 'find_related_sessions', args: { target: {}, page: { limit: 10 } } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-card', name: 'read_session_card', args: { sessionRef: {} } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-send-1', name: 'send_session_message',
        args: { recipient: {}, text: firstQuestion, replyMode: 'wait' } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-send-2', name: 'send_session_message',
        args: { recipient: {}, text: secondQuestion, replyMode: 'wait' } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-edit', name: 'edit',
        args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
      { kind: 'text', text: 'AG2b work complete' },
    ];
    const queryReplies: ScriptedReply[] = [
      { kind: 'text', text: firstAnswer },
      { kind: 'text', text: secondAnswer },
      { kind: 'text', text: busyReleaseAnswer },
    ];
    const started = await startAG2bHost(publicDir, {
      replies,
      queryReplies,
      beforeReply: async (request, index) => {
        if (index === 0) {
          const args = callArgs(replies[0]);
          if (args !== undefined && workTarget !== undefined) args['target'] = structuredClone(workTarget);
        }
        if (index === 1) {
          const found = toolJson(request, 'ag2b-find') as
            { status?: string; value?: { items?: Array<{ record: { ref: SessionRef }; availability: string }> } } | undefined;
          expect(found, 'find_related_sessions must return the real directory page').toMatchObject({ status: 'ready' });
          const items = found?.value?.items ?? [];
          const selected = items.find(item => item.record.ref.sessionId === bSession?.sessionId) ?? items[0];
          expect(selected, 'the formal work link must expose B even while busy').toBeDefined();
          const args = callArgs(replies[1]);
          if (args !== undefined && selected !== undefined) {
            args['sessionRef'] = { projectId: selected.record.ref.projectId, sessionId: selected.record.ref.sessionId };
          }
        }
        if (index === 2) {
          const card = toolJson(request, 'ag2b-card') as
            { status?: string; value?: { record?: { ref?: SessionRef } } } | undefined;
          expect(card, 'read_session_card must return the selected Session').toMatchObject({ status: 'ready' });
          const ref = card?.value?.record?.ref;
          expect(ref).toBeDefined();
          const args = callArgs(replies[2]);
          if (args !== undefined && ref !== undefined) args['recipient'] = { projectId: ref.projectId, sessionId: ref.sessionId };
        }
        if (index === 3) {
          expect(JSON.stringify(request.messages), 'the first reply must be the consumed continuation input').toContain(firstAnswer);
          const result = waitResult(request, 'ag2b-send-1');
          expect(result?.response, 'the yielded tool result must not hold a reply').toBeNull();
          const sender = result?.message.sender;
          expect(sender).toMatchObject({ kind: 'work_run' });
          if (sender?.kind === 'work_run') { round1Run = sender.runRef; round1Session = sender.sessionRef; }
          const args = callArgs(replies[3]);
          if (args !== undefined && bSession !== undefined) args['recipient'] = { projectId: bSession.projectId, sessionId: bSession.sessionId };
        }
        if (index === 4) {
          expect(JSON.stringify(request.messages), 'the second reply must be the consumed continuation input').toContain(secondAnswer);
          const result = waitResult(request, 'ag2b-send-2');
          expect(result?.response, 'the yielded tool result must not hold a reply').toBeNull();
          const sender = result?.message.sender;
          if (sender?.kind === 'work_run') { round2Run = sender.runRef; round2Session = sender.sessionRef; }
        }
        if (index === 5) {
          expect(JSON.stringify(request.messages)).toContain(firstAnswer);
          expect(JSON.stringify(request.messages)).toContain(secondAnswer);
        }
      },
      queryBeforeReply: async (request, index, signal) => {
        // Independent Query executions may interleave; route by the current
        // formal question, never by a global model-call position.
        const current = [...request.messages].reverse().find(message => message.role === 'user');
        const text = current?.role === 'user' ? current.content : '';
        const matches = [[firstQuestion, firstAnswer], [secondQuestion, secondAnswer], [busyQuestion, busyReleaseAnswer]]
          .filter(([question]) => text.includes(question!));
        expect(matches, 'one actual formal Query question selects the controlled answer').toHaveLength(1);
        queryReplies[index] = { kind: 'text', text: matches[0]![1]! };
        if (!text.includes(busyQuestion)) {
          // The sender may yield while this real Query provider is in flight.
          // Sender completion must drain it, not cancel the independent answer.
          await new Promise(resolve => setTimeout(resolve, 150));
          signal.throwIfAborted();
        }

      },
    });
    try {
      // The public bootstrap is the real safe projection of the trusted profile.
      const bootstrap = await readBootstrap(started);
      expect(bootstrap.execution.queryProfiles.map(profile => profile.id)).toEqual([AG2B_QUERY_PROFILE_ID]);
      expect(JSON.stringify(bootstrap)).not.toContain('ag2b-controlled-secret-value');

      const seeded = await seedAG2bWorkGraph(started);
      workTarget = seeded.workTarget;
      const createdB = await createAG2bSession(started, 'ag2b-b-session', AG2B_QUERY_ROLE, [
        { target: workTarget, relation: 'participates' },
      ]);
      bSession = createdB.sessionRef;
      // B is FIRST occupied by a real formal Query claim; the wait must not
      // consult B until that occupancy is really released.
      const busy = await claimBusyQuery(started, createdB, 'normal');
      // Receiving a plain notification is durable mail and never wakes B.
      const notify = await sendPlainNotify(started, bSession, 'AG2b ordinary notification', 'ag2b-notify');
      expect(notify).toMatchObject({ status: 'committed', value: { status: 'pending' } });
      expect(started.scripted.calls()).toBe(0);

      const sessionsBefore = await sessionCount(started);
      const startResponse = await corePost(started.base, 'workflow/driver-start', started.token, plain(AG2B_SCOPE, startBody));
      // FIRST RED (Stage 1): the route is not published, so the real HTTP
      // boundary answers 404 `unpublished core route workflow/driver-start`.
      expect(startResponse.status).toBe(200);
      const startResult = await startResponse.json() as ReadResult<CollaborationSnapshot>;
      expect(startResult.status).toBe('ready');
      if (startResult.status !== 'ready') throw new Error(`driver start was not ready: ${JSON.stringify(startResult)}`);
      const flowId = startResult.value.flowId;

      // A's first wait must confirm that busy B got NO consultation call.
      const waiting = await waitForDriver(started, snapshot => snapshot.state === 'waiting_for_reply');
      expect(waiting.state).toBe('waiting_for_reply');
      expect(started.scripted.calls(), 'A find/card/send only; B is never called while busy').toBe(3);
      expect(await sessionCount(started), 'the Workflow created the A Session plus its derived child A′').toBe(sessionsBefore + 2);
      const cardsWhileBusy = await listSessions(started);
      const querySessionsWhileBusy = cardsWhileBusy.filter(isQueryRole);
      // B stays the occupied SOURCE; the consultation runs in its own derived child.
      expect(querySessionsWhileBusy, 'B plus its isolated child A′').toHaveLength(2);
      expect(querySessionsWhileBusy.some(card => card.record.ref.sessionId === createdB.sessionRef.sessionId)).toBe(true);
      expect(querySessionsWhileBusy.some(card => card.record.ref.sessionId !== createdB.sessionRef.sessionId)).toBe(true);

      // Release the real occupancy through the existing Query prepare/start.
      await startBusyQuery(started, busy, 'normal');

      // The driver auto-consults B and the two wait rounds run to completion.
      const completedSnapshot = await waitForDriver(started, snapshot => snapshot.state === 'completed' || snapshot.state === 'failed');
      expect(completedSnapshot, JSON.stringify(completedSnapshot)).toMatchObject({ state: 'completed', reason: 'the Goal was formally completed' });
      // Repeating start/read adds no model call and reuses the one handle.
      const replayStart = await corePost(started.base, 'workflow/driver-start', started.token, plain(AG2B_SCOPE, startBody));
      expect(replayStart.status).toBe(200);
      expect(await replayStart.json()).toMatchObject({ status: 'ready', value: { flowId } });
      const callsAtCompletion = started.scripted.calls();
      expect(await sessionCount(started), 'each wait message derives its own child A′').toBe(sessionsBefore + 3);
      const readAgain = await readDriver(started);
      expect(readAgain).toMatchObject({ status: 'ready', value: { state: 'completed', flowId } });
      expect(started.scripted.calls(), 'replay/read must add no model call').toBe(callsAtCompletion);

      // Each wait round is its OWN formally yielded Run in the SAME original A
      // Session; the continuation is a new Run, never a reopened terminal.
      expect(round1Run, 'the first round must carry the original A Run').toBeDefined();
      expect(round1Session).toBeDefined();
      expect(round2Run).toBeDefined();
      expect(round2Run).not.toEqual(round1Run);
      expect(round2Session).toEqual(round1Session);
      for (const [label, runRef] of [['first', round1Run], ['second', round2Run]] as const) {
        if (runRef === undefined) continue;
        const execution = await readExecution(started, runRef);
        expect(execution, `the ${label} wait Run must be real and formally yielded`).toMatchObject({
          status: 'ready',
          value: { run: { ref: runRef, status: 'ended', outcome: 'yielded' } },
        });
      }

      // B's original Session holds the two real saved replies and the untouched
      // ordinary notification; the reply sender is the derived Query Answer.
      const inbox = await inboxOf(started, bSession);
      const responded = inbox.filter(message => message.status === 'responded');
      expect(responded).toHaveLength(2);
      for (const message of responded) {
        // A′ answers from its own derived child Session, not from the busy source.
        expect(message.response).toMatchObject({ sender: { kind: 'query_run' } });
        const responseSender = (message.response as { sender: { sessionRef: SessionRef } }).sender;
        expect(responseSender.sessionRef.projectId).toBe(bSession.projectId);
        expect(responseSender.sessionRef.sessionId).not.toBe(bSession.sessionId);
        const responseBody = await corePost(started.base, 'messages/body', started.token,
          plain(AG2B_SCOPE, { messageRef: message.ref, part: 'response' }));
        const body = await responseBody.json() as ReadResult<{ text: string; part: string }>;
        expect(body).toMatchObject({ status: 'ready', value: { part: 'response' } });
        if (body.status === 'ready') expect([firstAnswer, secondAnswer]).toContain(body.value.text);
      }
      // The ordinary notification is still pending and was never auto-consumed.
      expect(inbox.some(message => message.status === 'pending')).toBe(true);

      // A really wrote the isolated project. The required registered read-only
      // check asserts these exact bytes before formal completion can succeed.
      expect(await readFile(join(started.root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);

      // The formal Task/Goal facts record the completion.
      const graph = await corePost(started.base, 'tasks/query', started.token, plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
      const graphBody = await graph.json() as ReadResult<{ completion: unknown; tasks: unknown[] }>;
      expect(graphBody).toMatchObject({ status: 'ready', value: {
        completion: { status: 'recorded', snapshot: { phase: 'COMPLETED' }, selectedPlanMatches: true },
        tasks: expect.arrayContaining([
          expect.objectContaining({ ref: expect.objectContaining({ taskId: AG2B_WORK_TASK_ID }), effectivePhase: 'satisfied' }),
        ]),
      } });

      // The frozen outbox read is the per-sender-Run UI history route.
      const waitSender = completedSnapshot.messages
        .map(message => message.sender)
        .find(sender => sender.kind === 'work_run');
      expect(waitSender, 'the snapshot must project the original work-run wait message').toBeDefined();
      if (waitSender !== undefined && waitSender.kind === 'work_run') {
        const outboxResponse = await corePost(started.base, 'messages/outbox', started.token,
          plain(AG2B_SCOPE, { senderRun: waitSender.runRef, page: { limit: 50 } }));
        expect(outboxResponse.status).toBe(200);
        const outbox = await outboxResponse.json() as ReadResult<{ items: SessionMessage[] }>;
        expect(outbox).toMatchObject({ status: 'ready', value: {
          items: expect.arrayContaining([expect.objectContaining({ status: 'responded' })]),
        } });
      }
    } finally {
      await started.host.close();
    }
  });

  // ------------------------------------------------------------------
  // 2. A busy B keeps A waiting with no replacement Session; a real human
  //    stop releases the wait, the original Run is confirmed cancelled.
  // ------------------------------------------------------------------
  it('waits while B is busy, creates no replacement Session and confirms the stop through the real Run', async () => {
    const question = 'AG2b busy-recipient wait question';
    let bSession: SessionRef | undefined;
    let workTarget: WorkLinkTarget | undefined;
    const replies: ScriptedReply[] = [
      { kind: 'calls', calls: [{ callId: 'ag2b-busy-find', name: 'find_related_sessions', args: { target: {}, page: { limit: 10 } } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-busy-card', name: 'read_session_card', args: { sessionRef: {} } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-busy-send', name: 'send_session_message',
        args: { recipient: {}, text: question, replyMode: 'wait' } }] },
    ];
    const started = await startAG2bHost(publicDir, {
      replies,
      beforeReply: async (request, index) => {
        if (index === 0) {
          const args = callArgs(replies[0]);
          if (args !== undefined && workTarget !== undefined) args['target'] = structuredClone(workTarget);
        }
        if (index === 1) {
          const found = toolJson(request, 'ag2b-busy-find') as
            { status?: string; value?: { items?: Array<{ record: { ref: SessionRef } }> } } | undefined;
          expect(found).toMatchObject({ status: 'ready' });
          const ref = found?.value?.items?.find(item => item.record.ref.sessionId === bSession?.sessionId)?.record.ref;
          expect(ref, 'the real directory must include the linked B Session').toBeDefined();
          const args = callArgs(replies[1]);
          if (args !== undefined && ref !== undefined) args['sessionRef'] = { projectId: ref.projectId, sessionId: ref.sessionId };
        }
        if (index === 2) {
          const card = toolJson(request, 'ag2b-busy-card') as
            { status?: string; value?: { record?: { ref?: SessionRef } } } | undefined;
          const ref = card?.value?.record?.ref;
          const args = callArgs(replies[2]);
          if (args !== undefined && ref !== undefined) args['recipient'] = { projectId: ref.projectId, sessionId: ref.sessionId };
        }
      },
    });
    try {
      const seeded = await seedAG2bWorkGraph(started);
      workTarget = seeded.workTarget;
      const createdB = await createAG2bSession(started, 'ag2b-busy-session', AG2B_QUERY_ROLE, [
        { target: workTarget, relation: 'participates' },
      ]);
      bSession = createdB.sessionRef;
      // Occupy B with a real formal Query claim; nothing here rewrites storage.
      await claimBusyQuery(started, createdB, 'stop');
      const sessionsBefore = await sessionCount(started);

      const startResponse = await corePost(started.base, 'workflow/driver-start', started.token, plain(AG2B_SCOPE, startBody));
      // FIRST RED (Stage 1): the unpublished route answers 404 before any
      // busy/wait policy can be reached.
      expect(startResponse.status).toBe(200);
      const waiting = await waitForDriver(started, snapshot => snapshot.state === 'waiting_for_reply');
      expect(waiting.state).toBe('waiting_for_reply');
      // B was never consulted and the Workflow created only A's Session.
      expect(started.scripted.calls()).toBe(3);
      expect(await sessionCount(started), 'A plus its derived child are created next to the occupied B').toBe(sessionsBefore + 2);
      const cards = await listSessions(started);
      const querySessions = cards.filter(isQueryRole);
      expect(querySessions, 'B plus its isolated child A′').toHaveLength(2);
      expect(querySessions.some(card => card.record.ref.sessionId === createdB.sessionRef.sessionId)).toBe(true);
      expect(querySessions.some(card => card.record.ref.sessionId !== createdB.sessionRef.sessionId)).toBe(true);

      const stopResponse = await corePost(started.base, 'workflow/driver-stop', started.token, plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
      expect(stopResponse.status).toBe(200);
      const stopped = await waitForDriver(started, snapshot => snapshot.state === 'stopped');
      expect(stopped).toMatchObject({ state: 'stopped' });
      // The wait was released and the next step was not advanced.
      expect(started.scripted.calls()).toBe(3);

      // The stop is confirmed by the ORIGINAL yielded Run facts plus its formal
      // wait-window control, never by a driver flag. The Run really yielded (its
      // terminal is preserved) and the queued cancel gates any continuation.
      const inbox = await inboxOf(started, createdB.sessionRef);
      const waitMessage = inbox.find(message => message.sender.kind === 'work_run');
      expect(waitMessage, 'the original wait message must stay durable').toBeDefined();
      expect(waitMessage?.status).toBe('pending');
      if (waitMessage !== undefined && waitMessage.sender.kind === 'work_run') {
        const originalRunRef = waitMessage.sender.runRef;
        const execution = await readExecution(started, originalRunRef);
        expect(execution, 'the stop must land formally on the yielded wait Run').toMatchObject({
          status: 'ready',
          value: { run: {
            ref: originalRunRef, status: 'ended', outcome: 'yielded',
            controlState: { desiredState: 'cancelled' },
          } },
        });
      }
    } finally {
      await started.host.close();
    }
  });

  // ------------------------------------------------------------------
  // 3. A completed Host reopens read-only over the original facts; another
  //    scope can never read/stop this driver.
  // ------------------------------------------------------------------
  it('reopens read-only over the original messages/Query/history and refuses another scope', async () => {
    let workTarget: WorkLinkTarget | undefined;
    let bSession: SessionRef | undefined;
    const question = 'AG2b reopen question';
    const answer = 'AG2b reopen saved answer';
    const replies: ScriptedReply[] = [
      { kind: 'calls', calls: [{ callId: 'ag2b-reopen-find', name: 'find_related_sessions', args: { target: {}, page: { limit: 10 } } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-reopen-card', name: 'read_session_card', args: { sessionRef: {} } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-reopen-send', name: 'send_session_message',
        args: { recipient: {}, text: question, replyMode: 'wait' } }] },
      { kind: 'calls', calls: [{ callId: 'ag2b-reopen-edit', name: 'edit',
        args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
      { kind: 'text', text: 'AG2b reopen work complete' },
    ];
    const queryReplies: ScriptedReply[] = [{ kind: 'text', text: answer }];
    const started = await startAG2bHost(publicDir, {
      replies,
      queryReplies,
      beforeReply: async (request, index) => {
        if (index === 0) {
          const args = callArgs(replies[0]);
          if (args !== undefined && workTarget !== undefined) args['target'] = structuredClone(workTarget);
        }
        if (index === 1) {
          const found = toolJson(request, 'ag2b-reopen-find') as
            { value?: { items?: Array<{ record: { ref: SessionRef } }> } } | undefined;
          const ref = found?.value?.items?.find(item => item.record.ref.sessionId === bSession?.sessionId)?.record.ref;
          expect(ref, 'the real directory must include the linked B Session').toBeDefined();
          const args = callArgs(replies[1]);
          if (args !== undefined && ref !== undefined) args['sessionRef'] = { projectId: ref.projectId, sessionId: ref.sessionId };
        }
        if (index === 2) {
          const card = toolJson(request, 'ag2b-reopen-card') as
            { value?: { record?: { ref?: SessionRef } } } | undefined;
          const ref = card?.value?.record?.ref;
          const args = callArgs(replies[2]);
          if (args !== undefined && ref !== undefined) args['recipient'] = { projectId: ref.projectId, sessionId: ref.sessionId };
        }
      },
    });
    let messageRef: SessionMessage['ref'] | undefined;
    try {
      const seeded = await seedAG2bWorkGraph(started);
      workTarget = seeded.workTarget;
      const createdB = await createAG2bSession(started, 'ag2b-reopen-session', AG2B_QUERY_ROLE, [
        { target: workTarget, relation: 'participates' },
      ]);
      bSession = createdB.sessionRef;
      const startResponse = await corePost(started.base, 'workflow/driver-start', started.token, plain(AG2B_SCOPE, startBody));
      expect(startResponse.status).toBe(200);
      const completed = await waitForDriver(started, snapshot => snapshot.state === 'completed' || snapshot.state === 'failed');
      expect(completed.state, 'the original run must really complete before the reopen').toBe('completed');
      const inbox = await inboxOf(started, bSession);
      messageRef = inbox[0]?.ref;
    } finally {
      await started.host.close();
    }

    // Reopen the SAME ledger/Kernel: original facts stay readable with no model.
    const reopened = await startAG2bHost(publicDir, { root: started.root, database: started.database, replies: [] });
    try {
      expect(messageRef).toBeDefined();
      if (messageRef !== undefined) {
        const read = await corePost(reopened.base, 'messages/read', reopened.token, plain(AG2B_SCOPE, messageRef));
        expect(await read.json()).toMatchObject({ status: 'ready', value: { status: 'responded' } });
        const body = await corePost(reopened.base, 'messages/body', reopened.token, plain(AG2B_SCOPE, { messageRef, part: 'response' }));
        expect(await body.json()).toMatchObject({ status: 'ready', value: { text: answer } });
      }
      // Reopening never re-runs a model. A reopened read may honestly report
      // that this Host has no live handle (`not_found`) and must never fake a
      // successful recovery; the HTTP boundary still answers 200.
      const readResponse = await corePost(reopened.base, 'workflow/driver-read', reopened.token, plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
      // FIRST RED (Stage 1): the driver read route is not published either.
      expect(readResponse.status).toBe(200);
      const readBody = await readResponse.json() as ReadResult<CollaborationSnapshot>;
      expect(['ready', 'not_found']).toContain(readBody.status);
      if (readBody.status === 'ready') expect(['completed', 'stopped']).toContain(readBody.value.state);
      expect(reopened.scripted.calls()).toBe(0);

      // Another workspace scope can never read or stop this Goal's driver.
      const otherScope = { projectId: AG2B_SCOPE.projectId, workspaceId: 'ag2b-other-workspace' };
      const crossRead = await corePost(reopened.base, 'workflow/driver-read', reopened.token, plain(otherScope, { goalRef: AG2B_GOAL_REF }));
      expect([403, 404]).toContain(crossRead.status);
      const crossStop = await corePost(reopened.base, 'workflow/driver-stop', reopened.token, plain(otherScope, { goalRef: AG2B_GOAL_REF }));
      expect([403, 404]).toContain(crossStop.status);
      expect(reopened.scripted.calls()).toBe(0);
    } finally {
      await reopened.host.close();
    }
  });
});
