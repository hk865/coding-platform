/**
 * K3-44 / F-020 / F-035 (G1): the one saved `command_rerun_request` answer is
 * handed back to the Workflow by the REAL Host start-up reconcile and the
 * Workflow's own advance performs ② and ③, once for success and once for a
 * real ③ failure.
 *
 * Everything the reconcile reads is reached through public steps:
 * - the `needs_decision` record and the blocked-command binding come from the
 *   shared scenario path (`crashOneCommand` + the real review round +
 *   `settle_review` + the public `decisions/answer` with `skip_as_done`);
 * - the CRR request is the real `request_command_rerun` tool call of a later
 *   Work Run (the tool is registered only for a blocked manifest);
 * - the CRR answer goes through the public `decisions/answer` route;
 * - the old Host is held by the harness `commitGate` AFTER the ① answer commit
 *   is durable, abandoned with `restart({ crash: true })`, and a new Host runs
 *   the production start-up reconcile with `resumeOnStartup` on. Nothing here
 *   calls `runStartupReconcile` or `advanceWork` by hand, and no answer/receipt
 *   is hand-encoded.
 *
 * The failure case injects a real ledger-commit fault on the ③ event
 * (`failCommitOf`), so the request really moves from `pending` to `denied`
 * (the restart's ②) while the saved answer's `application` stays null (③).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { CommandRerunRequestRef, CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import {
  cleanupScenarios, HostScenario, hostCtx, waitFor,
  type ScenarioCommitGate,
} from './harness.js';
import { answerCard, needsDecisionCard, queueOf, reviewOf } from './support/review-card-round.js';
import { preparedOf, redrivePolicy, textReply } from './support/common.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { failCommitOf } from './support/receipts.js';
import { listCommandRerunRequests } from '../helpers/B2-09b-crash.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';

// A7 pass-through sandbox: the real shell handler is never reached in this row
// (the K3 shell seam replaces it while the original Run is closed); the real
// probe answers `available` as a Host with bubblewrap does.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

// §5.1's blocking `shell` stand-in, hoisted per test file: the first Run's real
// Kernel Turn holds its one call so the real review round can read it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;

const crashHandles: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const release of crashHandles.splice(0)) await release();
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

/** The one waiting `command_rerun_request` card. */
function crrCardOf(queue: DecisionQueueReadV1): DecisionCardV1 {
  const cards = queue.waitingAnswer.filter(card => card.source.kind === 'command_rerun_request');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

/** The public answer card (its synthetic message) in the answered/history sections. */
async function askedCardOf(h: HostScenario, answerRef: SessionMessage['ref']): Promise<DecisionCardV1> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue', plain(AG2B_SCOPE, {
    workspace: AG2B_SCOPE, sections: ['answered_pending_application', 'history'], page: { limit: 100 },
  }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  const cards = [...read.value.answeredPendingApplication, ...read.value.history];
  const found = cards.find(card => card.answerMessageRef?.messageId === answerRef.messageId);
  if (found === undefined) throw new Error('the saved CRR answer card is not readable');
  return found;
}

