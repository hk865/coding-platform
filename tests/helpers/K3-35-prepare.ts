/**
 * K3 group 4 session B3, K3-35 (二)(三): the REAL prepare of the K3-35
 * continuation over the ONE public fact built by `K3-35-continuation-fixture.ts`.
 *
 * `prepareContinuation` is the production `createExecutionPreparation` (not a
 * stand-in) over the real `createRunStateReader`: the continuation basis, the
 * review record and its blocked command all come from the store. Its
 * `readTaskClosure` is the production `plan-readers.ts` reader wired to the same
 * records (item 2 makes it a REQUIRED dependency; there is no absent default).
 *
 * The fixture calls this function for every Run of the chain and then drives
 * the production Runtime's `startRun` with the returned prepared value.
 * `prepareWorstCase` re-reads the stored binding of the already-started
 * continuation Run; it never prepares an entered Run a second time.
 */
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ContextAssemblerDependencies } from '../../src/core/agent-runtime/context-assembler.js';
import { createContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';
import type { ExecutionPreparationDependencies } from '../../src/core/agent-runtime/execution-preparation.js';
import {
  createExecutionPreparation, loadPreparedManifest, rehydratePreparedExecution,
} from '../../src/core/agent-runtime/execution-preparation.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { K3_35PublicRecord } from './K3-35-continuation-fixture.js';
import { k3_35Configuration } from './K3-35-runtime.js';
import type { K3ReviewCardWorld } from './K3-review-card-fixture.js';

export type K3_35PrepareResult = { result: ReadResult<PreparedTaskExecution>; input: string | null };

export type K3_35PrepareRun = {
  world: K3ReviewCardWorld;
  records: GoalRecordTransactionPort & RecordLookupPort;
  task: TaskTriple;
  runRef: { aggregateType: 'Run'; projectId: string; goalId: string; runId: string };
  tools: readonly string[];
  writeScope: readonly string[];
  /** The fixture clock, so the prepared artifacts are ordered with the Run's own facts. */
  now?: () => string;
};

/**
 * Prepare ONE Run of the K3-35 chain through the production preparation owner
 * and return its REAL result.
 */
async function prepareRun(input: K3_35PrepareRun): Promise<K3_35PrepareResult> {
  const ctx: CoreCallContext = input.world.fixture.ctx;
  const records = input.records;
  const now = input.now ?? ((): string => '2026-10-07T10:09:00.000Z');
  const reads = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId: () => 'k3-35-role-event' });
  const materials = createMaterialService({ bodies: input.world.fixture.bodies,
    authority: createMaterialRecordReaders(records).authority, now });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: { projectId: input.task.projectId,
      workspaceId: 'W' }, databasePath: join(input.world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
  const deps: ExecutionPreparationDependencies = {
    executions: reads,
    roles,
    bodies: input.world.fixture.bodies,
    host: { async resolveConfiguration() {
      return { status: 'ready', value: k3_35Configuration(input.tools, input.writeScope,
        {} as ResolvedRuntimeConfiguration['model']['client']) };
    } },
    now,
    newId: () => 'k3-35-id',
    kernelStores,
    unknownCallReviews: input.world.reviews,
    // Item 2: the production Task-closure reader wired to the same records; a
    // direct prepare caller never falls back to "absent → open".
    readTaskClosure: async (_ctx, task) => readTaskClosure(records,
      { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
  };
  const assembler = createContextAssembler({
    ...(deps as unknown as ContextAssemblerDependencies),
    materials,
    commandRerunRequests: input.world.commandRerun,
  });
  const preparation = createExecutionPreparation(deps, assembler);
  const result = await preparation.prepare(ctx, { runRef: input.runRef, requestId: 'k3-35-prepare' });
  if (result.status !== 'ready') return { result, input: null };
  const loaded = await loadPreparedManifest(input.world.fixture.bodies, result.value);
  if (loaded.status !== 'ready') throw new Error(`the prepared manifest is not readable: ${JSON.stringify(loaded)}`);
  return { result, input: loaded.value.manifest.input };
}

/**
 * Prepare ONE Run of the K3-35 chain through the production preparation owner.
 * The Host configuration is the same trusted grant `startRun` later re-reads.
 */
export async function prepareContinuation(input: K3_35PrepareRun): Promise<{ prepared: PreparedTaskExecution; input: string }> {
  const prepared = await prepareRun(input);
  if (prepared.result.status !== 'ready') {
    throw new Error(`the production prepare failed: ${JSON.stringify(prepared.result)}`);
  }
  return { prepared: prepared.result.value, input: prepared.input! };
}

/**
 * Re-read the continuation Run's stored prepared value. The fixture already ran
 * the production `prepare` and `startRun`, so the binding is the real prepared
 * fact; preparing an entered Run again would (correctly) be refused as busy.
 */
export async function prepareWorstCase(publicRecord: K3_35PublicRecord): Promise<K3_35PrepareResult> {
  const reads = createRunStateReader({ records: publicRecord.records });
  const execution = await reads.readExecution(publicRecord.world.fixture.ctx, publicRecord.continuation.runRef);
  if (execution.status !== 'ready') return { result: execution, input: null };
  const prepared = rehydratePreparedExecution(execution.value);
  if (prepared === null) {
    return { result: { status: 'rejected', code: 'unavailable',
      reason: 'the continuation Run has no saved prepared envelope' }, input: null };
  }
  if (prepared.inputBinding.inputDigest !== publicRecord.prepared.inputBinding.inputDigest) {
    return { result: { status: 'rejected', code: 'unavailable',
      reason: 'the saved prepared binding moved' }, input: null };
  }
  return { result: { status: 'ready', value: prepared }, input: publicRecord.preparedInput };
}

/** The role resolution is the real owner, never a literal. */
export type { RoleSpecResolutionV1 };
