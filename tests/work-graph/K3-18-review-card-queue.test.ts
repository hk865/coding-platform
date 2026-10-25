/**
 * K3-18 (四)'s queue half (L22): a real `needs_decision` review record while the
 * Goal is paused yields the review card in the decision queue and NO
 * `system_requeue` confirmation card (the read model's
 * `pausedAutomationAction` path). The card's availability and its four option
 * labels are asserted from the same real read.
 *
 * The record is produced by the real Workflow with no review round (the Host
 * binding lacks `read`, so `settle_review{review_unavailable}` emits the card).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from '../scenarios/harness.js';
import { redrivePolicy } from '../scenarios/support/common.js';
import { driveReviewUntil, openMissingReadReviewRoot } from '../scenarios/support/review-work-root.js';
import { crashOneCommand } from '../scenarios/support/review-card-round.js';
import { display, goalControlled } from '../scenarios/support/control.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewCardSource } from '../../src/core/work-graph/views/decision-read-model.js';
import type { WorkspaceFile, WorkspaceToolsPort } from '../../src/core/workspace/ports.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { mixedEditSeam, releaseMixedSeams, type MixedSeam } from '../helpers/K3-mixed-seams.js';
import { GOAL_B, PLAN_B2, T as FIXTURE_T, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: string, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      if (options?.['workspaceMode'] !== 'read_only') {
        return { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: only read-only probing' };
      }
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown, edit: undefined as unknown }));
const worlds: K3ReviewCardWorld[] = [];
vi.mock('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js')>();
  return {
    ...actual,
    createEditToolDefinition: (workspace: Parameters<typeof actual.createEditToolDefinition>[0]): ToolDefinition =>
      (seams.edit as MixedSeam).definition(actual.createEditToolDefinition as never, workspace as never),
  };
});
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;
seams.edit = mixedEditSeam;

afterEach(async () => {
  releaseMixedSeams();
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
  for (const world of worlds.splice(0)) await world.close();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}



async function settleKeyUnavailable(h: HostScenario, label: string): Promise<RunRef> {
  const crashed = await crashOneCommand(h, { callId: `${label}-shell`, select: `${label}-a`,
    requestId: `${label}-a-start`, shellArgs: { command: `${label} runs a program` } });
  await crashed.release();
  const origin = crashed.runRef;
  const reviewRoot = await openMissingReadReviewRoot(h, { label, hostInstanceId: 'wp2-scenario-host' });
  try {
    const toSettle = await driveReviewUntil(reviewRoot, h.select(`${label}-settle`, AG2B_WORK_TASK_ID),
      performs('settle_review'));
    const settled = await reviewRoot.workflow.advanceWork(hostCtx(), toSettle.stopped);
    expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
  } finally {
    await reviewRoot.close();
  }
  const record = await reviewOf(h, origin);
  expect(record).toMatchObject({ status: 'ready', value: { status: 'needs_decision' } });
  return origin;
}

async function queue(h: HostScenario): Promise<DecisionQueueReadV1> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer', 'answered_pending_application'], page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

describe('K3-18 (四) review card in a paused Goal queue', () => {
  it('K3-18: the paused-Goal queue has the available review card with the four labels and no system_requeue confirmation card', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const origin = await settleKeyUnavailable(h, 'k3-18');
    // F-040: the autonomy the queue rule reads is set through the public Goal
    // settings route, so the pause path under test is `every_step` with a real
    // unresolved review record.
    const current = await display(h.host);
    const autonomy = await h.post<Record<string, unknown>>('goals/settings/set', graphWrite(AG2B_SCOPE,
      { goalRef: AG2B_GOAL_REF, autonomy: 'every_step', waitForGoalRef: null },
      'k3-18-every-step', [{ ref: AG2B_GOAL_REF, revision: current.goal.revision }]));
    expect(autonomy, JSON.stringify(autonomy)).toMatchObject({ status: 'committed' });
    // F-040: the pause request is REALLY SENT through `goals/control`.
    await goalControlled(h.host, 'pause', 'k3-18-pause');
    const pausedGoal = await display(h.host);
    expect(pausedGoal.goal).toMatchObject({ desiredState: 'paused', settings: { autonomy: 'every_step' } });
    const read = await queue(h);
    const reviewCards = read.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
    expect(reviewCards).toHaveLength(1);
    const card = reviewCards[0]!;
    expect(card.options).toEqual([
      { id: 'rerun_as_is', label: '照原样重跑', effect: 'apply' },
      { id: 'safer_method', label: '换个稳妥的跑法再跑', effect: 'apply' },
      { id: 'skip_as_done', label: '跳过，当作已做', effect: 'apply' },
      { id: 'handle_myself', label: '我来处理', effect: 'apply' },
    ]);
    expect(card.closedReason).toBeNull();
    expect(card.readOnly).toBe(false);
    expect(read.capabilities).toContainEqual({ source: 'unknown_call_review', availability: 'available' });
    // The review record is unresolved, so `pausedAutomationAction` stops every
    // derivation: no `system_requeue` confirmation card is emitted for it.
    expect(read.waitingAnswer.filter(entry => entry.source.kind === 'goal_cause'
      && entry.source.key.includes('automation_confirmation_required'))).toHaveLength(0);
    // The record is still the real one, not a fabricated card.
    const record = await reviewOf(h, origin);
    expect(record).toMatchObject({ status: 'ready', value: { status: 'needs_decision' } });
  }, 240_000);
});

// sha256 of `a\n` and `b\n`: the exact values the workspace owner returns.
const DIGEST_A = '87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7';
const DIGEST_B = '0263829989b6fd954f72baaf2fc64bc2e2f01d692d4de72986ea808f6e99813f';

// -------------------------------------------------------------------------- //
// Spec ~274 `kernel_unreadable_at_stop`: the Kernel is unreadable when the Run //
// stops (RUN-20(ii)) and readable again before recognition, so the inventory  //
// is `incomplete`; the draft keeps the recovered `file_edit` and the state    //
// machine gives `needs_decision`, even though a complete `file_edit` alone    //
// would settle. The accepted consequence (L18/slice 5's object rule) rides on //
// the same real record: a target file that changes after the card was read    //
// makes an annotation on its old object `invalid`; a re-read shows the new    //
// digest.                                                                    //
// -------------------------------------------------------------------------- //

function targetDigestSeam(digestOf: () => string): Pick<WorkspaceToolsPort, 'readWorkspace'> {
  return {
    async readWorkspace(_ctx, input) {
      const value: WorkspaceFile = {
        path: input.path, content: '', digest: digestOf(), sizeBytes: 0,
        digestBasis: 'raw_bytes', version: input.version, readAt: FIXTURE_T,
      };
      return { status: 'ready', value };
    },
  };
}

function digestDecisions(world: K3ReviewCardWorld, workspace: Pick<WorkspaceToolsPort, 'readWorkspace'>) {
  const f = world.fixture;
  let sequence = 0;
  const nextId = (): string => `k3-18-digest-${String(++sequence)}`;
  const materials = createMaterialService({ bodies: f.bodies,
    authority: createMaterialRecordReaders(f.records).authority, now: () => FIXTURE_T });
  const mailboxDeps: SessionMailboxDependencies = {
    records: f.records, materials, now: () => FIXTURE_T, newId: nextId, systemActor: f.operatorActor,
    sessions: createSessionDirectory({ records: f.records, lookups: f.records }),
    executions: createRunStateReader({ records: f.records }),
    roles: createRoleConfigurationService({ records: f.records, now: () => FIXTURE_T, eventId: nextId }),
    duties: { async readMessageDutiesFacts() { return { status: 'ready' as const, value: {
      duties: [...f.duties], readOnlyCopy: false, independentReview: false, guards: [] } }; } },
  };
  const sources = createDecisionSourceFacts({ records: f.records, plans: f.b2.base.plans,
    unknownCallReviews: world.reviews, workspace });
  return createDecisionMessageService({ records: f.records, now: () => FIXTURE_T, newId: nextId,
    operatorActor: f.operatorActor, messages: createSessionMailbox(mailboxDeps), materials,
    messageWrites: createMessageWriteOwner(mailboxDeps), sources });
}

describe('K3-18 (四) review card digests', () => {
  it.each(['memory', 'sqlite'] as const)('K3-18 (%s): a file_edit record whose Kernel was unreadable at the stop is needs_decision; a file change invalidates its old file annotation', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const f = world.fixture;
    const harness = await openRealRunHarness(world);
    try {
      const session = await f.createS5Session('k3-18-transient-edit');
      const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId: 'k3-20-a',
        requestId: 'k3-18-transient-claim' });
      mixedEditSeam.arm();
      const run = await harness.prepareAndStart(claim, {
        model: createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-18-digest-edit', name: 'edit',
          args: { mode: 'replace', path: 'src/x.ts', oldText: 'A', newText: 'B' } }] },
        { kind: 'text', text: 'done' }]),
        tools: ['read', 'write'], writeScope: ['.'], blockOnShell: false,
      });
      try {
        await Promise.race([
          mixedEditSeam.waitForCall(),
          run.started.then(result => {
            throw new Error(`the Run settled before its edit call: ${JSON.stringify(result)}`);
          }, error => { throw error; }),
        ]);
        // RUN-20(ii): the Kernel probe is unreadable at the stop. The real
        // RUN-22 then reads the (now readable) Kernel and its recovered call.
        const created = await harness.createRecord(claim, { probe: { verdict: 'damaged', activeRunId: null,
          reason: 'transient Kernel read failure at the stop' } });
        expect(created.inventory).toBe('incomplete');
        expect(created.inventoryProblem).toBe('kernel_unreadable_at_stop');
        expect(created.status).toBe('needs_decision');
        expect(created.items).toHaveLength(1);
        expect(created.items[0]).toMatchObject({ kind: 'file_edit', toolName: 'edit',
          summary: { mode: 'replace', paths: ['src/x.ts'] } });
        expect(created.decisionReasons).toEqual(['inventory_incomplete']);

        let currentDigest = DIGEST_A;
        const workspace = targetDigestSeam(() => currentDigest);
        const cardSource = createUnknownCallReviewCardSource({ records: f.records, reviews: world.reviews, workspace });
        const source = { kind: 'unknown_call_review' as const,
          key: decisionSourceKey({ kind: 'unknown_call_review', reviewRef: created.ref, revision: created.revision }),
          subject: { kind: 'goal' as const, goalRef: GOAL_B }, pins: [] };
        const readCard = async () => {
          const read = await cardSource.readByKey!(f.ctx, { workspace: WORKSPACE_SCOPE, source });
          if (read.status !== 'ready' || read.value === null) throw new Error(JSON.stringify(read));
          return read.value;
        };
        const first = await readCard();
        const firstFile = first.objects.find(object => object.kind === 'file');
        expect(firstFile).toMatchObject({ kind: 'file', path: 'src/x.ts', digest: DIGEST_A });
        if (firstFile === undefined) throw new Error('the card has no file object');

        currentDigest = DIGEST_B;
        const decisions = digestDecisions(world, workspace);
        const answered = await decisions.answerDecision(f.ctx, { input: { source: first.source,
          selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '',
          annotations: [{ objectKey: canonicalJson(firstFile as unknown as JsonValue), text: 'old digest' }] },
        meta: { requestId: 'k3-18-digest-answer', expected: first.source.pins } });
        expect(answered).toMatchObject({ status: 'rejected', code: 'invalid',
          reason: 'an annotation names an object outside the card' });

        const second = await readCard();
        expect(second.objects.find(object => object.kind === 'file')).toMatchObject({
          kind: 'file', path: 'src/x.ts', digest: DIGEST_B });
      } finally {
        mixedEditSeam.release();
        await run.started;
      }
    } finally {
      mixedEditSeam.release();
      await harness.closeUnion();
    }
  }, 120_000);
});
