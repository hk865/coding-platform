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
import type { RecordCommitObserver } from '../../../src/composition/commit-observer.js';
import { createTargetPlatform } from '../../../src/composition/create-platform.js';
import type { ReadonlyCommandAccessInput } from '../../../src/core/agent-runtime/execution-contracts.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../../src/business/workflow/contracts.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, permissionRevision,
} from '../../helpers/AG2b-collaboration-fixture.js';
import type { ScriptedModel } from '../../helpers/B2-runtime-fixture.js';
import {
  AG2B_WORK_TOOLS, ag2bWorkRuntime, ag2bWorkspaceBindings, hostCtx, type HostScenario, type Platform,
} from '../harness.js';

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
