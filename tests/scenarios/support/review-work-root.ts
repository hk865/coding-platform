/**
 * K3-05 / K3-R1 item H support: a composition root on a `HostScenario`'s files
 * whose Runtime grant carries the read-only process tool and the L18 layer-1
 * `readonlyCommandAccess` fact, so `reviewCapability` answers `available` and a
 * review round can really be selected, prepared and started (L13/UR1).
 *
 * `openWorkRoot` (./common.ts) keeps the AG2b grant from the harness, which has
 * neither `run_readonly_command` nor `readonlyCommandAccess`, so the Workflow
 * settles a `pending_review` record `review_unavailable` (UR2). This helper
 * wraps `ag2bWorkRuntime` exactly as `openShellWorkRoot` does: it adds the tool
 * to the resolved Host tools, the trusted `readonlyCommandAccess` fact to the
 * configuration and the binding-level `readonlyCommandAccess(input)` method the
 * composition root forwards into the Runtime's `reviewCapability`.
 *
 * The real `reviewCapability` calls `ProcessSandbox.probe`; a test file that
 * uses this helper must `vi.mock` the vendor `sandbox/process/process-sandbox.js`
 * with the KE6 stand-in (as tests/runtime/K-readonly-command.test.ts does). No
 * host process runs here.
 *
 * `driveReviewUntil` drives a root's Workflow (the same `advanceWork` loop as
 * `prepareOn`) until `stopBefore` matches, keeping the performed receipts so a
 * test can prove which steps ran (and, above all, which did not).
 */
import { join } from 'node:path';
import { expect } from 'vitest';
import type { RecordCommitObserver } from '../../../src/composition/commit-observer.js';
import { createTargetPlatform } from '../../../src/composition/create-platform.js';
import type { ReadonlyCommandAccessInput } from '../../../src/core/agent-runtime/execution-contracts.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../../src/business/workflow/contracts.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING,
  AG2B_WORK_TASK_ID, permissionRevision, plain,
} from '../../helpers/AG2b-collaboration-fixture.js';
import type { ScriptedModel } from '../../helpers/B2-runtime-fixture.js';
import {
  AG2B_WORK_TOOLS, ag2bWorkRuntime, ag2bWorkspaceBindings, hostCtx, performs, type HostScenario, type Platform,
} from '../harness.js';
import {
  createWorkbenchRuntimeHostBindings, type WorkbenchRuntimeConfiguration,
} from '../../../src/app/runtime-configuration.js';
import { sha256Hex } from '../../../src/contracts/fingerprint.js';
import type { ReadResult } from '../../../src/contracts/core/results.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../../src/contracts/unknown-call-review.js';
import { crashOneCommand } from './review-card-round.js';

/** `openWorkRoot` (./common.ts) with the read-only command grant a review round needs. */
export async function openReviewWorkRoot(h: HostScenario, model: ScriptedModel,
  observer?: RecordCommitObserver): Promise<Platform> {
  const base = ag2bWorkRuntime(() => model, { tools: [...AG2B_WORK_TOOLS, 'run_readonly_command'] });
  const facts = { access: 'all_except_denied' as const, processSandboxOptions: {} };
  const runtime = {
    ...base,
    async resolveConfiguration(context: Parameters<typeof base.resolveConfiguration>[0],
      request: Parameters<typeof base.resolveConfiguration>[1]) {
      const resolved = await base.resolveConfiguration(context, request);
      if (resolved.status !== 'ready') return resolved;
      return { status: 'ready' as const,
        value: { ...resolved.value, readonlyCommandAccess: facts.access, processSandboxOptions: facts.processSandboxOptions } };
    },
    async readonlyCommandAccess(_input: ReadonlyCommandAccessInput) { return facts; },
  };
  return await createTargetPlatform({
    storage: { kind: 'sqlite', directory: h.database },
    workspace: ag2bWorkspaceBindings(h.root, { value: 1 }, permissionRevision(h.stepActor(), AG2B_SCOPE, ['.'])),
    now: () => AG2B_AT,
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(h.database, 'kernel.sqlite') }] },
    runtime,
    // UR1 closes the record's dangling Kernel Turn before claiming the review
    // round; the scenario Host holds the instance lease (openOwnedWorkRoot).
    hostInstance: { hostInstanceId: 'wp2-scenario-host', lease: 'owned' },
    ...(observer === undefined ? {} : { commitObserver: observer }),
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] },
  });
}

