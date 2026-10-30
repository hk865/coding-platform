/**
 * Shared R4 real-Turn support (T2-025, R-8).
 *
 * Every Run here is a REAL claim in a real mapped Session of the task-claim
 * fixture (whose Project/Workspace bootstrap is the public
 * `createProjectBootstrapServices` path), prepared and started by the real
 * Runtime through the shared `createS2BRuntimeSteps`, and finished by that
 * same Runtime with a scripted model reply.
 *
 * The helper takes only public inputs: the workspace scope is the fixture's,
 * the text and the scripted model replies are the test's. It never accepts or
 * builds a record, event, draft, cursor, position or Kernel identity. The
 * execution identity is read back from the public `readExecution` locator
 * (`run.executionHistory.kernel`) after the real Run ended.
 */
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type { TaskClaim } from '../../src/core/work-graph/model/claim-contracts.js';
import type { KernelExecutionIdentity } from '../../src/core/agent-runtime/execution-history-contracts.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations, type SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import {
  CLAIM_FIXTURE_AT,
  createTaskClaimFixture,
  type ClaimFixtureKind,
  type TaskClaimFixture,
} from './task-claim-fixture.js';
import { createS2BRuntimeSteps, type S2BRunHandle, type S2BRuntimeSteps } from './S2B-runtime-steps-fixture.js';
import type { ScriptedReply } from './B2-runtime-fixture.js';

const KERNEL_ADAPTER_ID = 'r4c-claim-kernel';
const KERNEL_STORE_KEY = 'r4c-claim-kernel-store';

export type R4HistoryRun = {
  claim: TaskClaim;
  handle: S2BRunHandle;
  sessionRef: SessionRef;
  /** The Kernel identity the public execution locator returned; never re-derived. */
  identity: KernelExecutionIdentity;
  kernel: RunExecutionHistoryV1['kernel'];
};

export type R4HistoryRunInput = {
  /** The Session to claim in; defaults to the fixture's first mapped Session. */
  sessionRef?: SessionRef;
  /** The scripted model's reply text, passed as the Run's only scripted reply
   * (S2B `replies`) when `replies` is absent. */
  text: string;
  /** The Run's scripted replies; when given, `replies` replaces the single
   * `text` reply. */
  replies?: readonly ScriptedReply[];
  /** The real start/finish instant; defaults to the fixture clock. */
  at?: string;
};

export type R4HistoryWorld = {
  readonly ctx: CoreCallContext;
  readonly projectId: string;
  readonly workspaceId: string;
  /** The trusted Host actor the fixture's real call context carries. */
  readonly actor: { kind: 'human' | 'system'; id: string };
  readonly directory: string;
  readonly databasePath: string;
  readonly sessions: TaskClaimFixture['sessions'];
  /** The real Session operations owner over the same Kernel registry. */
  readonly history: SessionOperationsPort;
  /** The mapped Kernel binding of a real Session, read through the Session owner. */
  sessionKernel(ref: SessionRef): Promise<{ adapterId: string; kernelSessionId: string }>;
  /** Claim the next work Task in `sessionRef`, start and finish it for real, then
   * read the execution locator back through the public WG11 read. */
  run(input: R4HistoryRunInput): Promise<R4HistoryRun>;
  close(): Promise<void>;
};

export async function createR4HistoryWorld(kind: ClaimFixtureKind = 'sqlite'): Promise<R4HistoryWorld> {
  const fixture = await createTaskClaimFixture(kind, {
    records: [...CONTROL_RECORD_SCHEMAS.records, ...EXECUTION_ENTRY_RECORD_SCHEMAS.records,
      ...MODEL_REQUEST_RECORD_SCHEMAS.records, ...SESSION_MESSAGE_RECORD_SCHEMAS.records],
    events: [...CONTROL_RECORD_SCHEMAS.events, ...EXECUTION_ENTRY_RECORD_SCHEMAS.events,
      ...MODEL_REQUEST_RECORD_SCHEMAS.events, ...SESSION_MESSAGE_RECORD_SCHEMAS.events],
    lookups: [...CONTROL_RECORD_SCHEMAS.lookups ?? [], ...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [],
      ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? [], ...SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []],
  });
  const databasePath = join(fixture.directory, 'kernel.sqlite');
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: KERNEL_ADAPTER_ID, storeKey: KERNEL_STORE_KEY, workspace: fixture.scope, databasePath,
  }] });
  let sequence = 0;
  const bodies = new RawArtifactBodyStore();
  const steps: S2BRuntimeSteps = await createS2BRuntimeSteps({
    base: fixture, bodies, ctx: fixture.ctx, directory: fixture.directory, scope: fixture.scope,
    now: () => CLAIM_FIXTURE_AT, setClock: () => undefined,
    eventId: () => `r4-history-event-${++sequence}`,
    newId: () => `r4-history-id-${++sequence}`,
    consumerId: 'r4-history-runtime', kernelStores,
  });
  const history = createSessionOperations({ sessions: fixture.sessionsPort, kernelStores });
  // The fixture's Plan has exactly two work Tasks, so one world can start at
  // most two Runs. Every caller asks for at most two.
  const workTasks = [fixture.tasks.first, fixture.tasks.second];
  let taskIndex = 0;
  let runIndex = 0;

  async function sessionKernel(ref: SessionRef): Promise<{ adapterId: string; kernelSessionId: string }> {
    const read = await fixture.sessionsPort.readSession(fixture.ctx, ref);
    if (read.status !== 'ready') throw new Error(`R4 history Session read failed: ${JSON.stringify(read)}`);
    return { adapterId: read.value.record.kernel.adapterId,
      kernelSessionId: read.value.record.kernel.kernelSessionId };
  }

  async function run(input: R4HistoryRunInput): Promise<R4HistoryRun> {
    const task = workTasks[taskIndex];
    if (task === undefined) throw new Error('R4 history support has no unclaimed work Task left');
    taskIndex += 1;
    const sessionRef = input.sessionRef ?? fixture.sessions.first;
    const requestId = `r4-history-claim-${++runIndex}`;
    const claim = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({
      requestId, input: { sessionRef, taskId: task.taskId } }));
    if (claim.status !== 'committed') throw new Error(`R4 history claim failed: ${JSON.stringify(claim)}`);
    const at = input.at ?? CLAIM_FIXTURE_AT;
    const handle = await steps.start(claim.value, { at,
      replies: input.replies === undefined ? [{ kind: 'text', text: input.text }] : input.replies });
    await steps.finish(handle, at, 'completed');
    const read = await createRunStateReader({ records: fixture.records }).readExecution(fixture.ctx, claim.value.runRef);
    if (read.status !== 'ready') throw new Error(`R4 history execution read failed: ${JSON.stringify(read)}`);
    const locator = read.value.run.executionHistory;
    if (locator === undefined) throw new Error('the real Run has no execution history locator');
    return {
      claim: claim.value,
      handle,
      sessionRef,
      identity: { runId: locator.kernel.runId, turnId: locator.kernel.turnId },
      kernel: locator.kernel,
    };
  }

  const materialReader = fixture.ctx.materialReader;
  return {
    ctx: fixture.ctx,
    projectId: fixture.scope.projectId,
    workspaceId: fixture.scope.workspaceId,
    actor: materialReader.kind === 'host' ? materialReader.actor : { kind: 'human', id: 'r4c-claim-operator' },
    directory: fixture.directory,
    databasePath,
    sessions: fixture.sessions,
    history,
    sessionKernel,
    run,
    async close() {
      await steps.close();
      await fixture.close();
    },
  };
}
