/**
 * Slice 2B BE2 shared plumbing (rows 2B-10 … 2B-14).
 *
 * What it builds and through which public calls:
 *   - reuses the P7 store fixture `createS2BRuntimeStoreFixture` (real Runtime +
 *     frozen Kernel + scripted model + real WorkGraph stores) and the P6
 *     `restartedHost` from `S2B-runtime-tools-support.ts`; nothing here is a new
 *     version of those;
 *   - the real WorkGraph `RunControlPort` / execution reader over the same store
 *     (the `controlsOn` shape A2/R4 use);
 *   - the real WorkGraph `RunActivityPort` (`createRunActivityService`) over the
 *     same store, for the workspace `ActivityRecording` epoch and the backfill;
 *   - the real Workflow backfill (`createActivityBackfill`) bound to the live
 *     Runtime's `countRunActivity` over the same store;
 *   - the Kernel-store fault seam the probe needs: the P7 fixture's public
 *     `store.read` seam (`withBe1rKernelReadFaults`) only covers `read`;
 *     `reconcileRunAtStartup`'s step-1 probe uses `store.get`, so this helper
 *     adds a generic `get`/`read` seam (`withBe2KernelStoreFaults`) at the same
 *     public Kernel-store boundary. A thrown StoreError('corrupt') makes the
 *     probe verdict `damaged` (RUN-20(ii)) and a read failure `unavailable`.
 *
 * Assertions in the rows go through the public `readRunActivities` /
 * `readActivityCalendar` reads; no database read.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { StoreError, type SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ExecutionEntryPort, HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createRunActivityService, type RunActivityPort } from '../../src/core/work-graph/tasks/run-activity-service.js';
import type { RunActivityViewV1, ActivityCalendarV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { createActivityBackfill, type ActivityBackfillOperations } from '../../src/business/workflow/activity-backfill.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT } from './B2-runtime-fixture.js';
import { type S2BRuntimeStoreFixture } from './S2B-runtime-store-fixture.js';
import { restartedHost } from './S2B-runtime-tools-support.js';

export const BE2_HOST_1: HostInstanceFacts = { hostInstanceId: 's2b-be2-host-1', lease: 'owned' };
export const BE2_HOST_2: HostInstanceFacts = { hostInstanceId: 's2b-be2-host-2', lease: 'owned' };
export const BE2_HOST_3: HostInstanceFacts = { hostInstanceId: 's2b-be2-host-3', lease: 'owned' };

/**
 * The extra registrations BE2 needs at the storage boundary: the real control
 * records for the pause/cancel flows, the real evidence group for the
 * calendar's verification-round reads, and the Query group for the calendar's
 * workspace QueryRun index. All are real production schema groups; none is
 * registered by the P7 base fixture.
 */
export function be2ExtraSchemas(): RecordBackendSchemas {
  return {
    records: [...EVIDENCE_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records, ...QUERY_JOB_RECORD_SCHEMAS.records],
    events: [...EVIDENCE_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events, ...QUERY_JOB_RECORD_SCHEMAS.events],
    lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
      ...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? []), ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? [])],
  };
}

/** The real control service type the Runtime needs (port + observation sink). */
type Be2Controls = ReturnType<typeof createRunControlService>;

/** A fresh real control service over the fixture's store (same shape A2/R4/BE1r use). */
export function controlsOn(fx: S2BRuntimeStoreFixture, now: () => string = () => B2_AT): Be2Controls {
  let seq = 0;
  return createRunControlService({
    records: fx.claimFixture.records,
    authority: createMaterialRecordReaders(fx.claimFixture.records).authority,
    reads: createRunStateReader({ records: fx.claimFixture.records }),
    now,
    eventId: () => `s2b-be2-control-event-${++seq}`,
  });
}

/** Install one controlled Kernel tool through the real public seam (as A2/R4/BE1r). */
export function withTool(
  kernel: RuntimeExecutionDependencies['kernel'], tool: ToolDefinition,
): RuntimeExecutionDependencies['kernel'] {
  return {
    ...kernel,
    runCodingAgent: (options) => kernel.runCodingAgent({ ...options,
      config: { ...options.config, tools: { ...options.config.tools, enabledNames: [...options.config.tools.enabledNames, tool.name] } },
      additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool] }),
  };
}

export async function prepare(
  fx: S2BRuntimeStoreFixture, runtime: ReturnType<typeof import('../../src/core/agent-runtime/runtime.js').createAgentRuntime>,
  requestId: string,
) {
  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  return prepared.value;
}

export async function currentPin(fx: S2BRuntimeStoreFixture) {
  const read = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return { ref: fx.claim.runRef, revision: read.value.run.revision };
}

/** Submit one control intent for the fixture Run at its current revision. */
export async function submitControl(
  fx: S2BRuntimeStoreFixture, controls: Be2Controls,
  kind: 'pause' | 'cancel' | 'resume' | 'steer', reason: string | null, requestId: string,
) {
  const submitted = await controls.submitControl(fx.ctx, {
    input: { runRef: fx.claim.runRef, kind, reason },
    meta: { requestId, expected: [await currentPin(fx)] },
  });
  if (submitted.status !== 'committed') throw new Error(`${kind}: ${JSON.stringify(submitted)}`);
  return submitted.value.intent.ref;
}

/** The real WorkGraph activity owner over the fixture's live store. */
export function activityPortOn(
  fx: S2BRuntimeStoreFixture, now: () => string = () => B2_AT,
): RunActivityPort {
  let seq = 0;
  return createRunActivityService({ records: fx.records, now,
    eventId: () => `s2b-be2-activity-event-${++seq}` });
}

