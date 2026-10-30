/**
 * K3 row K3-08 (R1, L4/L13, K KA-08; spec line 1415): the wait reply and the
 * review round's mailbox fence.
 *
 *   (一) an explicit inquiry wait send is in flight when the Host crashes: RUN-25
 *        closes the Run with the send observed `done` (the message committed),
 *        the wait relation is gone (A8-3j), and the reply, delivered to the
 *        original Session, is received at the continuation's safe point;
 *   (二) one batch holds a wait send and a command: the message is answered
 *        while the review round runs, the review round does NOT accept it (its
 *        Kernel run has no `run.input_accepted` for that input), and the
 *        continuation's safe point receives it.
 *
 * The crash point is A8-3j's (the ledger and the Kernel store locked right
 * after `SessionMessageSent`, so the send's result is never recorded). The
 * review round is real (`openReviewWorkRoot` + the real `record_unknown_call_review`
 * tool); the read-only capability is the KE6 probe stand-in and `shell` is the
 * blocking seam. Cards and continuation-note text are session B.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { cleanupRestart, deferred, readExecution, type Deferred } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { waitReplyDeliveryText } from '../helpers/S7B-delivery-samples.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { lockLedgerAfter, openWorkRoot, preparedOf, redrivePolicy, WORK_TARGET } from './support/common.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { acceptedMessageInputs, consult, outboxMessages, preparedBriefOf } from './support/brief.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';

// The KE6 stand-in (as K3-05): `reviewCapability` reads the read-only probe
// with no host process; the general probe stays unavailable.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

const seams = vi.hoisted(() => ({ shell: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shell as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shell = shellSeam;

/**
 * A delegating gate on the real C factory: while installed, every
 * `readConsumableSessions` waits for the one deferred until the explicit
 * `workflow/consultation`, so H cannot auto-answer the inquiry before this
 * test's own `pending` read. The module wrapper is the `S7B-L-host-gates`
 * pattern; the gate itself is the shared `deferred`.
 */
const consumeGate = vi.hoisted(() => ({ gate: undefined as Deferred | undefined }));
vi.mock('../../src/core/work-graph/views/consumable-sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/work-graph/views/consumable-sessions.js')>();
  return {
    ...actual,
    createConsumableSessions: (deps: Parameters<typeof actual.createConsumableSessions>[0]) => {
      const real = actual.createConsumableSessions(deps);
      const gate = consumeGate.gate;
      if (gate === undefined) return real;
      return {
        readConsumableSessions: async (...args: Parameters<typeof real.readConsumableSessions>) => {
          await gate.promise;
          return await real.readConsumableSessions(...args);
        },
      };
    },
  };
});

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

type ScriptedCall = { callId: string; name: string; args: Record<string, unknown> };
type Crashed = {
  runRef: RunRef;
  sessionRef: { projectId: string; sessionId: string };
  prepared: ReturnType<typeof preparedOf>;
  report: Awaited<ReturnType<HostScenario['restart']>>;
};

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

async function messageOf(h: HostScenario, sessionRef: { projectId: string; sessionId: string }): Promise<SessionMessage> {
  const items = await outboxMessages(h, sessionRef);
  expect(items, 'exactly one saved wait message').toHaveLength(1);
  return items[0]!;
}

/**
 * A8-3j's crash point: the batch's first call is the explicit inquiry wait send.
 * The ledger and Kernel store are locked right after the message commit, so the
 * send's result is never recorded and the Host stops.
 */
