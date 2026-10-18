/**
 * K3 B3 rework 10, F-076/F-101 (G4): a cancellation stays `cancelled` through
 * the two PUBLIC paths the row names.
 *
 *  - the production review prepare, paused at the Kernel window read and then
 *    aborted: the prepare result is the `cancelled` rejection, not `unavailable`
 *    and not a ready manifest with an empty command-fact map;
 *  - the public decision read of a real pending `command_rerun_request` card,
 *    with the sibling-request page read failing `cancelled` (an A2 wrapper around
 *    the real request owner; `listRequests` does not check the signal itself).
 *
 * The prior state is reached through the real world's public steps only: a real
 * blocked Run (claim -> prepare -> startRun -> classifier/draft -> RUN-22 ->
 * settle), a real review-round claim, and a real request through `requestRerun`.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ExecutionPreparationDependencies } from '../../src/core/agent-runtime/execution-preparation.js';
import {
  createExecutionPreparation,
} from '../../src/core/agent-runtime/execution-preparation.js';
import {
  createContextAssembler, type ContextAssemblerDependencies,
} from '../../src/core/agent-runtime/context-assembler.js';
import { createKernelStoreRegistry, type KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import {
  createCommandRerunRequestCardSource, createDecisionReadModel,
} from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { blockedRecord, realKernelCommandReaderOf, requestRerunOf, CRR_COMMAND } from '../helpers/B2-crr-world.js';
import { createExecutedFilesStub } from '../helpers/executed-files-stub.js';
import { k3_35Configuration } from '../helpers/K3-35-runtime.js';
import { GOAL_B, PLAN_B2, T, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real unresolved
// call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

function kernelStoresOf(world: K3ReviewCardWorld): Promise<KernelStoreRegistry> {
  return createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: WORKSPACE_SCOPE,
    databasePath: join(world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
}

/** A production review prepare, with only its Host grant and clock supplied. */
function reviewPrepareDeps(
  world: K3ReviewCardWorld, kernelStores: KernelStoreRegistry,
): ExecutionPreparationDependencies {
  const records = world.records;
  return {
    executions: createRunStateReader({ records }),
    roles: createRoleConfigurationService({ records, now: () => T, eventId: () => 'f101-role-event' }),
    bodies: world.fixture.bodies,
    host: { async resolveConfiguration() {
      return { status: 'ready', value: k3_35Configuration(
        ['read', 'run_readonly_command'], [], {} as never) };
    } },
    now: () => T,
    newId: () => 'f101-id',
    kernelStores,
    unknownCallReviews: world.reviews,
    readTaskClosure: async (_ctx, task) => readTaskClosure(records,
      { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
  };
}

describe.each(['memory', 'sqlite'] as const)('F-076/F-101: cancellation stays cancelled (%s)', kind => {
  it('a review prepare paused at the Kernel window read and then aborted ends cancelled, not unavailable', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', `f101-${kind}`,
      [{ callId: `f101-call-${kind}`, command: CRR_COMMAND }], { dispose: false });
    expect(record.status).toBe('pending_review');
    // The real review-round claim (TASK-03r) over the real pending record.
    const session = await world.fixture.createS5Session(`f101-review-session-${kind}`);
    const claim = await world.fixture.claimRun({ requestId: `f101-review-claim-${kind}`,
      goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
      review: { reviewRef: record.ref, expectedRevision: record.revision, phase: 'review' } });

    // The injected registry is the real Host store; the wrapper only holds the
    // first store use (A3) so the test can abort while the window read is paused.
    const realStores = await kernelStoresOf(world);
    let reached!: () => void;
    const atWindow = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let heldFirst = false;
    const gatedStores: KernelStoreRegistry = {
      ...realStores,
      async withStore(adapterId, use) {
        if (!heldFirst) {
          heldFirst = true;
          reached();
          await held;
        }
        return realStores.withStore(adapterId, use);
      },
    };
    const deps = reviewPrepareDeps(world, gatedStores);
    const assembler = createContextAssembler({
      ...(deps as unknown as ContextAssemblerDependencies),
      materials: createMaterialService({ bodies: world.fixture.bodies,
        authority: createMaterialRecordReaders(world.records).authority, now: () => T }),
      commandRerunRequests: world.commandRerun,
    });
    const preparation = createExecutionPreparation(deps, assembler);
    const controller = new AbortController();
    const ctx: CoreCallContext = { ...world.fixture.ctx, signal: controller.signal };
    const preparing = preparation.prepare(ctx, { runRef: claim.runRef, requestId: `f101-prepare-${kind}` });
    // A prepare that finishes before the Kernel window read fails here, not by
    // hanging on the gate.
    await Promise.race([atWindow, preparing.then(prepared => {
      throw new Error(`prepare finished before the Kernel window read: ${JSON.stringify(prepared)}`);
    })]);
    controller.abort();
    release();
    const prepared = await preparing;
    // The old guard dropped this read and returned an empty fact map, so this
    // assertion is the one the restored guard fails (prepare became `ready`).
    expect(prepared).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(prepared).not.toMatchObject({ status: 'rejected', code: 'unavailable' });
  }, 120_000);

  it('the public decision read keeps the cancelled sibling-request page result (no write)', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-b', `f076-${kind}`,
      [{ callId: `f076-call-${kind}`, command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, `f076-request-${kind}`);
    expect(request).toMatchObject({ state: 'pending', revision: 1 });

    // A2: the REAL request owner, except the sibling-request page read of the
    // Task (`aliasRequestsOf`, filter `{goalId, taskId}`) answers `cancelled`.
    let faulted = false;
    const faultedRequests = {
      readRequest: (ctx: CoreCallContext, input: Parameters<K3ReviewCardWorld['commandRerun']['readRequest']>[1]) =>
        world.commandRerun.readRequest(ctx, input),
      async listRequests(ctx: CoreCallContext,
        input: Parameters<K3ReviewCardWorld['commandRerun']['listRequests']>[1]) {
        const filter = input.filter as unknown as Record<string, unknown>;
        if (!('goalRef' in filter) && 'goalId' in filter && 'taskId' in filter && !('reviewRunId' in filter)) {
          faulted = true;
          return { status: 'rejected' as const, code: 'cancelled' as const,
            reason: 'the Task sibling-request read was cancelled' };
        }
        return world.commandRerun.listRequests(ctx, input);
      },
    };
    const source = createCommandRerunRequestCardSource({
      records: world.fixture.records,
      requests: faultedRequests as never,
      reviews: world.reviews,
      executions: createRunStateReader({ records: world.fixture.records }),
      readKernelCommandFacts: await realKernelCommandReaderOf(world),
    });
    const readModel = createDecisionReadModel({
      records: world.fixture.records,
      cardSources: [source],
      noticeSources: [],
      conflicts: createGoalConflictAssembler({ records: world.fixture.records,
        catalog: createArchitectureCatalogService({ records: world.fixture.records }),
        executedFiles: createExecutedFilesStub() }),
      positions: createNoticePositionComparator(),
      displayTokens: createNoticeDisplayToken(new Uint8Array(32)),
    });
    const read = await readModel.queryDecisionQueue(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, goalRef: GOAL_B, sections: ['waiting_answer'], page: { limit: 100 } });
    // Reverting the paging read to the generic `rejected`/`unavailable` fails
    // here: the public read answered `unavailable`, never the cancellation.
    expect(read).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(faulted).toBe(true);
    // No write: the pending request is unchanged at the revision it was created.
    const after = await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref });
    expect(after).toMatchObject({ status: 'ready', value: { state: 'pending', revision: request.revision } });
  }, 120_000);
});
