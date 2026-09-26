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
import { createExecutionDriver } from './execution-driver.js';
import { createExecutionObservation } from './execution-observation.js';
import { createRuntimeControlCoordinator } from './execution-control.js';
import { createExecutionPreparation } from './execution-preparation.js';
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
  const observation = createExecutionObservation({ ...deps, control });
  const driver = createExecutionDriver({ ...deps, observation, control });
  const queryPreparation = createQueryPreparation(deps);
  const queryDriver = createQueryExecutionDriver(deps);
  const queryObservation = createQueryObservation(deps);
  const base = basePort();
  return {
    port: {
      ...base,
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