/**
 * The real production Host binding with `run_readonly_command` granted: the
 * `read` tool is deliberately absent, so the review round's capability probe
 * really answers `review_unavailable` and `settle_review` opens no round.
 * `label` supplies this copy's binding/copy text and `hostInstanceId` its
 * instance lease (the callers keep their own host identity).
 */
export async function openMissingReadReviewRoot(h: HostScenario,
  options: { label: string; hostInstanceId: string }): Promise<Platform> {
  const { label, hostInstanceId } = options;
  const instruction = `${label} missing-read instruction`;
  const configuration: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [{
      id: `${label}-missing-read-binding`, label: `${label} missing-read review binding`,
      scope: AG2B_SCOPE, role: AG2B_WORK_ROLE,
      configurationRevision: `${label}-missing-read@1`,
      model: { revision: `${label}-missing-read-model@1`, provider: 'deepseek', model: `${label}-scripted`,
        secretEnvironmentVariable: `${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_MISSING_READ_SECRET` },
      grant: {
        budget: AG2B_RUNTIME_BUDGET,
        hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex(instruction) },
        tools: ['shell', 'run_readonly_command'], writeScope: [],
        skills: { resourceRoot: h.root, enabledIds: [] },
        systemInstruction: instruction, deniedPrefixes: [], processSandboxOptions: {},
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
    hostInstance: { hostInstanceId, lease: 'owned' },
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] },
  });
}

/**
 * One real RUN-25 crash plus `settle_review{review_unavailable}`: the record is
 * `needs_decision`. The blocked original call is NOT released here: the caller
 * keeps the returned idempotent `release` for its original cleanup, the K3-29
 * and K3-44 recovery timing.
 */
export interface NeedsDecisionRecord {
  origin: RunRef;
  review: UnknownCallReviewV1;
  release(): Promise<void>;
}

export async function createNeedsDecisionRecord(h: HostScenario, label: string,
  hostInstanceId: string): Promise<NeedsDecisionRecord> {
  const crashed = await crashOneCommand(h, { callId: `${label}-shell`, select: `${label}-a`,
    requestId: `${label}-a-start`, shellArgs: { command: `${label} runs a program` } });
  try {
    const reviewRoot = await openMissingReadReviewRoot(h, { label, hostInstanceId });
    try {
      const toSettle = await driveReviewUntil(reviewRoot, h.select(`${label}-settle`, AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const settled = await reviewRoot.workflow.advanceWork(hostCtx(), toSettle.stopped);
      expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
    } finally {
      await reviewRoot.close();
    }
    const read = await h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read',
      plain(AG2B_SCOPE, { runRef: crashed.runRef }));
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') throw new Error(JSON.stringify(read));
    expect(read.value).toMatchObject({ status: 'needs_decision', open: 'yes', activeRound: null });
    return { origin: crashed.runRef, review: read.value, release: crashed.release };
  } catch (error) {
    await crashed.release();
    throw error;
  }
}

/** One root's Workflow drive until `stopBefore`; the performed step receipts come back in order. */
export async function driveReviewUntil(platform: Platform, input: WorkflowAdvanceInput,
  stopBefore: (input: WorkflowAdvanceInput) => boolean): Promise<{ stopped: WorkflowAdvanceInput; receipts: WorkflowStepReceipt[] }> {
  let current = input;
  const receipts: WorkflowStepReceipt[] = [];
  for (let step = 0; step < 64; step += 1) {
    if (stopBefore(current)) return { stopped: current, receipts };
    const result = await platform.workflow.advanceWork(hostCtx(), current);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) receipts.push(result.value.receipt);
    if (result.value.state === 'completed' || result.value.next === null) {
      throw new Error(`the Workflow settled before the requested step: ${JSON.stringify(result.value)}`);
    }
    current = result.value.next;
  }
  throw new Error('the Workflow did not reach the requested step within the guard');
}
