/**
 * K3-44 (一)(三) / L29 row 5b (M2, D4): a real review card whose ② disposition
 * committed and whose ③ application record failed is handed to the start-up
 * re-drive by the answer index (6b (c) kind 4), by each answer's OWN
 * `reviewRef`, independent of the record's `open` and of the Task's selected
 * Run. UR7b replays ② (the original receipt) and does ③ only:
 *
 * - (一) a real direct "I'll handle it" replaces the disposition and closes the
 *   record (`open = 'no'`): the hold stays held, no continuation appears.
 * - (三) the continuation is already claimed and ran (the record is history,
 *   `open = 'no'`, the selected Run is the continuation): no second
 *   continuation is claimed and the hold is not touched.
 *
 * Everything is real: the `needs_decision` record comes from RUN-25 and the
 * real settle_review owner; the card and the answer through the public
 * `decisions/answer`; the failed ③ is a real aborted ledger commit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { ag2bWorkspaceBindings, cleanupScenarios, HostScenario, hostCtx, performs, waitFor } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { failCommitOf } from './support/receipts.js';
import { expectQuietHarnessRestart } from './support/restart.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createWorkbenchRuntimeHostBindings, type WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_ROLE,
  AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID, graphWrite, permissionRevision, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { Platform } from './harness.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type {
  DecisionCardV1, DecisionQueueReadV1, ResolveDecisionReadV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

const sandbox = vi.hoisted(() => ({ available: true as boolean, executeChecks: false as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

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

afterEach(async () => {
  for (const release of crashHandles.splice(0)) await release();
  shellSeam.release();
  sandbox.available = true;
  sandbox.executeChecks = false;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

const crashHandles: Array<() => Promise<void>> = [];
/** K3-05's A half: a `shell` call in flight is closed by RUN-25, leaving `pending_review`. */
async function crashShellRun(h: HostScenario, label: string): Promise<RunRef> {
  shellSeam.arm();
  const modelA = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `${label}-shell`, name: 'shell', args: { command: `${label} runs a program` } }] }]);
  const rootA = await openShellWorkRoot(h, modelA);
  let runningA: Promise<unknown> | null = null;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    shellSeam.release();
    await runningA?.catch(() => undefined);
    await rootA.close();
  };
  try {
    const startA = await prepareOn(rootA, h.select(`${label}-a`, AG2B_WORK_TASK_ID));
    const preparedA = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-a-start` });
    await shellSeam.waitForCall();
    await h.restart({ crash: true });
    crashHandles.push(release);
    return preparedA.claim.runRef;
  } catch (error) {
    await release();
    throw error;
  }
}

/** K3-17's missing-read review root: `settle_review{review_unavailable}` gives `needs_decision`. */
async function openMissingReadReviewRoot(h: HostScenario): Promise<Platform> {
  const configuration: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [{
      id: 'k3-44-missing-read-binding', label: 'K3-44 missing-read binding',
      scope: AG2B_SCOPE, role: AG2B_WORK_ROLE, configurationRevision: 'k3-44-missing-read@1',
      model: { revision: 'k3-44-missing-read-model@1', provider: 'deepseek', model: 'k3-44-scripted',
        secretEnvironmentVariable: 'K3_44_SECRET' },
      grant: {
        budget: AG2B_RUNTIME_BUDGET,
        hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex('K3-44 instruction') },
        tools: ['shell', 'run_readonly_command'], writeScope: [],
        skills: { resourceRoot: h.root, enabledIds: [] },
        systemInstruction: 'K3-44 instruction', deniedPrefixes: [], processSandboxOptions: {},
        materialBasis: null, readonlyCommandAccess: 'all_except_denied' as const,
      },
    }],
    queryProfiles: [],
  };
  const runtime = createWorkbenchRuntimeHostBindings(configuration, { secretSource: { get: () => undefined } });
  return await createTargetPlatform({
    storage: { kind: 'sqlite', directory: h.database },
    workspace: ag2bWorkspaceBindings(h.root, { value: 1 }, permissionRevision(h.stepActor(), AG2B_SCOPE, ['.'])),
    now: () => AG2B_AT,
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(h.database, 'kernel.sqlite') }] },
    runtime,
    hostInstance: { hostInstanceId: 'k3-44-review-host', lease: 'owned' },
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] },
  });
}

async function createNeedsDecisionRecord(h: HostScenario, label: string): Promise<{ origin: RunRef; review: UnknownCallReviewV1 }> {
  const origin = await crashShellRun(h, label);
  const reviewRoot = await openMissingReadReviewRoot(h);
  try {
    const toSettle = await driveReviewUntil(reviewRoot, h.select(`${label}-settle`, AG2B_WORK_TASK_ID),
      performs('settle_review'));
    const settled = await reviewRoot.workflow.advanceWork(hostCtx(), toSettle.stopped);
    expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
  } finally {
    await reviewRoot.close();
  }
  const read = await reviewOf(h, origin);
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  expect(read.value).toMatchObject({ status: 'needs_decision', open: 'yes', activeRound: null });
  return { origin, review: read.value };
}

async function queue(h: HostScenario): Promise<DecisionQueueReadV1> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer', 'answered_pending_application'],
      page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function reviewCard(h: HostScenario): Promise<DecisionCardV1> {
  const cards = (await queue(h)).waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

/** Answer `rerun_as_is` while the ③ application commit really fails: ② commits, ③ does not. */
async function answerWithFailedApplication(h: HostScenario, card: DecisionCardV1, label: string):
Promise<{ answerRef: SessionMessage['ref'] }> {
  const fault = failCommitOf(h.database, 'SessionMessageDecisionApplied');
  let answered: ResolveDecisionReadV1;
  try {
    const response = await h.answer('decisions/answer', graphWrite(AG2B_SCOPE,
      { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
      `${label}-answer`, card.source.pins));
    if (response['status'] !== 'ready') throw new Error(`the answer was not ready: ${JSON.stringify(response)}`);
    answered = response['value'] as ResolveDecisionReadV1;
  } finally {
    fault.drop();
  }
  expect(answered, JSON.stringify(answered)).toMatchObject({ state: 'application_not_recorded',
    answer: { status: 'committed' }, action: { status: 'committed' }, application: { status: 'rejected' } });
  if (answered.answer.status !== 'committed') throw new Error(JSON.stringify(answered.answer));
  return { answerRef: answered.answer.value.ref };
}

async function resolvedRecord(h: HostScenario, origin: RunRef): Promise<UnknownCallReviewV1> {
  const read = await reviewOf(h, origin);
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return read.value;
}

function messageApplication(h: HostScenario, ref: SessionMessage['ref']): Promise<ReadResult<SessionMessage>> {
  return h.post<ReadResult<SessionMessage>>('messages/read', plain(AG2B_SCOPE, ref));
}

/**
 * Wait until the start-up answer re-drive has stopped driving (its handle is
 * neither running nor waiting for a reply), so a last restart cannot race a
 * flow that is still taking steps.
 */
async function waitForFlowToStop(h: HostScenario, label: string): Promise<void> {
  await waitFor(() => h.answer('workflow/driver-read', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF })),
    read => {
      const state = (read['value'] as { state?: string } | undefined)?.state;
      return state !== 'running' && state !== 'waiting_for_reply';
    }, `${label}: the flow to stop`);
}

describe('K3-44 (一): ② applied, ③ failed, then a direct hold; 6b kind 4 hands the answer by its reviewRef', () => {
  it('K3-44 (一): the real answer index hands over the answer, UR7b replays ② and does ③; the hold stays held and no continuation appears', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { origin, review } = await createNeedsDecisionRecord(h, 'k3-44a');
    const card = await reviewCard(h);
    const { answerRef } = await answerWithFailedApplication(h, card, 'k3-44a');
    const record = await resolvedRecord(h, origin);
    expect(record).toMatchObject({ status: 'resolved', open: 'no', revision: review.revision + 1,
      disposition: { choice: 'rerun_as_is', source: 'card', hold: null } });

    // A real direct "I'll handle it" replaces the disposition (answerMessageRef
    // null) and closes the record; only the answer index can still find ③.
    const held = await h.post<WriteResult<UnknownCallReviewV1>>('unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
      { reviewRef: review.ref, text: 'I will handle this' }, 'k3-44a-hold', [{ ref: review.ref, revision: record.revision }]));
    expect(held).toMatchObject({ status: 'committed', value: { status: 'resolved', open: 'no',
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held', answerMessageRef: null } } });
    if (held.status !== 'committed') throw new Error(JSON.stringify(held));
    const beforeAnswer = await messageApplication(h, answerRef);
    expect(beforeAnswer).toMatchObject({ status: 'ready', value: { application: null } });
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual([]);

    // 6b (c) kind 4 hands the answer over by its own reviewRef; the record is
    // closed and the Task's selected Run is untouched.
    const report = await h.restart({ automation: redrivePolicy(true) });
    expect(report.report?.redriveGoals).toEqual([{ goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE }, taskIds: [],
      answers: [{ kind: 'unknown_call_review', reviewRef: review.ref, answerMessageRef: answerRef }] }]);

    const applied = await waitFor(() => messageApplication(h, answerRef),
      read => read.status === 'ready' && read.value.application !== null,
      'UR7b to record the answer application');
    if (applied.status !== 'ready') throw new Error(JSON.stringify(applied));
    expect(applied.value.application).toMatchObject({ schemaVersion: 1 });

    // Only the bookkeeping: the record is byte-for-byte the held one, the Task
    // did not move and there is no continuation.
    expect(await reviewOf(h, origin)).toEqual({ status: 'ready', value: held.value });
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual([]);
    expect((await h.taskRow()).execution).toEqual(origin);

    // The direct hold and UR7b ③ are the end: the Task is held/stopped, so the
    // flow has settled. A last quiet restart must not hand the answer over again.
    await waitForFlowToStop(h, 'K3-44 (一)');
    const restarted = await expectQuietHarnessRestart(h, 'K3-44 (一): a final restart');
    expect(restarted.report?.redriveGoals).toEqual([]);
  }, 300_000);
});

describe('K3-44 (三): ② applied, ③ failed, then the continuation claimed; 6b kind 4 still hands the answer', () => {
  it('K3-44 (三): UR7b replays ② and does ③ on a historical record (open no, selected Run the continuation); no hold is released and no second continuation is claimed', async () => {
    sandbox.executeChecks = true;
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false),
      check: { command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"` },
      script: { replies: [{ kind: 'text', text: 'K3-44 (三): the continuation ran' }] } });
    const { origin, review } = await createNeedsDecisionRecord(h, 'k3-44c');
    const card = await reviewCard(h);
    const { answerRef } = await answerWithFailedApplication(h, card, 'k3-44c');
    const record = await resolvedRecord(h, origin);
    expect(record).toMatchObject({ status: 'resolved', open: 'no', disposition: { choice: 'rerun_as_is' } });

    // The continuation is really claimed and runs; the record is now history
    // (`open = 'no'`, the selected Run is the continuation).
    const driven = await h.advance(h.select('k3-44c-continue', AG2B_WORK_TASK_ID), {
      stopBefore: performs('complete_task') });
    expect(driven.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining([
      'requeue_task', 'claim_task', 'start']));
    const row = await h.taskRow();
    expect(row.execution).not.toBeNull();
    expect(row.execution?.runId).not.toBe(origin.runId);
    const continuation = row.execution!;
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual(['TaskRequeued']);
    const history = await reviewOf(h, origin);
    expect(history).toMatchObject({ status: 'ready', value: { status: 'resolved', open: 'no',
      disposition: { choice: 'rerun_as_is', hold: null } } });
    expect(await messageApplication(h, answerRef)).toMatchObject({ status: 'ready', value: { application: null } });

    // The formal check really ran and passed, so the flow reaches `complete_task`;
    // performing it satisfies the Task (its terminal state) before the restart.
    expect(driven.state).toBe('stopped');
    expect(driven.next).toMatchObject({ kind: 'perform', operation: { kind: 'complete_task' } });
    if (driven.next === null) throw new Error('the Workflow must reach complete_task');
    const completed = await h.advance(driven.next);
    expect(completed.receipts.map(receipt => receipt.kind)).toContain('complete_task');
    expect((await h.taskRow()).effectivePhase).toBe('satisfied');

    const report = await h.restart({ automation: redrivePolicy(true) });
    expect(report.report?.redriveGoals).toEqual([{ goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE }, taskIds: [],
      answers: [{ kind: 'unknown_call_review', reviewRef: review.ref, answerMessageRef: answerRef }] }]);

    const applied = await waitFor(() => messageApplication(h, answerRef),
      read => read.status === 'ready' && read.value.application !== null,
      'UR7b to record the application of the historical answer');
    if (applied.status !== 'ready') throw new Error(JSON.stringify(applied));
    expect(applied.value.application).toMatchObject({ schemaVersion: 1 });

    // No `hold` was released and no second continuation was claimed.
    expect(await reviewOf(h, origin)).toMatchObject({ status: 'ready', value: { status: 'resolved',
      open: 'no', activeRound: null, disposition: { choice: 'rerun_as_is', hold: null } } });
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual(['TaskRequeued']);
    expect((await h.taskRow()).execution).toEqual(continuation);

    // UR7b's restart is followed by the ordinary selection: wait for the
    // start-up re-drive to stop, then walk that same selection once more. The
    // Task is already satisfied, so it must claim/start no Run and must leave
    // no next step (the continuation's Run has already ended).
    await waitForFlowToStop(h, 'K3-44 (三)');
    const settled = await h.advance(h.select('k3-44c-finish', AG2B_WORK_TASK_ID));
    expect(settled.state).toBe('completed');
    expect(settled.reason).toBe('the Goal is formally COMPLETED');
    expect(settled.next).toBeNull();
    expect(settled.receipts.map(receipt => receipt.kind)).not.toContain('requeue_task');
    expect(settled.receipts.map(receipt => receipt.kind)).not.toContain('claim_task');
    expect(settled.receipts.map(receipt => receipt.kind)).not.toContain('start');
    expect((await h.taskRow()).execution).toEqual(continuation);
    expect((await readExecution(h.host, continuation)).run).toMatchObject({ status: 'ended' });

    // The flow has settled; a last quiet restart must not hand the answer over
    // again or push a second continuation.
    const restarted = await expectQuietHarnessRestart(h, 'K3-44 (三): a final restart');
    expect(restarted.report?.redriveGoals).toEqual([]);
  }, 300_000);
});
