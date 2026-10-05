/**
 * B2 AgentRuntime factory.
 *
 * With the trusted dependency bundle the factory wires the real bounded
 * preparation, fresh execution driver, incremental observation services and the
 * ONE internal control coordinator. A no-argument call keeps the previous N0
 * behavior and returns an explicit `unsupported` for every member: the factory
 * never fabricates a capability and never starts a Kernel/provider call.
 *
 * The Session creation/original-history members are still declared only so the
 * composition root can override them with the accepted RT1/RT7/RT8
 * implementations.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type { OperationReceipt, Page, ReadResult } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { RunRef } from '../../contracts/dispatch.js';
import { createExecutionDriver } from './execution-driver.js';
import { createExecutionObservation } from './execution-observation.js';
import { createRuntimeControlCoordinator } from './execution-control.js';
import { createExecutionPreparation, loadPreparedManifest, rehydratePreparedExecution } from './execution-preparation.js';
import { continuationBriefDigest } from '../../contracts/continuation-brief.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';
import { createQueryPreparation } from './query-preparation.js';
import { createQueryExecutionDriver } from './query-execution.js';
import { createQueryObservation } from './query-observation.js';
import type { RuntimeExecutionDependencies } from './execution-contracts.js';
import type { AgentRuntimeService, RuntimeExecutionPort } from './ports.js';
import type { RuntimeCapabilities } from './contracts.js';
import type { CreateSessionRequest, SessionHistoryEntry, SessionHistoryRequest } from './session-operations.js';
import type {
  ExecutionHistoryPage, ExecutionHistoryRequest, TaskExecutionHistoryRequest,
} from './execution-history-contracts.js';

const unsupported = (reason: string) => ({
  status: 'rejected' as const, code: 'unsupported' as const, reason,
});

const ABSENT = 'B2 AgentRuntime requires the trusted dependency bundle before it can do any execution work';

function basePort(): RuntimeExecutionPort {
  return {
    async capabilities(_ctx: CoreCallContext, _workspace: WorkspaceScope): Promise<ReadResult<RuntimeCapabilities>> {
      return unsupported('B2 AgentRuntime execution capabilities are not wired');
    },
    async createSession(_ctx: CoreCallContext, _request: CreateSessionRequest): Promise<OperationReceipt<SessionRecord>> {
      return unsupported(ABSENT);
    },
    async readSessionHistory(_ctx: CoreCallContext, _request: SessionHistoryRequest): Promise<ReadResult<Page<SessionHistoryEntry>>> {
      return unsupported(ABSENT);
    },
    async readExecutionHistory(_ctx: CoreCallContext, _request: ExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>> {
      return unsupported(ABSENT);
    },
    async readTaskExecutionHistory(_ctx: CoreCallContext, _request: TaskExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>> {
      return unsupported(ABSENT);
    },
    async prepareExecution() {
      return unsupported('B2 skeleton: prepareExecution is not implemented');
    },
    async startRun() {
      return unsupported('B2 skeleton: startRun is not implemented');
    },
    async observeRun() {
      return unsupported('B2 skeleton: observeRun is not implemented');
    },
    async deliverControl() {
      return unsupported('R4.3a skeleton: deliverControl is not implemented');
    },
    async prepareQuery() {
      return unsupported('R5b.2 skeleton: prepareQuery is not implemented');
    },
    async startQuery() {
      return unsupported('R5b.2 skeleton: startQuery is not implemented');
    },
    async observeQuery() {
      return unsupported('R5b.2 skeleton: observeQuery is not implemented');
    },
  };
}

export function createAgentRuntime(deps?: RuntimeExecutionDependencies): AgentRuntimeService {
  if (deps === undefined) return { port: basePort() };

  const preparation = createExecutionPreparation(deps);
  // R4.3a: the ONE internal control coordinator is assembled before the observer
  // and driver so both share the exact same instance and its private
  // exit/cleanup proof seam. The raw `controls` dependency is optional; without
  // it the coordinator still exists and `deliverControl` stays unsupported.
  const control = createRuntimeControlCoordinator({
    ...(deps.controls === undefined ? {} : { controls: deps.controls }),
    sourceAuthority: deps.sourceAuthority,
  });
  const historyCursorOwner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });
  const readCompletedBoundary: NonNullable<RuntimeExecutionPort['readCompletedBoundary']> = async (ctx, request) => {
    if (ctx.principal.kind !== 'host') {
      return { status: 'rejected', code: 'forbidden', reason: 'the completed boundary read requires the Host principal' };
    }
    if (request.sessionRef.projectId !== ctx.projectId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the Session belongs to another project' };
    }
    const read = await deps.sessions.readSession(ctx, request.sessionRef);
    if (read.status !== 'ready') return read;
    const boundary = await historyCursorOwner.completedBoundary({ session: read.value.record, signal: ctx.signal });
    if (boundary.status !== 'resolved') {
      return { status: 'rejected', code: boundary.code, reason: boundary.reason };
    }
    return { status: 'ready', value: { cursor: boundary.cursor, position: boundary.position } };
  };
  /**
   * C3 `executions/brief` (§6.1 (e)): the continuation brief pinned in a Run's
   * saved manifest, checked against `inputBinding.continuationBriefDigest`. A
   * Run without `requeueRef` has none (`null`); a requeue Run not bound yet is
   * `incomplete`.
   */
  const readContinuationBrief: NonNullable<RuntimeExecutionPort['readContinuationBrief']> = async (ctx, request) => {
    // A plain route hands the body through as it came: only a complete RunRef is read.
    const raw = (typeof request === 'object' && request !== null ? (request as { runRef?: unknown }).runRef : undefined) as
      Record<string, unknown> | null | undefined;
    if (typeof raw !== 'object' || raw === null || raw['aggregateType'] !== 'Run'
      || ![raw['projectId'], raw['goalId'], raw['runId']].every((id) => typeof id === 'string' && id.length > 0)) {
      return { status: 'rejected', code: 'invalid', reason: 'readContinuationBrief requires a complete RunRef' };
    }
    const runRef: RunRef = { aggregateType: 'Run', projectId: raw['projectId'] as string, goalId: raw['goalId'] as string,
      runId: raw['runId'] as string };
    const read = await deps.executions.readExecution(ctx, runRef);
    if (read.status !== 'ready') return read;
    if (read.value.run.requeueRef === undefined) return { status: 'ready', value: null };
    const digest = read.value.run.inputBinding?.continuationBriefDigest;
    const prepared = rehydratePreparedExecution(read.value);
    if (prepared === null || digest === undefined) {
      return { status: 'rejected', code: 'incomplete', reason: 'the requeue Run has not bound its continuation brief yet' };
    }
    const loaded = await loadPreparedManifest(deps.bodies, prepared);
    if (loaded.status !== 'ready') return loaded;
    const brief = loaded.value.manifest.continuationBrief;
    if (brief === undefined || continuationBriefDigest(brief) !== digest) {
      return { status: 'rejected', code: 'unavailable', reason: 'the saved manifest brief disagrees with the Run binding' };
    }
    return { status: 'ready', value: { brief, digest } };
  };
  const observation = createExecutionObservation({ ...deps, control });
  const driver = createExecutionDriver({ ...deps, observation, control });
  const queryPreparation = createQueryPreparation(deps);
  const queryDriver = createQueryExecutionDriver(deps);
  const queryObservation = createQueryObservation(deps);
  const base = basePort();
  return {
    port: {
      ...base,
      readCompletedBoundary,
      readContinuationBrief,
      prepareExecution: (ctx, request) => preparation.prepare(ctx, request),
      startRun: (ctx, request) => driver.start(ctx, request),
      observeRun: (ctx, request) => observation.observe(ctx, request),
      deliverControl: (ctx, request) => control.deliver(ctx, request),
      prepareQuery: (ctx, request) => queryPreparation.prepare(ctx, request),
      startQuery: (ctx, request) => queryDriver.start(ctx, request),
      observeQuery: (ctx, request) => queryObservation.observe(ctx, request),
    },
  };
}
