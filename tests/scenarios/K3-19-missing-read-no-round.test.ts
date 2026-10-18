/**
 * K3-19 (一) / A1 (L13, R2): a real Workflow chain whose Host BINDING grants
 * `run_readonly_command` but NOT `read`.
 *
 * The app-level case (`tests/app/K3-19-review-capability-host.test.ts:145`)
 * proves `reviewCapability` is `unavailable` for this grant (A1: the capability
 * and admission share `reviewHostLayerOneAccess`, whose Host layer 1 needs both
 * `read` and `run_readonly_command`). This file closes the loop through the real
 * Workflow: the missing-`read` Host grant makes `reviewCapability` unavailable,
 * so the Workflow opens NO review round (`claim_task`/`prepare`/`start` never
 * happen), the Kernel model is never asked anything, and the `pending_review`
 * record settles `review_unavailable`.
 *
 * The scenario Host's own grant cannot express the missing-`read` binding:
 * `tests/scenarios/support/review-work-root.ts` adds `run_readonly_command` on
 * top of `AG2B_WORK_TOOLS`, which already carries `read`, and the live Host's
 * grant is fixed in `tests/helpers/AG2b-collaboration-fixture.ts`. This file
 * therefore drives the Workflow on a composition root whose runtime is the REAL
 * production Host binding (`createWorkbenchRuntimeHostBindings`), the same one
 * the app-level test exercises. No shared support/helper file is edited.
 *
 * The test also pins the CAUSE, not just the effect: the Workflow reaches
 * `settle_review{review_unavailable}` rather than `review_binding_missing`
 * (`workflow.ts` looks the binding up first), so the binding WAS found and the
 * only remaining null `readonlyCommandAccess` cause is the missing `read` name
 * (`run_readonly_command` is granted and the access is `all_except_denied`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { ag2bWorkspaceBindings, cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createWorkbenchRuntimeHostBindings, type WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_ROLE,
  AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID, permissionRevision, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { Platform } from './harness.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options. Without it the probe would fail in this environment and the
// capability would be unavailable for the WRONG reason; with it a grant that has
// `read` IS available, so the missing-`read` grant is the only discriminator.
// No host process runs here.
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

// --- The shell seam (the process call RUN-25 leaves in flight) --------------
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
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/** The K3-19 card part: the public decision queue on the same Host. */
async function reviewCardOf(h: HostScenario, record: UnknownCallReviewV1): Promise<DecisionCardV1 | undefined> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const card = read.value.waitingAnswer.find(entry => entry.source.key === key);
  if (card !== undefined) {
    expect(read.value.capabilities).toContainEqual({ source: 'unknown_call_review', availability: 'available' });
  }
  return card;
}