/** The saved answer message through the public `messages/read` route. */
async function messageOf(h: HostScenario, ref: SessionMessage['ref']): Promise<SessionMessage> {
  const read = await h.post<ReadResult<SessionMessage>>('messages/read', plain(AG2B_SCOPE, ref));
  if (read.status !== 'ready') throw new Error(`the answer message is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** The Task's CRR requests through the owner read port over the same SQLite ledger. */
async function requestsOf(h: HostScenario): Promise<CommandRerunRequestV1[]> {
  return await listCommandRerunRequests(h.database, hostCtx(), AG2B_SCOPE,
    { goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID });
}

/** The one request pin of the waiting card: its captured request ref and revision. */
function requestPinOf(card: DecisionCardV1): { ref: CommandRerunRequestRef; revision: number } {
  const pin = card.source.pins.find(candidate =>
    (candidate.ref as { aggregateType?: string }).aggregateType === 'CommandRerunRequest');
  if (pin === undefined) throw new Error('the card has no request pin');
  return { ref: pin.ref as CommandRerunRequestRef, revision: pin.revision };
}

/** The saved CRR answer (synthetic message) and its public message read. */
async function savedAnswerOf(h: HostScenario, card: DecisionCardV1): Promise<{
  answerRef: SessionMessage['ref']; message: SessionMessage;
}> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue', plain(AG2B_SCOPE, {
    workspace: AG2B_SCOPE, sections: ['answered_pending_application'], page: { limit: 100 },
  }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  const found = read.value.answeredPendingApplication.find(candidate => candidate.source.key === card.source.key);
  if (found?.answerMessageRef === undefined || found.answerMessageRef === null) {
    throw new Error('the saved CRR answer is not publicly readable');
  }
  return { answerRef: found.answerMessageRef, message: await messageOf(h, found.answerMessageRef) };
}

/**
 * A real later Work Run that calls the production `request_command_rerun`
 * tool, held at its next model call. The Run stays active (so the Task remains
 * answerable) and its own Runtime is closed by the returned release.
 */
async function requestRerunRun(h: HostScenario, label: string, command: string): Promise<{
  card: DecisionCardV1; release(): Promise<void>;
}> {
  let reachedResolve!: () => void;
  const reached = new Promise<void>((resolve) => { reachedResolve = resolve; });
  let gateResolve!: () => void;
  const gate = new Promise<void>((resolve) => { gateResolve = resolve; });
  const model = createScriptedModel([
    { kind: 'calls', calls: [{ callId: `${label}-request-rerun`, name: 'request_command_rerun',
      args: { command, reason: `${label}: the blocked command is needed again` } }] },
    { kind: 'text', text: `${label} asked for the rerun` },
  ], async (_request, index) => {
    if (index !== 1) return;
    reachedResolve();
    await gate;
  });
  const root = await openShellWorkRoot(h, model);
  let running: Promise<unknown> | null = null;
  let prepared: ReturnType<typeof preparedOf> | undefined;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    gateResolve();
    await running?.catch(() => undefined);
    await root.close();
  };
  try {
    const start = await prepareOn(root, h.select(`${label}-request`, AG2B_WORK_TASK_ID));
    prepared = preparedOf(start);
    // The real blocked-command binding is on this later Run's manifest.
    expect(prepared.envelope.bundleRef).toBeTruthy();
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-request-start` });
    await reached;
    crashHandles.push(release);
    const queue = await waitFor(() => queueOf(h),
      value => value.waitingAnswer.some(candidate => candidate.source.kind === 'command_rerun_request'),
      `${label}: the real CRR card to wait for an answer`);
    return { card: crrCardOf(queue), release };
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * The whole real public prior state: the shared crash/review/`skip_as_done`
 * round, then the later Run's real `request_command_rerun` and the waiting CRR
 * card. The caller answers that card through the public route.
 */
async function waitingCrrCard(h: HostScenario, label: string): Promise<{
  command: string; card: DecisionCardV1; release(): Promise<void>;
}> {
  const chain = await needsDecisionCard(h, label);
  const command = `${label} runs a program`;
  const skipped = await answerCard(h, chain.card, 'skip_as_done', `${label}-skip`, '已经做过了，别再跑');
  expect(skipped, JSON.stringify(skipped)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  const resolved = await reviewOf(h, chain.originalRunRef);
  expect(resolved.status).toBe('ready');
  if (resolved.status !== 'ready') throw new Error(JSON.stringify(resolved));
  expect(resolved.value.blockedCommands).toHaveLength(1);
  const request = await requestRerunRun(h, label, command);
  return { command, ...request };
}

/** Wait until the start-up answer re-drive has stopped driving. */
async function waitForFlowToStop(h: HostScenario, label: string): Promise<void> {
  await waitFor(() => h.answer('workflow/driver-read', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF })),
    read => {
      const state = (read['value'] as { state?: string } | undefined)?.state;
      return state !== 'running' && state !== 'waiting_for_reply';
    }, `${label}: the start-up re-drive to stop`);
}

/**
 * Arm the old-Host gate; it holds only the ① `SessionMessageDecisionAnswered`
 * commit, after it is durable and before the route continues to ②.
 */
function answerHold(): { gate: ScenarioCommitGate; reached: Promise<void>; arm(): void; release(fail: boolean): void } {
  let armed = false;
  let reachedResolve!: () => void;
  const reached = new Promise<void>((resolve) => { reachedResolve = resolve; });
  let settleResolve!: (fail: boolean) => void;
  const held = new Promise<boolean>((resolve) => { settleResolve = resolve; });
  const gate: ScenarioCommitGate = async (batch) => {
    if (!armed) return;
    if (!batch.events.some(event => event.eventType === 'SessionMessageDecisionAnswered')) return;
    armed = false;
    reachedResolve();
    if (await held) throw new Error('injected: the old Host fell at the CRR answer commit');
  };
  return { gate, reached, arm: () => { armed = true; }, release: (fail) => settleResolve(fail) };
}