/** Create the workspace `ActivityRecording` epoch through the real public write. */
export async function ensureEpoch(
  fx: S2BRuntimeStoreFixture, port: RunActivityPort, workspace: WorkspaceScope = fx.scope,
): Promise<void> {
  const written = await port.ensureActivityRecording(fx.ctx, {
    input: { workspace: { projectId: workspace.projectId, workspaceId: workspace.workspaceId } },
    meta: { requestId: `s2b-be2-epoch:${String(Date.now())}`, expected: [] },
  });
  if (written.status !== 'committed') throw new Error(`ensureActivityRecording: ${JSON.stringify(written)}`);
}

/** The real Workflow backfill over the fixture's live store and Runtime read side. */
export function backfillOn(
  fx: S2BRuntimeStoreFixture,
  options: { now: () => string; batchRuns?: number },
): ActivityBackfillOperations {
  const counter = fx.runtime.port.countRunActivity;
  if (counter === undefined) throw new Error('the fixture Runtime must publish countRunActivity');
  const activity = activityPortOn(fx, options.now);
  return createActivityBackfill({
    runtime: { countRunActivity: counter.bind(fx.runtime.port) },
    activity,
    now: options.now,
    ...(options.batchRuns === undefined ? {} : { batchRuns: options.batchRuns }),
  });
}

/** The one public activity view of a Run (L10); throws when the read refuses. */
export async function viewOf(fx: S2BRuntimeStoreFixture, runRef: RunRef = fx.claim.runRef): Promise<RunActivityViewV1> {
  const read = await fx.activity.readRunActivities(fx.ctx, { runRefs: [runRef] });
  if (read.status !== 'ready') throw new Error(`readRunActivities: ${JSON.stringify(read)}`);
  const view = read.value.find(candidate => candidate.runRef.runId === runRef.runId);
  if (view === undefined) throw new Error(`no activity view for ${runRef.runId}`);
  return view;
}

export async function calendarOf(
  fx: S2BRuntimeStoreFixture,
  input: { from: string; to: string; granularity: 'hour' | 'day'; timeZone: string },
): Promise<ActivityCalendarV1> {
  const read = await fx.activity.readActivityCalendar(fx.ctx, {
    scope: { kind: 'goal', goalRef: fx.claimFixture.goalRef }, ...input });
  if (read.status !== 'ready') throw new Error(`readActivityCalendar: ${JSON.stringify(read)}`);
  return read.value;
}

/** The fixture's own Runtime port plus a start-up classifier; re-exported for symmetry. */
export const restartHost = restartedHost;

/** An entry port whose `recordRunResult` is refused (the A8-3a lost-booking crash point). */
export function refusingEntry(fx: S2BRuntimeStoreFixture, reason: string): ExecutionEntryPort {
  return { ...fx.entry,
    async recordRunResult() {
      return { status: 'rejected', code: 'unavailable', reason };
    } };
}

/** The public coordinates of one Kernel-store `get`. */
type Be2KernelGet = { sessionId: string; index: number };
/** The public coordinates of one Kernel-store `read`. */
type Be2KernelRead = { sessionId: string; after: number; limit: number; index: number };
type Be2KernelFaultDecision = 'pass' | 'corrupt';

/**
 * The Kernel-store probe/read fault seam (spec §7 "Kernel storage-boundary fault
 * injection at the probe/read boundary"). Every `withStore` still opens the REAL
 * Kernel store; the proxy only steers the public `store.get` (the probe's
 * `KernelSessionReader.get`) and `store.read`. Returning `'corrupt'` throws an
 * explicit `StoreError('corrupt')`, which the probe maps to `damaged` (a `read`
 * failure is mapped to a rejected/unavailable history read) — never success,
 * zero or empty.
 */
export function withBe2KernelStoreFaults(
  base: RuntimeExecutionDependencies['kernelStores'],
  decide: { get?: (get: Be2KernelGet) => Be2KernelFaultDecision; read?: (read: Be2KernelRead) => Be2KernelFaultDecision },
): RuntimeExecutionDependencies['kernelStores'] {
  let gets = 0;
  let reads = 0;
  return {
    ...base,
    async withStore<T>(adapterId: string, use: (store: SqliteStores) => Promise<T>): Promise<T> {
      return base.withStore(adapterId, async (store) => {
        const proxy = new Proxy(store, {
          get(target, property, receiver) {
            if (property === 'get') {
              return async (...args: unknown[]) => {
                const coordinates: Be2KernelGet = { sessionId: String(args[0]), index: gets++ };
                if (decide.get?.(coordinates) === 'corrupt') {
                  throw new StoreError('corrupt', `S2B BE2 injected probe damage (#${String(coordinates.index)})`);
                }
                const real = Reflect.get(target, 'get', receiver) as (...inner: unknown[]) => Promise<unknown>;
                return real.apply(target, args);
              };
            }
            if (property === 'read') {
              return async (...args: unknown[]) => {
                const coordinates: Be2KernelRead = {
                  sessionId: String(args[0]), after: Number(args[1]), limit: Number(args[2]), index: reads++,
                };
                if (decide.read?.(coordinates) === 'corrupt') {
                  throw new StoreError('corrupt', `S2B BE2 injected read failure (#${String(coordinates.index)})`);
                }
                const real = Reflect.get(target, 'read', receiver) as (...inner: unknown[]) => Promise<unknown>;
                return real.apply(target, args);
              };
            }
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          },
        });
        return use(proxy as SqliteStores);
      });
    },
  };
}

/** A host-principal context for the human range backfill (L8: only a human operator). */
export function humanCtx(fx: S2BRuntimeStoreFixture): CoreCallContext {
  return { ...fx.ctx, principal: { kind: 'host', actor: { kind: 'human', id: 's2b-be2-operator' } } };
}