/** One `shell` call in flight, closed by RUN-25 on the crash restart; returns the origin RunRef. */
async function crashOneCommand(h: HostScenario, label: string): Promise<RunRef> {
  shellSeam.arm();
  const modelA = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `${label}-shell`, name: 'shell', args: { command: `${label} runs a program` } }] }]);
  const rootA = await openShellWorkRoot(h, modelA);
  let runningA: Promise<unknown> | null = null;
  let preparedA: ReturnType<typeof preparedOf>;
  try {
    const startA = await prepareOn(rootA, h.select(`${label}-a`, AG2B_WORK_TASK_ID));
    preparedA = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-a-start` });
    await shellSeam.waitForCall();
    await h.restart({ crash: true });
  } finally {
    shellSeam.release();
    await runningA?.catch(() => undefined);
    await rootA.close();
  }
  return preparedA.claim.runRef;
}

/**
 * The review-driving root whose Host binding is the REAL production one with
 * `run_readonly_command` granted and `read` deliberately absent. It never starts
 * a Run here, so the model is never resolved and zero provider calls happen.
 */
async function openMissingReadReviewRoot(h: HostScenario): Promise<Platform> {
  const configuration: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [{
      id: 'k3-19-missing-read-binding', label: 'K3-19 missing-read review binding',
      scope: AG2B_SCOPE, role: AG2B_WORK_ROLE,
      configurationRevision: 'k3-19-missing-read@1',
      model: { revision: 'k3-19-missing-read-model@1', provider: 'deepseek', model: 'k3-19-scripted',
        secretEnvironmentVariable: 'K3_19_MISSING_READ_SECRET' },
      grant: {
        budget: AG2B_RUNTIME_BUDGET,
        hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex('K3-19 missing-read instruction') },
        // A1: `run_readonly_command` is granted, `read` is NOT.
        tools: ['shell', 'run_readonly_command'],
        writeScope: [],
        skills: { resourceRoot: h.root, enabledIds: [] },
        systemInstruction: 'K3-19 missing-read instruction', deniedPrefixes: [], processSandboxOptions: {},
        materialBasis: null, readonlyCommandAccess: 'all_except_denied' as const,
      },
    }],
    queryProfiles: [],
  };
  const runtime = createWorkbenchRuntimeHostBindings(configuration,
    { secretSource: { get: () => undefined } });
  return await createTargetPlatform({
    storage: { kind: 'sqlite', directory: h.database },
    workspace: ag2bWorkspaceBindings(h.root, { value: 1 }, permissionRevision(h.stepActor(), AG2B_SCOPE, ['.'])),
    now: () => AG2B_AT,
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(h.database, 'kernel.sqlite') }] },
    runtime,
    // UR1 closes the record's dangling Kernel Turn before the gate decides;
    // the scenario Host holds the instance lease (openReviewWorkRoot).
    hostInstance: { hostInstanceId: 'wp2-scenario-host', lease: 'owned' },
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] },
  });
}

describe('K3-19 (一) missing read: no round claimed', () => {
  it('K3-19 A1: a Host binding with run_readonly_command but no read answers reviewCapability unavailable, so the Workflow claims no round (zero model calls) and settles the record review_unavailable', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const origin = await crashOneCommand(h, 'k3-19-noread');

    const created = await reviewOf(h, origin);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', activeRound: null, rounds: [] });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ kind: 'process', observed: { verdict: 'pending', by: null } });

    const reviewRoot = await openMissingReadReviewRoot(h);
    try {
      // A1: the real production binding refuses the capability for this grant.
      // Lock only the verdict and the behavioral "no claim" below; the exact
      // unavailable reason wording is an implementation detail (Codex
      // suggestion 4), so only its shape is checked.
      const capability = await reviewRoot.runtime.reviewCapability?.(hostCtx(), {
        workspace: AG2B_SCOPE, role: AG2B_WORK_ROLE });
      expect(capability?.status).toBe('unavailable');
      if (capability?.status !== 'unavailable') return;
      expect(capability.reason.length).toBeGreaterThan(0);

      // The gate settles; it never claims/prepares/starts a round.
      const toSettle = await driveReviewUntil(reviewRoot, h.select('k3-19-noread-settle', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const opened = toSettle.receipts.map(receipt => receipt.kind);
      expect(opened).not.toContain('claim_task');
      expect(opened).not.toContain('prepare');
      expect(opened).not.toContain('start');
      expect(toSettle.stopped.kind).toBe('perform');
      if (toSettle.stopped.kind !== 'perform') return;
      expect(toSettle.stopped.operation.kind).toBe('settle_review');
      expect((toSettle.stopped.operation.request as { input?: { cause?: string } }).input?.cause).toBe('review_unavailable');
      // No round opened, so the Kernel model was never asked anything.
      expect(h.modelCalls()).toBe(0);

      const settled = await reviewRoot.workflow.advanceWork(hostCtx(), toSettle.stopped);
      expect(settled.status).toBe('ready');
      if (settled.status !== 'ready') return;
      expect(settled.value.receipt?.kind).toBe('settle_review');
      expect(h.modelCalls()).toBe(0);
    } finally {
      await reviewRoot.close();
    }

    const record = await reviewOf(h, origin);
    expect(record.status).toBe('ready');
    if (record.status !== 'ready') return;
    expect(record.value).toMatchObject({ status: 'needs_decision', activeRound: null, rounds: [] });
    expect(record.value.decisionReasons).toContain('review_unavailable');
    expect(record.value.items[0]!.observed).toMatchObject({ verdict: 'undetermined', by: 'settlement' });

    // K3-19 (一) card part: the same needs_decision record's card is waiting.
    const card = await reviewCardOf(h, record.value);
    expect(card, 'the needs_decision review record has its card').toBeDefined();
    expect(card).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
      source: { kind: 'unknown_call_review', goalRef: { goalId: AG2B_GOAL_REF.goalId } },
      options: [{ id: 'rerun_as_is' }, { id: 'safer_method' }, { id: 'skip_as_done' }, { id: 'handle_myself' }] });
  }, 240_000);
});