describe('F-020/F-035: the real Host start-up hands the saved CRR answer to the Workflow', () => {
  it('F-020/F-035 (success): the crash restart performs ② and ③ by itself; the public request reads allowed and the answer records its application once', async () => {
    const label = 'k3-44-crr-ok';
    const hold = answerHold();
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [textReply(`${label}: the allowed work ran`), textReply(`${label}: done`)] },
      commitGate: hold.gate });
    let answerRoute: Promise<unknown> | null = null;
    try {
      const { card } = await waitingCrrCard(h, label);
      const requestPin = requestPinOf(card);

      // ① commits on the old Host, the gate holds the route before ②. The
      // request is still pending and the saved answer has no application yet.
      hold.arm();
      answerRoute = answerCard(h, card, 'allow_rerun', `${label}-crr-answer`);
      await hold.reached;
      const beforeRequests = await requestsOf(h);
      const before = beforeRequests.find(request => request.ref.requestId === requestPin.ref.requestId);
      if (before === undefined) throw new Error('the CRR request is not readable');
      expect(before).toMatchObject({ state: 'pending', revision: requestPin.revision });
      const { answerRef, message: beforeMessage } = await savedAnswerOf(h, card);
      expect(beforeMessage).toMatchObject({ application: null });

      // The old Host is abandoned AT the answer boundary; the ②/③ below happen
      // only in the new Host's own start-up re-drive.
      h.dropCommitGate();
      const report = await h.restart({ crash: true, automation: redrivePolicy(true) });
      expect(report.report?.problems ?? []).toEqual([]);
      const appliedMessage = await waitFor(() => messageOf(h, answerRef),
        message => message.application !== null,
        `${label}: the start-up re-drive to record the answer application`);
      expect(appliedMessage.application).toMatchObject({ schemaVersion: 1 });
      await waitForFlowToStop(h, label);

      const afterRequests = await requestsOf(h);
      const after = afterRequests.find(request => request.ref.requestId === requestPin.ref.requestId);
      if (after === undefined) throw new Error('the CRR request disappeared');
      expect(after).toMatchObject({ state: 'allowed', revision: before.revision + 1 });
      expect(appliedMessage.revision).toBe(beforeMessage.revision + 1);
      expect(await askedCardOf(h, answerRef)).toMatchObject({ state: 'applied',
        application: { schemaVersion: 1 } });

      // "once": a further real restart finds no unapplied answer and grows no
      // public revision (the request and the answer are unchanged).
      const quiet = await h.restart({ crash: true, automation: redrivePolicy(true) });
      expect(quiet.report?.problems ?? []).toEqual([]);
      const replayedRequests = await requestsOf(h);
      expect(replayedRequests.find(request => request.ref.requestId === requestPin.ref.requestId))
        .toEqual(after);
      expect(await messageOf(h, answerRef)).toEqual(appliedMessage);
    } finally {
      hold.release(true);
      if (answerRoute !== null) await answerRoute.catch(() => undefined);
      await h.drainAbandoned().catch(() => undefined);
    }
  }, 300_000);

  it('F-020/F-035 (failure): the same restart moves the request to denied (② ran) while the injected ③ commit leaves the application empty', async () => {
    const label = 'k3-44-crr-fail';
    const hold = answerHold();
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [textReply(`${label}: the denied work stopped`), textReply(`${label}: done`)] },
      commitGate: hold.gate });
    let answerRoute: Promise<unknown> | null = null;
    let failureFault: ReturnType<typeof failCommitOf> | null = null;
    try {
      const { card } = await waitingCrrCard(h, label);
      const requestPin = requestPinOf(card);
      hold.arm();
      answerRoute = answerCard(h, card, 'deny', `${label}-crr-answer`);
      await hold.reached;
      const beforeRequests = await requestsOf(h);
      const before = beforeRequests.find(request => request.ref.requestId === requestPin.ref.requestId);
      if (before === undefined) throw new Error('the CRR request is not readable');
      expect(before).toMatchObject({ state: 'pending', revision: requestPin.revision });
      const { answerRef, message: beforeMessage } = await savedAnswerOf(h, card);
      expect(beforeMessage).toMatchObject({ application: null });

      // A real commit failure on ③ only: it fires inside the ledger transaction
      // that appends `SessionMessageDecisionApplied`, after ② is durable.
      failureFault = failCommitOf(h.database, 'SessionMessageDecisionApplied');
      h.dropCommitGate();
      const report = await h.restart({ crash: true, automation: redrivePolicy(true) });
      expect(report.report?.problems ?? []).toEqual([]);
      // PROOF ② RAN: before the restart the request was `pending`; after the
      // restart's own hand-over it is `denied` at exactly the next revision. No
      // manual advance and no other writer touched it.
      const moved = await waitFor(async () => (await requestsOf(h))
        .find(request => request.ref.requestId === requestPin.ref.requestId),
      request => request !== undefined && request.state !== 'pending',
      `${label}: the restart's ② to move the request`);
      expect(moved).toMatchObject({ state: 'denied', revision: before.revision + 1 });
      await waitForFlowToStop(h, label);
      // ③ is the failure: the saved answer's application is still empty and its
      // public revision did not move (the failing commit rolled back).
      const failedMessage = await messageOf(h, answerRef);
      expect(failedMessage).toMatchObject({ application: null, revision: beforeMessage.revision });
      expect(await askedCardOf(h, answerRef)).toMatchObject({ state: 'answered_pending_application',
        application: null });
    } finally {
      hold.release(true);
      if (answerRoute !== null) await answerRoute.catch(() => undefined);
      failureFault?.drop();
      await h.drainAbandoned().catch(() => undefined);
    }
  }, 300_000);
});