async function crashOnWaitSend(h: HostScenario, label: string, calls: readonly ScriptedCall[]): Promise<Crashed> {
  const toStart = await h.advance(h.select(label, AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);
  const lock = lockLedgerAfter(h.database, 'SessionMessageSent', { kernelStore: true });
  const root = await openWorkRoot(h, createScriptedModel([{ kind: 'calls', calls: [...calls] }]), lock.observer);
  let started: unknown;
  try {
    started = await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-start` });
  } finally {
    lock.release();
    await root.close();
  }
  expect(lock.locked(), 'the locks were taken right after the message commit').toBe(true);
  expect(started).toMatchObject({ status: 'ready' });
  const report = await h.restart({ crash: true });
  return { runRef: prepared.claim.runRef, sessionRef: prepared.claim.sessionRef, prepared, report };
}

async function recipientParticipant(h: HostScenario, label: string): Promise<{ projectId: string; sessionId: string }> {
  return (await createAG2bSession(h.host, label, AG2B_QUERY_ROLE,
    [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
}

describe('K3-08 the wait reply and the review round mailbox fence', () => {
  it('K3-08 (一): a wait send in flight is observed done, the wait relation is gone, and the continuation receives the reply', async () => {
    // The gate is installed before the Host opens and stays through the restart
    // below; only the explicit consult at the end may release it.
    const gate = deferred();
    consumeGate.gate = gate;
    try {
      const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
        script: { replies: [{ kind: 'text', text: 'K3-08 (一): the continuation received the reply' }],
          queryReplies: [{ kind: 'text', text: 'K3-08: the reply' }] } });
      const recipient = await recipientParticipant(h, 'k3-08-one-recipient');
      const crashed = await crashOnWaitSend(h, 'k3-08-one', [{ callId: 'k3-08-one-send', name: 'send_session_message',
        args: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId },
          text: 'K3-08 (一): a question whose wait the crash loses', intent: 'inquiry', needsReply: true, waitAfterSend: true } }]);
      const { runRef, sessionRef, report } = crashed;

      // RUN-25 applies (a git workspace, the contained send, a readable Kernel).
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(runRef)))
        .toMatchObject({ row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
          autoCleanup: { applied: true } });
      const original = await readExecution(h.host, runRef);
      expect(original.run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { observation: { kind: 'takeover_unresolved',
          unresolvedToolCallIds: ['k3-08-one-send'] } } });
      // A8-3j: the wait association is lost with the crash.
      expect(original.run.continuation, 'the wait relation is gone').toBeUndefined();

      // The one review record: the send is `done` (the message committed), the
      // inventory is complete, so the record settles `resolved` at creation.
      expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
        inventory: 'complete', inventoryProblem: null, status: 'resolved', decisionReasons: [],
        items: [{ alias: 1, callId: 'k3-08-one-send', toolName: 'send_session_message', kind: 'platform',
          observed: { verdict: 'done', by: 'platform', evidence: { kind: 'receipt' } } }],
      } });
      const message = await messageOf(h, sessionRef);
      expect(message).toMatchObject({ status: 'pending', waitAfterSend: true,
        recipient: { sessionId: recipient.sessionId } });

      // Start-up maintenance already closed the crashed Turn (the review record
      // no longer owes a claim): the original Session is available again and
      // still points at the original Run.
      const maintained = await readExecution(h.host, runRef);
      expect(maintained.session.health).toBe('available');
      expect(maintained.session.lastExecutionRef?.runId).toBe(runRef.runId);

      // The Workflow claims the continuation in the ORIGINAL Session (the review
      // record is resolved, so no review round).
      const toContinue = await h.advance(h.select('k3-08-one-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
      if (toContinue.next === null) throw new Error('the continuation start must be planned');
      const prepared = preparedOf(toContinue.next);
      expect(prepared.claim.sessionRef).toEqual(sessionRef);
      expect(prepared.claim.runRef.runId).not.toBe(runRef.runId);

      // The reply is delivered to the original Session, then the continuation
      // starts; its safe point (the before-model input boundary) accepts it.
      expect(await consult(h, message.ref)).toMatchObject({ status: 'ready', value: { state: 'responded' } });
      gate.resolve();
      const driven = await h.advance(toContinue.next, { stopBefore: performs('open_checks') });
      expect(driven.state).toBe('stopped');
      const accepted = await h.post<ReadResult<SessionMessage>>('messages/read', plain(AG2B_SCOPE, message.ref));
      if (accepted.status !== 'ready') throw new Error(JSON.stringify(accepted));
      expect(accepted.value.acceptedInputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ part: 'response', executionRef: prepared.claim.runRef })]));
      expect(acceptedMessageInputs(h.database).filter(input => input.messageId === message.ref.messageId
        && input.part === 'response').map(input => input.text)).toEqual([waitReplyDeliveryText({
        messageId: message.ref.messageId, question: 'K3-08 (一): a question whose wait the crash loses',
        body: 'K3-08: the reply' })]);
      // The continuation brief carries the afterRun as the crashed Run.
      const brief = await preparedBriefOf(h, prepared.envelope.bundleRef);
      expect(brief.requeueRef?.afterRunId).toBe(runRef.runId);
    } finally {
      gate.resolve();
      consumeGate.gate = undefined;
    }
  }, 240_000);



  it('K3-08 (二): the review round never accepts a pending message; the continuation\'s safe point does', async () => {
    // Reachability (reported): the frozen Kernel's tool batch policy runs each
    // non-read-only call as its own serial group and the wait send's
    // `after_group` barrier yields before the next call, so a wait send and a
    // command cannot both be in flight in one Turn. The row's fence is proven
    // with the SAME real shapes: a RUN-20(i) unknown Run whose record lists a
    // process item, a real review round, and a pending message delivered to the
    // original Session while the round runs.
    const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass',
      script: { replies: [{ kind: 'text', text: 'K3-08 (二): the continuation received the message' }] } });
    shellSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-08-two-shell', name: 'shell',
      args: { command: 'K3-08 (二) runs a program' } }] }]);
    const root = await openShellWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    let runRef: RunRef;
    try {
      const prepared = preparedOf(await prepareOn(root, h.select('k3-08-two', AG2B_WORK_TASK_ID)));
      runRef = prepared.claim.runRef;
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-08-two-start' });
      await shellSeam.waitForCall();
      await h.restart({ crash: true });
      const unknown = await readExecution(h.host, runRef);
      expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
      expect(await h.post<WriteResult<unknown>>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef, reason: 'K3-08 (二): checked by hand' }, 'k3-08-two-attest',
        [{ ref: runRef, revision: unknown.run.revision }]))).toMatchObject({ status: 'committed' });
      expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
        status: 'pending_review', decisionReasons: [],
        items: [{ alias: 1, callId: 'k3-08-two-shell', kind: 'process',
          observed: { verdict: 'pending', by: null } }],
      } });
    } finally {
      shellSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }

    // The pending message is delivered to the Session the round runs in, DURING
    // the round's model call. A review round takes only control inputs, so it
    // stays pending for the continuation.
    let messageRef: SessionMessage['ref'] | null = null;
    const reviewModel = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-08-two-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the command finished before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } } }] },
      { kind: 'text', text: 'K3-08 (二) the review round wrote its conclusion' },
    ], async (_request, index) => {
      if (index !== 0 || messageRef !== null) return;
      const sent = await h.post<WriteResult<SessionMessage>>('messages/send', graphWrite(AG2B_SCOPE,
        { recipient: roundSession, text: 'K3-08 (二): the message the review round must not take' },
        'k3-08-two-inbound', []));
      if (sent.status !== 'committed') throw new Error(JSON.stringify(sent));
      messageRef = sent.value.ref;
    });
    const reviewRoot = await openReviewWorkRoot(h, reviewModel);
    let roundKernelRunId: string;
    let roundSession: { projectId: string; sessionId: string };
    try {
      const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-08-two-review', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
      const preparedRound = preparedOf(startStop.stopped);
      roundSession = preparedRound.claim.sessionRef;
      await reviewRoot.runtime.startRun(hostCtx(), { prepared: preparedRound, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-08-two-review-start' });
      const round = await readExecution(h.host, preparedRound.claim.runRef);
      expect(round.run).toMatchObject({ status: 'ended', outcome: 'completed' });
      const auth = round.run.executionAuthorization;
      if (auth === undefined || !('schemaVersion' in auth) || auth.kernel === null) {
        throw new Error('the round Run must hold its Kernel binding');
      }
      roundKernelRunId = auth.kernel.runId;
      if (messageRef === null) throw new Error('the message must have been delivered during the round');
      // The round's Kernel record carries no acceptance of this input.
      expect(acceptedMessageInputs(h.database).filter(input => input.messageId === messageRef!.messageId
        && input.runId === roundKernelRunId)).toEqual([]);

      const settled = await h.advance(h.select('k3-08-two-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');
    } finally {
      await reviewRoot.close();
    }

    const toContinue = await h.advance(h.select('k3-08-two-continue', AG2B_WORK_TASK_ID),
      { stopBefore: performs('start') });
    if (toContinue.next === null) throw new Error('the continuation start must be planned');
    const continuation = preparedOf(toContinue.next);
    const driven = await h.advance(toContinue.next, { stopBefore: performs('open_checks') });
    expect(driven.state).toBe('stopped');
    const continuationAuth = (await readExecution(h.host, continuation.claim.runRef)).run.executionAuthorization;
    if (continuationAuth === undefined || !('schemaVersion' in continuationAuth) || continuationAuth.kernel === null) {
      throw new Error('the continuation Run must hold its Kernel binding');
    }
    if (messageRef === null) throw new Error('the message must have been delivered during the round');
    // The continuation's Session is the round's Session; its safe point takes it.
    expect({ projectId: continuation.claim.sessionRef.projectId, sessionId: continuation.claim.sessionRef.sessionId })
      .toEqual({ projectId: roundSession.projectId, sessionId: roundSession.sessionId });
    expect(acceptedMessageInputs(h.database).filter(input => input.messageId === messageRef!.messageId)
      .map(input => input.runId)).toEqual([continuationAuth.kernel.runId]);
    expect(continuationAuth.kernel.runId).not.toBe(roundKernelRunId);
  }, 300_000);
});
