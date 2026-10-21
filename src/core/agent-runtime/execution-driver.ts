/**
 * B2 fresh execution driver.
 *
 * The driver re-reads the persisted Prepared body and the trusted Host
 * configuration, fixes the Kernel run/turn identity, and requires a fresh
 * (`replayed === false`) `beginRuntimeEntry` before it calls the real model
 * loop. An already authorized/entered Run is only observed; it is never
 * restarted. The awaited `before_model` barrier records the real entered fact
 * after the Kernel persisted Turn/Run and refuses the provider when that write
 * fails or the persistent deadline has passed.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { RunRef, RunSnapshot, RuntimeInputBindingV1 } from '../../contracts/dispatch.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { GoalRef, WorkspaceRef } from '../../contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../contracts/command-rerun-request.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type {
  HookPort, SqliteStores, ToolCall, ToolDefinition, ToolGroupBarrier, WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import { runObservedModel } from './observed-model-run.js';
import { isReviewRoundPurpose, reviewRoundAdmissionProblem } from '../../contracts/review-admission.js';
import { createControlOnlyInputSupply, createMailboxInputSupply, type InputSupply } from './execution-inputs.js';
import type { SourceToolOptions } from './exploration-tools.js';
import type { RuntimeSourceCaptureFactory } from './source-tool-ports.js';
import { ModelBudget } from './model-budget.js';
import { createRuntimeModelCallAccess, RuntimeModelCallRejected } from './model-call-access.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';
import { loadPreparedManifest, snapshotRuntimeConfiguration } from './execution-preparation.js';
import { createRuntimeSourceCaptureFactory } from './source-capture-access.js';
import { registerReadonlyCommandTool, READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import {
  BUILTIN_TOOL_NAMES, createReviewToolGroup, createRerunToolGroup,
  selectWorkToolGroup, type ToolGroup,
} from './tool-group-assembly.js';
import {
  PROPOSE_SAFER_METHOD_TOOL_NAME, RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME,
} from './unknown-call-review-tools.js';
import { REQUEST_COMMAND_RERUN_TOOL_NAME } from './command-rerun-tools.js';
import { commandSha256 } from '../work-graph/state/command-normalization.js';
import type {
  CommandRerunRequestPort, CommandRerunRequestReadPort,
} from '../work-graph/model/command-rerun-request-contracts.js';
import type {
  UnknownCallReviewReadPort,
} from '../work-graph/model/unknown-call-review-contracts.js';
import type { CommandRecognizer } from '../work-graph/model/command-recognition-contracts.js';
import type { SessionMessage } from '../work-graph/model/communication-contracts.js';
import { toolCommitRequestId } from '../work-graph/model/tool-commit-arguments.js';
import type { ExecutionObservationService } from './execution-observation.js';
import type { RuntimeControlCoordinator, RuntimeControlHandle } from './execution-control.js';
import type {
  KernelExecutionBinding, KernelObservationSource, ObservedExecutionHistory, TaskEntryPermit,
} from '../work-graph/model/execution-entry-contracts.js';
import type {
  StartTaskExecutionRequest, RuntimeExecutionDependencies, TaskExecutionRecord,
} from './execution-contracts.js';

export type ExecutionDriverDependencies = Pick<RuntimeExecutionDependencies,
  | 'entry' | 'historyWriter' | 'executions' | 'sessionOperations' | 'kernelStores' | 'workspaceHost'
  | 'sourceAuthority' | 'sourcePolicyFor' | 'sourceAnalyzers' | 'host' | 'kernel' | 'resourceCaps' | 'now' | 'newId'
  | 'modelRequests' | 'roles' | 'materials' | 'bodies' | 'plans' | 'messages' | 'decisionMessages' | 'applicationReceipt'
  | 'sessions' | 'runReconcile'
  | 'graphHistory' | 'graphContext' | 'taskInputs' | 'unknownCallReviews'
  | 'commandRerunRequests' | 'commandRecognizer'> & {
  /** Slice 4C: the SAME `platform.notes` ports the note tools call. */
  notes?: RuntimeExecutionDependencies['notes'];
  /** The same observer instance backs start and explicit observe calls. */
  observation: ExecutionObservationService;
  /**
   * R4.3a: the ONE internal control coordinator, shared with the observer. It is
   * optional so an existing direct driver construction keeps the old path; the
   * handle registration/exit-proof consumption is a reviewed implementation
   * step, not part of the stage-1 seam.
   */
  control?: RuntimeControlCoordinator;
};

export type ExecutionDriverService = {
  start(ctx: CoreCallContext, request: StartTaskExecutionRequest): Promise<ReadResult<TaskExecutionRecord>>;
};

type KernelSessionReader = Pick<SqliteStores, 'get' | 'read'>;

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export { BUILTIN_TOOL_NAMES, RESERVED_TOOL_NAMES } from './tool-group-assembly.js';
export { createGraphHistoryProxy } from './tool-group-assembly.js';

function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as never) === canonicalJson(right as never); } catch { return false; }
}
/**
 * §6.3 driver check 1 (C3): a Run with a fixed `inputBinding` accepts only a
 * Prepared whose binding and envelope equal the Run's, compared by canonical
 * JSON (not key order) with an absent `additionalMaterialRefs` equal to `[]`.
 */
function boundInputProblem(run: Pick<RunSnapshot, 'inputBinding' | 'envelope'>, prepared: PreparedTaskExecution): string | null {
  if (run.inputBinding === undefined) return null;
  const normalized = (binding: RuntimeInputBindingV1): RuntimeInputBindingV1 =>
    ({ ...binding, additionalMaterialRefs: binding.additionalMaterialRefs ?? [] });
  try {
    if (canonicalJson(normalized(prepared.inputBinding) as never) !== canonicalJson(normalized(run.inputBinding) as never)) {
      return 'the Prepared input binding disagrees with the input binding fixed on the Run';
    }
    if (run.envelope === null || canonicalJson(prepared.envelope as never) !== canonicalJson(run.envelope as never)) {
      return 'the Prepared envelope disagrees with the envelope fixed on the Run';
    }
  } catch {
    return 'the Prepared value is not canonical JSON';
  }
  return null;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required execution fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required execution fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}
function mapWrite(result: WriteResult<unknown>): CoreRejection {
  return result.status === 'rejected' ? result : rejected('unavailable', 'the write unexpectedly committed');
}
function ownContext(ctx: CoreCallContext): CoreCallContext | null {
  try {
    return {
      projectId: ctx.projectId,
      principal: structuredClone(ctx.principal),
      materialReader: structuredClone(ctx.materialReader),
      signal: ctx.signal,
      ...(typeof ctx.workspaceId === 'string' ? { workspaceId: ctx.workspaceId } : {}),
    };
  } catch { return null; }
}

/** L19a fixed texts (byte-exact; the hook is the only producer). */
export const SHELL_BLOCKED_UNCONFIRMED_TEXT = '平台暂时确认不了这条命令有没有被拦，这次先不跑；稍后再试。';
export const SHELL_ALLOWANCE_UNCONFIRMED_TEXT = '暂时确认不了允许，稍后再试';

export type ShellBlockedHookConfig = {
  /** The trusted Run context the reads and the allowance commit use. */
  ctx: CoreCallContext;
  runRef: RunRef;
  taskId: string;
  /** `{ projectId, workspaceId }` of the Run's workspace. */
  workspace: { projectId: string; workspaceId: string };
  /** The three-field binding prepared for this Work Run (never empty here). */
  binding: NonNullable<PreparedTaskManifestV1['blockedCommands']>;
  reviews: Pick<UnknownCallReviewReadPort, 'readReview'>;
  requests: CommandRerunRequestReadPort & CommandRerunRequestPort;
  recognizer?: CommandRecognizer;
};

type BeforeToolDecision = { point: 'before_tool'; kind: 'continue' }
  | { point: 'before_tool'; kind: 'block'; reason: string };

const CONTINUE_TOOL: BeforeToolDecision = { point: 'before_tool', kind: 'continue' };
const blockTool = (reason: string): BeforeToolDecision => ({ point: 'before_tool', kind: 'block', reason });

/**
 * L19a "在哪拦": the `before_tool` control hook for `shell`. It is installed on
 * a Work Run whose prepared manifest carries a non-empty `blockedCommands`
 * binding; every other tool and every Run without a binding continues with
 * ZERO extra reads. For `shell` it reads the binding's records' current state
 * and the Task's CRRs through the owner's one-closure pager (ONE Task-closure
 * read for the whole call, whatever the page count), then, in order: (i) an
 * unused one-time allowance is consumed before the call is allowed; (ii) an
 * approved method runs without a request; (iii) the ONE shared recognizer —
 * exact, action, current-`package.json` expansion and declared forms — names
 * the blocked alias with L19a's fixed text. There is no second matcher here.
 *
 * A records/CRRs read failure fails closed. A recognizer rejection loses only
 * recognition (there is no local fallback) and the call continues; a missing
 * recognizer on a non-empty binding is a wiring error and fails closed.
 */
export function createShellBlockedHook(config: ShellBlockedHookConfig): HookPort {
  const reviewRunIds = [...new Set(config.binding.map(entry => entry.reviewRunId))];
  return {
    hookId: 'b2-runtime-shell-blocked', point: 'before_tool', priority: 10,
    async execute(invocation): Promise<BeforeToolDecision> {
      if (config.binding.length === 0) return CONTINUE_TOOL;
      if (invocation.call.name !== 'shell') return CONTINUE_TOOL;
      const args = invocation.call.arguments;
      const command = isRecord(args) ? args['command'] : undefined;
      if (typeof command !== 'string') return CONTINUE_TOOL;
      const cwd = isRecord(args) && typeof args['cwd'] === 'string' ? args['cwd'] : '.';
      const call = invocation.call;
      const ctx = config.ctx;
      // 1. The binding's records' CURRENT state: one read per distinct reviewRunId.
      const records = new Map<string, UnknownCallReviewV1>();
      for (const runId of reviewRunIds) {
        let read;
        try {
          read = await config.reviews.readReview(ctx, { ref: {
            aggregateType: 'UnknownCallReview', projectId: config.runRef.projectId,
            goalId: config.runRef.goalId, runId,
          } });
        } catch { return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT); }
        if (read.status !== 'ready') return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT);
        if (read.value.task.taskId !== config.taskId) return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT);
        records.set(runId, read.value);
      }
      const orderedRecords = [...records.values()].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.ref.runId.localeCompare(right.ref.runId));
      // 2. The Task's CRRs through k3-crr-by-task, paged to the end. Rework 2
      // item 2: the owner pages the WHOLE task set under ONE Task-closure read,
      // so a 3-page hook call does not re-read the closure per page. Review-3
      // item 2: that same closure is handed to the consume below, so the WHOLE
      // hook call still reads it exactly once.
      const requests: CommandRerunRequestV1[] = [];
      let read;
      try {
        read = await config.requests.listTaskRequests(ctx, { workspace: config.workspace,
          filter: { goalId: config.runRef.goalId, taskId: config.taskId } });
      } catch { return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT); }
      if (read.status !== 'ready') return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT);
      const taskClosure = read.value.closure;
      requests.push(...read.value.items);
      const callSha = commandSha256(command);
      const blockMatched = (
        reviewRunId: string, alias: number, actionText: string | undefined,
        kind: 'exact' | 'action' | 'declared',
      ): BeforeToolDecision => {
        const record = records.get(reviewRunId);
        if (record === undefined) return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT);
        const choice = record.disposition?.choice === 'skip_as_done' ? '跳过' : '换了跑法';
        const where = `#${String(alias)}@${reviewRunId.slice(0, 8)}`;
        const head = kind === 'action' && actionText !== undefined
          ? `平台拦下了这条命令：其中的 ${actionText} 是 ${where} 的一部分（核对以后处置是“${choice}”）。`
          : `平台拦下了这条命令：${where}（核对以后处置是“${choice}”）。`;
        return blockTool(head + '要再跑，先用 `request_command_rerun` 写明原因，等人允许。'
          + '平台没认出来的改写，也要用 `rewriteOf` 注明以后再请求。');
      };
      // (i) One-time allowance, consumed BEFORE the command is allowed to run.
      const allowances = requests.filter(request => request.state === 'allowed' && request.commandSha256 === callSha)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
          || left.ref.requestId.localeCompare(right.ref.requestId));
      const allowance = allowances[0];
      if (allowance !== undefined) {
        let consumed;
        try {
          consumed = await config.requests.consumeAllowance(ctx, {
            input: { requestRef: allowance.ref,
              usedBy: { runId: config.runRef.runId, callId: call.callId } },
            meta: { requestId: 'b2-hook-consume:' + call.callId,
              // The pin is the CRR ref@revision; the shared VersionPin union does
              // not yet name CommandRerunRequest (contract owner's change).
              expected: [{ ref: allowance.ref as never, revision: allowance.revision }] },
          }, taskClosure);
        } catch { return blockTool(SHELL_ALLOWANCE_UNCONFIRMED_TEXT); }
        return consumed.status === 'committed' ? CONTINUE_TOOL : blockTool(SHELL_ALLOWANCE_UNCONFIRMED_TEXT);
      }
      // (ii) An approved method of a record with blocked commands runs as-is.
      for (const record of orderedRecords) {
        if (record.blockedCommands.length === 0) continue;
        for (const method of record.disposition?.approvedMethods ?? []) {
          if (commandSha256(method.command) === callSha) return CONTINUE_TOOL;
        }
      }
      // (iii) The ONE shared recognizer (item 2): exact, action, current
      // `package.json` expansion and declared forms, first by (record
      // `createdAt`, alias). The hook never parses or compares stored actions
      // itself. F-070: the recognizer fails CLOSED. A throw or any non-`ready`
      // answer leaves the command unconfirmed and blocked; only a CONFIRMED
      // no-match (`ready`, value `null`) continues. A package.json read failure
      // is not a recognizer failure: the recognizer degrades to `ready` and
      // loses only the expansion. A missing recognizer on a non-empty binding
      // is a wiring error and also fails closed.
      const recognizer = config.recognizer;
      if (recognizer === undefined) return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT);
      // A `closed` CRR is terminal (item 3): the Task is no longer active, so
      // it can never be the `allowed` request consumed above (the filter
      // compares `allowed` only). The recognizer still sees the request set,
      // because a stored declared form names a blocked alias; it grants
      // nothing.
      let recognized;
      try {
        recognized = await recognizer(ctx, {
          records: orderedRecords, requests, command, cwd, maxPackageReads: 2,
        });
      } catch { return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT); }
      if (recognized.status !== 'ready') return blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT);
      if (recognized.value === null) return CONTINUE_TOOL;
      const hit = recognized.value;
      return blockMatched(hit.reviewRunId, hit.alias, hit.match.action?.text, hit.match.kind);
    },
  };
}

export function createExecutionDriver(deps: ExecutionDriverDependencies): ExecutionDriverService {
  return {
    async start(ctx: CoreCallContext, request: StartTaskExecutionRequest): Promise<ReadResult<TaskExecutionRecord>> {
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      const signal = owned.signal;
      // The ONE internal control coordinator shared with the observer. A local
      // const keeps the optional narrowing stable inside the hook/barrier
      // closures below.
      const control = deps.control;
      if (signal.aborted) return rejected('cancelled', 'the start was cancelled before the prepared body was re-read');
      const rawPrepared: PreparedTaskExecution | undefined = request?.prepared;
      const rawRunRef: RunRef | undefined = rawPrepared?.claim?.runRef;
      if (rawPrepared === undefined || !isRecord(rawRunRef) || rawRunRef.aggregateType !== 'Run' || !nonEmpty(rawRunRef.projectId)
        || !nonEmpty(rawRunRef.goalId) || !nonEmpty(rawRunRef.runId)) {
        return rejected('invalid', 'startRun requires a prepared task execution with a complete RunRef');
      }
      if (!nonEmpty(request.consumerId) || !nonEmpty(request.requestId)) return rejected('invalid', 'startRun requires a consumerId and a requestId');
      // The whole trusted request is isolated before the first await: a caller
      // mutating the Prepared object or the consumer/request ids afterwards can
      // never retarget this start or its idempotency identity.
      let prepared: PreparedTaskExecution;
      let runRef: RunRef;
      const consumerId: string = request.consumerId;
      const requestId: string = request.requestId;
      try {
        prepared = structuredClone(rawPrepared);
        runRef = structuredClone(rawRunRef);
      } catch {
        return rejected('invalid', 'the start request cannot be isolated from the caller');
      }
      if (runRef.projectId !== owned.projectId) return rejected('forbidden', 'the Run belongs to another project');

      // 1. Re-read the persisted bounded manifest; a tampered Prepared value is
      //    refused before any WorkGraph admission or Host call.
      const loaded = await loadPreparedManifest(deps.bodies, prepared);
      if (loaded.status !== 'ready') return loaded;
      const { manifest, bundleRef } = loaded.value;
      if (!sameRef(manifest.claim, prepared.claim)) return rejected('invalid', 'the persisted manifest claim disagrees with the returned claim');

      let read;
      try {
        read = await deps.executions.readExecution(owned, runRef);
      } catch (error) {
        return rejected('unavailable', `the execution read failed: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return mapRead(read);
      const record = read.value;
      if (record.run.status !== 'starting' && record.run.executionAuthorization === undefined) {
        return rejected('busy', 'the Run already ended without an entry authorization');
      }
      if (record.session.ref.projectId !== runRef.projectId || record.session.ref.sessionId !== manifest.claim.sessionRef.sessionId
        || !sameRef(record.outbox.claim, manifest.claim)) {
        return rejected('unavailable', 'the Session mapping disagrees with the prepared claim');
      }
      // C3 (§6.3 driver order, step 1): a Run whose input is already bound only
      // runs with exactly that binding and envelope, before any WorkGraph write
      // or Kernel call; two prepares with different briefs cannot both enter.
      const boundProblem = boundInputProblem(record.run, prepared);
      if (boundProblem !== null) return rejected('invalid', boundProblem);
      const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: runRef.projectId, workspaceId: record.session.workspaceId };

      // 2. Fix the Kernel run/turn identity. A prior begin binding is reused
      //    verbatim; a fresh Run derives a stable identity from the claim so a
      //    lost begin response cannot create a second Turn.
      const existingAuth = record.run.executionAuthorization;
      const isV2 = existingAuth !== undefined;
      const existingKernel = isV2 ? existingAuth.kernel : null;
      if (existingKernel !== null && (existingKernel.adapterId !== record.session.kernel.adapterId
        || existingKernel.kernelSessionId !== record.session.kernel.kernelSessionId)) {
        return rejected('unavailable', 'the fixed Kernel identity disagrees with the Session mapping');
      }
      const kernelBinding: KernelExecutionBinding = existingKernel ?? {
        adapterId: record.session.kernel.adapterId, kernelSessionId: record.session.kernel.kernelSessionId,
        runId: 'krun-' + sha256Hex(canonicalJson(runRef as never)),
        turnId: 'kturn-' + sha256Hex(canonicalJson({ runRef, attemptRef: manifest.claim.attemptRef } as never)),
      };

      // 3. An already begun/entered/settled Run is only observed, EXCEPT an
      //    entered Run with a queued formal resume intent: an explicit Host
      //    resume re-enters the SAME Kernel Turn through the original identity.
      const resumePointer = record.run.controlState?.desiredState === 'running' ? record.run.controlState.intentRef : undefined;
      const resumeIntent = resumePointer === undefined || control === undefined ? undefined : await control.deliver(owned, { intentRef: resumePointer });
      // RUN-14 driver guard (A.2 step 5.6, C4, §6.4): the original Turn is re-entered only while THIS
      // Host process still holds the Run's handle (it paused at a safe point here); without it the start
      // answers `busy` with no Kernel call, and after a restart the reconcile ends the Run (RUN-19/24).
      const queuedResume = isV2 && existingAuth.phase === 'entered' && resumeIntent?.status === 'ready'
        && resumeIntent.value.kind === 'resume' && resumeIntent.value.status === 'queued';
      const resumeEntered = queuedResume && control?.proof(runRef) !== undefined;
      if (queuedResume && !resumeEntered) {
        return rejected('busy', 'the paused Turn is re-entered only by the Host process that holds its live handle; '
          + 'after a restart the start-up reconcile ends it (RUN-19/24)');
      }
      // RUN-03 (W-03): a binding revoked by a proven non-entry is authorized again (generation + 1)
      // with the SAME prepared input below; every other non-authorized binding is only observed.
      if (isV2 && existingAuth.phase !== 'authorized' && existingAuth.phase !== 'revoked' && !resumeEntered) {
        if (existingAuth.consumerId !== consumerId) return rejected('busy', 'another consumer already authorized this Run');
        if (existingAuth.inputDigest !== manifest.inputDigest) return rejected('invalid', 'the Prepared input digest disagrees with the fixed entry binding');
        return deps.observation.observe(owned, { runRef });
      }

      // 3b. Assemble the effective coordination tools from the reviewed C1/W2
      //     factories. The selection set is the formal manifest/Role/Host
      //     intersection; declaring a name grants nothing. An unknown selected
      //     name or a selected platform tool whose dependency is unbound fails
      //     closed here, before the provider, the authorize/begin writes and any
      //     new-entry Host call. A begun/entered/settled Run already returned
      //     through observation above and is never re-judged by this fresh check.
      const builtinTools = manifest.permissions.tools.filter(tool => BUILTIN_TOOL_NAMES.has(tool));
      const hasFileRead = builtinTools.includes('read');
      const sessionRef: SessionRef = { projectId: record.session.ref.projectId, sessionId: record.session.ref.sessionId };
      const goalRef: GoalRef = { aggregateType: 'Goal', projectId: runRef.projectId, goalId: runRef.goalId };
      const toolContext: CoreCallContext = {
        projectId: runRef.projectId,
        workspaceId: record.session.workspaceId,
        principal: { kind: 'work_run', runRef, roleBinding: structuredClone(record.run.roleBinding) },
        materialReader: { kind: 'run', requester: runRef },
        signal,
      };
      const requestIdForCall = (call: Readonly<ToolCall>): string => {
        if (!nonEmpty(call.callId) || !nonEmpty(call.name)) throw new Error('the Kernel tool call carries no trusted identity');
        // Decision 72 (U1): the ONE request builder every owner lookup shares;
        // passing the plain `{projectId, sessionId}` ref here is the live path
        // the draft's claim-Session origin and the owner lookups must match.
        return toolCommitRequestId({
          origin: { runRef, sessionRef, generation: record.outbox.claim.generation,
            workspaceId: record.session.workspaceId },
          toolName: call.name, kernelCallId: call.callId,
        });
      };
      // The explicit wait registration for THIS Run. It is set only after a
      // waitAfterSend message is durably committed; the tool-group barrier reads
      // it at the real after_group boundary and commits the yielded terminal.
      // No polling, no held model promise and no second schedule exist.
      let waitRegistered: { message: SessionMessage } | null = null;
      // The wait is registered on the SAME live control handle the observer reads,
      // so a real yielded terminal can persist the exact original Task/Session and
      // saved message. The handle is created below and assigned before any tool
      // can run, so this callback always sees it.
      let waitHandle: RuntimeControlHandle | null = null;
      const onWaitRegistered = (message: SessionMessage): void => {
        waitRegistered ??= { message };
        if (waitHandle !== null) waitHandle.waitMessage = structuredClone(message);
      };
      const coordination = selectWorkToolGroup({
        selected: manifest.permissions.tools,
        mailbox: deps.messages,
        ...(deps.decisionMessages === undefined ? {} : { decisionMessages: deps.decisionMessages }),
        ...(deps.applicationReceipt === undefined ? {} : { applicationReceipt: deps.applicationReceipt }),
        sessions: deps.sessions,
        plans: deps.plans,
        context: toolContext,
        sessionRef,
        goalRef,
        requestIdForCall,
        onWaitRegistered,
        ...(deps.graphContext === undefined || deps.taskInputs === undefined ? {} : {
          graph: {
            graphContext: deps.graphContext,
            taskInputs: deps.taskInputs,
            graphHistory: deps.graphHistory,
            // Work uses the ORIGINAL startRun Host context; the proxy swaps only
            // this tool call's signal in and never exposes it to the model.
            hostContext: owned,
          },
        }),
        ...(deps.notes === undefined ? {} : { notes: deps.notes }),
        extensionNames: new Set([READONLY_COMMAND_TOOL_NAME, RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME,
          PROPOSE_SAFER_METHOD_TOOL_NAME, REQUEST_COMMAND_RERUN_TOOL_NAME]),
      });
      if (!coordination.ok) return coordination.rejection;
      const coordinationTools: ToolGroup | null = coordination.value;

      // K3 L14/L20: the one review-purpose write tool is registered on BOTH
      // phases — `record_unknown_call_review` for `review`,
      // `propose_safer_method` for `proposal`. The record ref and this round's
      // Run are trusted (the Run purpose and the `work_run` principal); the
      // model supplies neither. A review Run whose owner is not bound fails
      // closed before the model.
      const reviewPurpose = record.run.purpose?.kind === 'unknown_call_review' ? record.run.purpose : null;
      let unknownCallReviewTool: ((workspace: WorkspaceSandbox) => ToolDefinition) | undefined;
      let unknownCallReviewToolName: string | undefined;
      if (reviewPurpose !== null) {
        if (deps.unknownCallReviews === undefined) {
          return rejected('unsupported', 'the review Run requires the unknownCallReviews owner to register its review tool');
        }
        const reviewGroup = createReviewToolGroup({
          reviews: deps.unknownCallReviews,
          context: toolContext,
          reviewRef: reviewPurpose.reviewRef,
          requestIdForCall,
          phase: reviewPurpose.phase,
        });
        if (!reviewGroup.ok) return reviewGroup.rejection;
        unknownCallReviewToolName = reviewGroup.value.names[0]!;
        unknownCallReviewTool = (workspaceHandle: WorkspaceSandbox): ToolDefinition => reviewGroup.value.create(workspaceHandle)[0]!;
      }

      // L19a: `request_command_rerun` is registered ONLY on a Work Run whose
      // prepared manifest carries blocked commands. Review/proposal rounds are
      // read-only and never see it. Its owner is the SAME CRR port the routes
      // publish; a missing owner with a non-empty binding is a wiring error.
      const blockedBinding = manifest.blockedCommands ?? [];
      let commandRerunTool: ((workspace: WorkspaceSandbox) => ToolDefinition) | undefined;
      let commandRerunToolName: string | undefined;
      if (record.run.purpose === undefined && blockedBinding.length > 0) {
        if (deps.commandRerunRequests === undefined) {
          return rejected('unsupported', 'the blocked Work Run requires the commandRerunRequests owner to register its request tool');
        }
        if (deps.unknownCallReviews === undefined) {
          return rejected('unsupported', 'the blocked Work Run requires the unknownCallReviews read port for its shell hook');
        }
        const rerunGroup = createRerunToolGroup({
          requests: deps.commandRerunRequests,
          context: toolContext,
          task: manifest.claim.task,
          requestIdForCall,
        });
        if (!rerunGroup.ok) return rerunGroup.rejection;
        commandRerunToolName = rerunGroup.value.names[0]!;
        commandRerunTool = (workspaceHandle: WorkspaceSandbox): ToolDefinition => rerunGroup.value.create(workspaceHandle)[0]!;
      }

      // L19a "在哪拦": the `before_tool` shell gate for a Work Run with a
      // non-empty binding. It reads the records' current state and the Task's
      // CRRs per `shell` call; a task without a binding installs no hook and
      // pays zero extra reads.
      const shellBlockedHook: HookPort | undefined = blockedBinding.length === 0 || deps.commandRerunRequests === undefined
        || deps.unknownCallReviews === undefined ? undefined : createShellBlockedHook({
        ctx: toolContext,
        runRef,
        taskId: manifest.claim.task.taskId,
        workspace: { projectId: runRef.projectId, workspaceId: record.session.workspaceId },
        binding: blockedBinding,
        reviews: deps.unknownCallReviews,
        requests: deps.commandRerunRequests,
        ...(deps.commandRecognizer === undefined ? {} : { recognizer: deps.commandRecognizer }),
      });

      // 4. A fresh authorization (or the existing authorized binding) still
      //    re-checks the current Role and Host. The accepted Run grant is kept:
      //    the current Host may be wider, but every accepted capability must
      //    still fit both the current Host upper bound and the Role ceiling.
      let roleFacts;
      try {
        // R4/L13: a review-purpose Run resolves its Role with EMPTY declared
        // permissions, so only the Role's declared tool ceiling is skipped; the
        // fixed review tool set is admitted by `reviewRoundAdmissionProblem`
        // below. Every other Run is unchanged.
        roleFacts = await deps.roles.resolveRoleBindingFacts(owned, {
          roleBinding: record.run.roleBinding,
          declaredPermissions: isReviewRoundPurpose(record.run.purpose)
            ? { tools: [], writeScope: [] } : manifest.permissions,
        });
      } catch (error) {
        return rejected('unavailable', `Role resolution failed: ${messageOf(error)}`);
      }
      if (roleFacts.result.status !== 'ready') return mapRead(roleFacts.result);
      let roleResolution;
      try { roleResolution = structuredClone(roleFacts.result.value); } catch { return rejected('invalid', 'the resolved Role cannot be isolated from the caller'); }
      if (!sameRef(roleResolution, manifest.role)) return rejected('forbidden', 'the current Role no longer matches the prepared Role');
      let configured;
      try {
        configured = await deps.host.resolveConfiguration(owned, { runRef, role: manifest.sessionRole, roleResolution });
      } catch (error) {
        return rejected('unavailable', `Host configuration resolution failed: ${messageOf(error)}`);
      }
      if (configured.status !== 'ready') return mapRead(configured);
      const hostConfig = snapshotRuntimeConfiguration(configured.value);
      if (hostConfig.configurationRevision !== manifest.hostConfigurationRevision
        || !sameRef(hostConfig.hostTemplate, manifest.hostTemplate)) {
        return rejected('forbidden', 'the Host configuration revision or template changed since preparation');
      }
      const policyRevisionMatches = manifest.permissions.policyRevision === record.run.roleBinding.policyRevision;
      if (isReviewRoundPurpose(record.run.purpose)) {
        // R4/L13: the review round's fixed tool set and empty write scope, with
        // Host layer 1 still holding and the Role only skipped on its ceiling.
        const admissionProblem = reviewRoundAdmissionProblem({
          purpose: record.run.purpose,
          tools: manifest.permissions.tools,
          writeScope: manifest.permissions.writeScope,
          hostTools: hostConfig.tools,
          readonlyCommandAccess: hostConfig.readonlyCommandAccess ?? null,
          roleValid: roleResolution.status !== 'inadmissible' && sameRef(roleResolution, manifest.role),
        });
        if (!policyRevisionMatches || admissionProblem !== null) {
          return rejected('forbidden', `the review round permissions are not admitted: ${admissionProblem ?? 'policy_revision_mismatch'}`);
        }
      } else {
        const roleCeiling = roleResolution.status === 'resolved' ? roleResolution.spec.permissions : null;
        const hostTools = new Set(hostConfig.tools);
        const ceilingTools = roleCeiling === null ? null : new Set(roleCeiling.tools);
        if (!policyRevisionMatches
          || !manifest.permissions.tools.every(tool => hostTools.has(tool) && (ceilingTools === null || ceilingTools.has(tool)))
          || !manifest.permissions.writeScope.every(path => hostConfig.writeScope.includes(path))
          || (roleCeiling?.writeScope === 'none' && manifest.permissions.writeScope.length !== 0)) {
          return rejected('forbidden', 'the accepted Run permissions no longer fit the current Host and Role ceilings');
        }
      }
      if (signal.aborted) return rejected('cancelled', 'the start was cancelled after the Host configuration read');

      // 5. Resolve the trusted workspace root and Kernel database.
      let rootResolved;
      try {
        rootResolved = await deps.workspaceHost.resolveRoot(workspace);
      } catch (error) {
        return rejected('unavailable', `resolving the workspace root failed: ${messageOf(error)}`);
      }
      // The workspace binding this Run was prepared with always resolves; a
      // non-ready result is a fail-closed refusal, never a re-mapped error code.
      if (rootResolved.status !== 'ready') return rejected('unavailable', rootResolved.reason);
      if (rootResolved.value.workspaceRevision !== record.run.workspaceSnapshot.revision) {
        return rejected('source_stale', 'the workspace revision moved since the Run was prepared');
      }
      const location = deps.kernelStores.byAdapterId(record.session.kernel.adapterId);
      if (!location) return rejected('unsupported', 'the prepared Session is not mapped to a current Kernel store');
      if (!nonEmpty(location.databasePath)) return rejected('unsupported', 'the mapped Kernel store has no database path');

      // 6. Obtain the entry permit: reuse the persisted V2 permit when the Run
      //    is already authorized, otherwise read the current revision and
      //    authorize a fresh grant.
      let permit: TaskEntryPermit;
      if (isV2 && (existingAuth.phase === 'authorized' || resumeEntered)) {
        permit = { claim: manifest.claim, consumerId: existingAuth.consumerId, entryGeneration: existingAuth.generation, authorizationRevision: existingAuth.revision, inputDigest: existingAuth.inputDigest };
        if (existingAuth.consumerId !== consumerId) return rejected('busy', 'another consumer already authorized this Run');
      } else {
        if (record.run.status !== 'starting') return rejected('busy', 'the Run is not awaiting a fresh entry');
        let authorized;
        try {
          authorized = await deps.entry.authorizeRuntimeEntry(owned, {
            input: { prepared, consumerId: consumerId },
            meta: { requestId: `b2-authorize:${requestId}`, expected: [{ ref: runRef, revision: record.run.revision }] },
          });
        } catch (error) {
          return rejected('unavailable', `authorizing the runtime entry failed: ${messageOf(error)}`);
        }
        if (authorized.status !== 'committed') return mapWrite(authorized);
        permit = authorized.value;
      }

      // 7. A fresh begin is the only path that may call the model. Every other
      //    outcome is observed instead of restarted.
      let currentRevision: number = record.run.revision;
      let refreshedPermit: TaskEntryPermit = permit;
      if (!resumeEntered) {
        if (isV2 && existingAuth.phase === 'authorized') {
          currentRevision = record.run.revision;
        } else {
          const afterAuthorize = await deps.executions.readExecution(owned, runRef);
          if (afterAuthorize.status !== 'ready') return mapRead(afterAuthorize);
          currentRevision = afterAuthorize.value.run.revision;
        }
        let begun;
        try {
          begun = await deps.entry.beginRuntimeEntry(owned, {
            input: { permit, kernel: kernelBinding },
            meta: { requestId: `b2-begin:${requestId}`, expected: [{ ref: runRef, revision: currentRevision }] },
          });
        } catch (error) {
          return rejected('unavailable', `beginning the runtime entry failed: ${messageOf(error)}`);
        }
        if (begun.status !== 'committed') return mapWrite(begun);
        if (begun.replayed) return deps.observation.observe(owned, { runRef });
        refreshedPermit = { ...permit, authorizationRevision: begun.value.authorization.revision };
        currentRevision = begun.value.runRevision;
      }

      // 8. Read the trusted session boundary and build this Run's model loop.
      const cursorOwner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });
      let boundary;
      try {
        boundary = await cursorOwner.completedBoundary({ session: record.session, signal });
      } catch (error) {
        return rejected('unavailable', `reading the completed history boundary failed: ${messageOf(error)}`);
      }
      if (boundary.status === 'rejected') return boundary;
      // LA-1 (A.2 step 5.6): the first Run of a continuation Session seeded by `prepare`
      // (`sessionBasis`) continues the ORIGINAL Session's last completed history through
      // `session_history.sourceSessionId`; the interrupted Turn is not in it (the brief covers it).
      const seeded = manifest.sessionBasis !== undefined && manifest.sessionBasis.throughPosition !== null
        && boundary.cursor === null ? manifest.sessionBasis : null;
      const sessionContext = seeded !== null && seeded.throughPosition !== null
        ? { version: 1 as const, mode: 'session_history' as const, throughPosition: seeded.throughPosition,
          sourceSessionId: seeded.sourceKernelSessionId }
        : boundary.cursor === null
          ? { version: 1 as const, mode: 'current_turn' as const }
          : { version: 1 as const, mode: 'session_history' as const, throughPosition: boundary.position };

      // R4.3a: the ONE independent live handle for this fixed Run identity. The
      // caller signal is linked to this own controller so a caller cancel stops
      // the Kernel, but a control cancel aborts only this controller. The
      // entered-fact reads and the post-run reconciliation use their own signal,
      // so a cancel never erases an already-occurred fact.
      const controller = new AbortController();
      const abortFromCaller = (): void => {
        try { controller.abort(owned.signal.reason); } catch { /* an already-aborted controller is fine */ }
      };
      if (owned.signal.aborted) abortFromCaller();
      else owned.signal.addEventListener('abort', abortFromCaller, { once: true });
      const internalSignal = new AbortController().signal;
      // The same finishing context for every already-occurred fact write, its
      // receipt recovery and its revision-conflict re-read: a caller cancel must
      // never erase real evidence that already happened.
      const finishing: CoreCallContext = { ...owned, signal: internalSignal };
      let settleDone!: () => void;
      const done = new Promise<void>((resolve) => { settleDone = resolve; });
      const handle: RuntimeControlHandle = {
        runRef, done, controller,
        ...(resumeEntered && resumePointer !== undefined ? { resumeIntentRef: resumePointer } : {}),
        entry: { consumerId: refreshedPermit.consumerId, entryGeneration: refreshedPermit.entryGeneration,
          sessionGeneration: refreshedPermit.claim.generation },
        kernel: { ...kernelBinding },
        kernelExited: false,
        task: structuredClone(manifest.claim.task),
        sessionRef: structuredClone(manifest.claim.sessionRef),
      };
      waitHandle = handle;
      control?.register(handle);

      const readOnly = manifest.permissions.writeScope.length === 0;
      let enteredFailure: CoreRejection | undefined;
      let enteredDone = resumeEntered;
      const shouldPause = (reason: string): { point: 'before_model'; kind: 'pause'; reason: string } => ({ point: 'before_model', kind: 'pause', reason });

      const enteredHook: HookPort = {
        hookId: 'b2-runtime-entered', point: 'before_model', priority: 1_000_000,
        async execute(): Promise<{ point: 'before_model'; kind: 'continue' } | { point: 'before_model'; kind: 'pause'; reason: string }> {
          if (!enteredDone) {
            let tail;
            try {
              // An already-occurred fact read uses the internal signal: a caller
              // or control cancel must not erase the real entered evidence.
              tail = await readTurnTail(record.session.kernel.adapterId, record.session.kernel.kernelSessionId, kernelBinding, boundary.cursor === null ? 0 : boundary.position, internalSignal);
            } catch (error) {
              enteredFailure = rejected('unavailable', `the Kernel Turn tail could not be read: ${messageOf(error)}`);
              return shouldPause('entered source unavailable');
            }
            const history: ObservedExecutionHistory = {
              kernel: { ...kernelBinding }, startPosition: tail.startPosition,
              observedThroughPosition: tail.position, endPosition: null,
            };
            const kernelSource: KernelObservationSource = { ...kernelBinding, position: tail.position };
            // The entered fact is fixed once per Turn: the SAME request content
            // (requestId/enteredAt/source/history) is reused across recovery and
            // pin retries, so a lost response is reconciled, never duplicated.
            const enteredAt = deps.now();
            const callEntered = async (expectedRevision: number): Promise<WriteResult<RunSnapshot>> => {
              const enteredRequest = {
                input: { permit: refreshedPermit, enteredAt, kernelSource, history },
                meta: { requestId: `b2-entered:${requestId}`, expected: [{ ref: runRef, revision: expectedRevision }] },
              };
              try {
                return await deps.entry.recordExecutionEntered(finishing, enteredRequest);
              } catch (error) {
                // A thrown/lost response is an UNKNOWN result: re-query the exact
                // same request once so the receipt-first replay restores a commit
                // whose acknowledgement was lost, instead of fabricating "did not
                // commit". An explicit returned rejection is a real outcome and is
                // never retried here.
                try { return await deps.entry.recordExecutionEntered(finishing, enteredRequest); }
                catch (retryError) {
                  return rejected('unavailable', `recording the runtime entry failed: ${messageOf(retryError)}`);
                }
              }
            };
            let entered = await callEntered(currentRevision);
            if (entered.status === 'rejected' && entered.code === 'revision_conflict') {
              // A control write advanced the Run after begin. Re-read the SAME
              // entering binding and retry the original fact with the new pin;
              // never guess a new authorization revision or consumer/generation.
              let reread;
              try { reread = await deps.executions.readExecution(finishing, runRef); }
              catch (error) {
                enteredFailure = rejected('unavailable', `the entered retry could not re-read the Run: ${messageOf(error)}`);
                return shouldPause('entered retry failed');
              }
              if (reread.status !== 'ready') {
                enteredFailure = mapRead(reread);
                return shouldPause('entered retry failed');
              }
              const currentRun = reread.value.run;
              const retryAuth = currentRun.executionAuthorization;
              const sameEntering = retryAuth !== undefined && retryAuth.phase === 'entering'
                && retryAuth.consumerId === refreshedPermit.consumerId
                && retryAuth.generation === refreshedPermit.entryGeneration
                && retryAuth.inputDigest === refreshedPermit.inputDigest;
              if (!sameEntering || currentRun.revision === currentRevision) {
                enteredFailure = rejected('revision_conflict', 'the entering binding moved while retrying the entered fact');
                return shouldPause('entered retry rejected');
              }
              entered = await callEntered(currentRun.revision);
            }
            if (entered.status !== 'committed') {
              enteredFailure = mapWrite(entered);
              return shouldPause('entered rejected');
            }
            enteredDone = true;
            currentRevision = entered.value.revision;
            // The entered fact always writes the V2 authorization (run-machine).
            refreshedPermit.authorizationRevision = entered.value.executionAuthorization!.revision;
          }
          // The awaited entered commit may itself have crossed the deadline.
          if (record.run.budget.deadline !== null) {
            const nowMs = Date.parse(deps.now());
            const deadlineMs = Date.parse(record.run.budget.deadline);
            if (!Number.isFinite(nowMs) || !Number.isFinite(deadlineMs) || nowMs >= deadlineMs) {
              enteredFailure = rejected('capacity', 'the persistent task deadline passed before the provider request');
              return shouldPause('deadline passed');
            }
          }
          // R4.3a: after the real entered fact and deadline, the before_model
          // safe point reads the CURRENT canonical Run control pointer and
          // pauses when the accepted intent asks for it. A missing/unknown fact
          // fails closed instead of continuing from a cache.
          const decision = control === undefined ? { kind: 'continue' as const } : await control.decide(owned, runRef);
          if (decision.kind === 'pause') return shouldPause('R4.3a control pause requested');
          return { point: 'before_model', kind: 'continue' };
        },
      };

      const toolPathHook: HookPort = {
        hookId: 'b2-runtime-tool-path', point: 'before_tool', priority: 0,
        async execute(invocation): Promise<{ point: 'before_tool'; kind: 'continue' } | { point: 'before_tool'; kind: 'block'; reason: string }> {
          if (invocation.call.name !== 'read') return { point: 'before_tool', kind: 'continue' };
          const path = isRecord(invocation.call.arguments) ? invocation.call.arguments['path'] : undefined;
          if (typeof path !== 'string' || path.length === 0) return { point: 'before_tool', kind: 'block', reason: 'read requires a workspace-relative path' };
          let authorized;
          try {
            authorized = await deps.workspaceHost.authorize(owned, workspace);
          } catch (error) {
            return { point: 'before_tool', kind: 'block', reason: `the Host read policy could not be verified: ${messageOf(error)}` };
          }
          if (authorized.status !== 'ready' || !authorized.value.allowsRead(path)) {
            return { point: 'before_tool', kind: 'block', reason: 'the Host read policy does not allow this path' };
          }
          return { point: 'before_tool', kind: 'continue' };
        },
      };

      const meter = new ModelBudget(hostConfig.budget, async () => { /* usage is held in memory for this Run */ },
        hostConfig.model.inputCounter, record.run.budget, deps.now);
      const modelCalls = createRuntimeModelCallAccess({ modelRequests: deps.modelRequests, executions: deps.executions, now: deps.now, newId: deps.newId, context: owned, permit: refreshedPermit });
      try {
        await modelCalls.bind({
          inputDigest: (prepared.inputBinding as RuntimeInputBindingV1).inputDigest,
          manifestDigest: bundleRef.digest,
          materialAccessRefs: manifest.materialAccessRefs,
          additionalMaterialRefs: manifest.additionalMaterialRefs,
        });
      } catch (error) {
        if (error instanceof RuntimeModelCallRejected) return rejected(error.code, error.message);
        return rejected('unavailable', `binding the exact input failed: ${messageOf(error)}`);
      }

      // The trusted Host read policy gates the builtin/source read tools and is
      // re-checked at the provider boundary; a changed permission revision or
      // root fails the loop instead of silently reading under an old grant. A
      // Run whose effective tools contain no `read` never resolves the source
      // read policy, never opens the frozen source factory and never installs an
      // `assertCurrent`; platform-only work must not depend on a file read grant.
      let sourceTools: SourceToolOptions | undefined;
      let sourceFactory: RuntimeSourceCaptureFactory | undefined;
      // L18: only a Run with an empty write scope may see the read-only process
      // tool. It is registered only when the Host selected it, the explicit
      // `readonlyCommandAccess` grant is present and the current read is the
      // whole workspace; a Run with writes keeps `shell` instead.
      const readonlyRequested = readOnly && manifest.permissions.tools.includes(READONLY_COMMAND_TOOL_NAME);
      let currentAuthorization: Awaited<ReturnType<typeof deps.workspaceHost.authorize>> | undefined;
      if (hasFileRead || readonlyRequested) {
        try {
          currentAuthorization = await deps.workspaceHost.authorize(owned, workspace);
        } catch (error) {
          return rejected('unavailable', `the Host read policy could not be resolved: ${messageOf(error)}`);
        }
        if (currentAuthorization.status !== 'ready') return rejected('unavailable', currentAuthorization.reason);
      }
      if (hasFileRead && currentAuthorization !== undefined && currentAuthorization.status === 'ready') {
        const granted = currentAuthorization;
        const permissionRevision = granted.value.permissionRevision;
        sourceTools = {
          allowedPath: (path: string) => granted.value.allowsRead(path),
          assertCurrent: async () => {
            const current = await deps.workspaceHost.authorize(owned, workspace);
            if (current.status !== 'ready' || current.value.permissionRevision !== permissionRevision) {
              throw new Error('the Host read policy is no longer current for this Run');
            }
          },
          ...(deps.sourceAnalyzers === undefined ? {} : { sourceAnalyzers: deps.sourceAnalyzers }),
        };
        sourceFactory = createRuntimeSourceCaptureFactory(
          { authority: deps.sourceAuthority, ...(deps.sourcePolicyFor === undefined ? {} : { sourcePolicyFor: deps.sourcePolicyFor }), hostSignal: signal, now: deps.now },
          { projectId: runRef.projectId, workspaceId: record.session.workspaceId, goalId: runRef.goalId, runId: runRef.runId, taskId: manifest.claim.task.taskId, root: rootResolved.value.root },
          prepared.envelope,
        );
      }
      // U5: the ONE shared read-only command construction; the shared function
      // applies the same L18 layer-1 gate and keeps this Run's authorization
      // choice (the Host read re-check at every launch).
      const readonlyCommandTool = registerReadonlyCommandTool({
        requested: readonlyRequested,
        access: hostConfig.readonlyCommandAccess,
        authorization: currentAuthorization?.status === 'ready' ? currentAuthorization.value : undefined,
        workspaceRoot: rootResolved.value.root,
        processSandboxOptions: hostConfig.processSandboxOptions,
        ...(deps.resourceCaps === undefined ? {} : { resourceCaps: deps.resourceCaps }),
        authorizeCurrent: () => deps.workspaceHost.authorize(owned, workspace),
      });

      // R4.3a real tool-group safe point: it reads the CURRENT canonical Run and
      // the accepted control intent. A cancel aborts this handle's own
      // controller; a pause is committed by the Kernel at this real boundary.
      // The barrier first honors the canonical control (pause/cancel) and then a
      // real wait registration. A yield is only requested AFTER the current tool
      // group drained, so the saved send result is already in the transcript and
      // no un-settled side effect is silently dropped.
      const toolGroupBarrier: ToolGroupBarrier = async (invocation) => {
        if (invocation.runId !== kernelBinding.runId || invocation.turnId !== kernelBinding.turnId) {
          return { kind: 'pause' };
        }
        if (control !== undefined) {
          const decision = await control.decide(owned, runRef);
          if (decision.kind === 'pause') return { kind: 'pause' };
        }
        if (invocation.point === 'after_group' && waitRegistered !== null) {
          return { kind: 'yield', reason: 'reply_required' };
        }
        return { kind: 'continue' };
      };

      try {
        try {
          // One unified input channel: ordinary mail, saved replies, steer and
          // mechanical attention are read here and only REALLY accepted by the
          // Kernel run.input_accepted commit.
          const controlInputsFor: InputSupply = async (point, options) => {
            const inputs = await control?.inputs({ ...owned, signal: options.signal }, runRef) ?? [];
            return inputs.flatMap(intent => {
              const inputId = `control:${sha256Hex(canonicalJson(intent.ref as never))}`;
              return point.acceptedInputIds.includes(inputId) || intent.reason === null ? [] : [{ inputId, text: intent.reason, sourceRef: { kind: 'ControlIntent', intentRef: intent.ref } }];
            });
          };
          // K3 L13: a review/proposal round has no collaboration tools, so it
          // builds ONLY the control-input channel; Session letters and saved
          // replies stay for the later continuation. Every ordinary Work Run
          // keeps the mailbox channel unchanged.
          const reviewRoundPurpose = record.run.purpose?.kind === 'unknown_call_review';
          const inputSupply: InputSupply | undefined = reviewRoundPurpose
            ? createControlOnlyInputSupply(controlInputsFor)
            : deps.messages === undefined ? undefined : createMailboxInputSupply({
              messages: deps.messages,
              context: () => toolContext,
              sessionRef,
              runRef,
              controlInputs: controlInputsFor,
              // A continuation still owns the prior yielded Run's saved reply; the
              // exact original message identity is read Session-scoped.
              ...(record.run.consumedWait === undefined ? {} : { consumedWait: { runRef: record.run.consumedWait.runRef, messageRef: record.run.consumedWait.messageRef } }),
            });
          await runObservedModel({
            kernel: deps.kernel, bound: hostConfig.model, meter, root: rootResolved.value.root, databasePath: location.databasePath,
            sessionId: record.session.kernel.kernelSessionId, input: manifest.input, budget: hostConfig.budget, readOnly,
            taskBudget: record.run.budget, sessionContext, executionIdentity: { runId: kernelBinding.runId, turnId: kernelBinding.turnId },
            ...(inputSupply === undefined ? {} : { inputSupply }),
            now: deps.now, signal: controller.signal, deniedPrefixes: hostConfig.deniedPrefixes, modelCalls, manifestDigest: bundleRef.digest,
            allowedTools: builtinTools,
            ...(coordinationTools === null ? {} : { coordinationTools }),
            ...(readonlyCommandTool === undefined ? {} : { readonlyCommandTool }),
            ...(unknownCallReviewTool === undefined ? {} : { unknownCallReviewTool }),
            ...(unknownCallReviewToolName === undefined ? {} : { unknownCallReviewToolName }),
            ...(commandRerunTool === undefined ? {} : { commandRerunTool }),
            ...(commandRerunToolName === undefined ? {} : { commandRerunToolName }),
            // The file path check is only installed when `read` is actually
            // granted; an ungranted builtin read is rejected by the Kernel as an
            // unknown tool and must never open the source read policy.
            controlHooks: [
              enteredHook,
              ...(hasFileRead ? [toolPathHook] : []),
              ...(shellBlockedHook === undefined ? [] : [shellBlockedHook]),
            ],
            skills: hostConfig.skills,
            ...(hostConfig.systemInstruction === null ? {} : { systemInstruction: hostConfig.systemInstruction }),
            processSandboxOptions: hostConfig.processSandboxOptions,
            ...(deps.resourceCaps === undefined ? {} : { resourceCaps: deps.resourceCaps }),
            ...(sourceTools === undefined ? {} : { sourceTools }),
            ...(sourceFactory === undefined ? {} : { projectSource: { mode: 'frozen' as const, open: sourceFactory, openOn: 'first_use' as const } }),
            ...(toolGroupBarrier === undefined ? {} : { toolGroupBarrier }),
            // The cleanup proof is published by the ONE existing finally after
            // every owned resource was attempted and awaited. It is a private
            // handle fact, never a public ack.
            onResourcesClosed: (result) => { handle.resourcesClosed = result; },
            // The two proofs stay separate: `kernelExited` fires synchronously
            // from the real Kernel return/throw, before any owned cleanup;
            // `resourcesClosed` fires after every owned resource was attempted
            // and awaited. Neither is forwarded to the Kernel/model.
            onKernelExited: () => { handle.kernelExited = true; },
            publish: async () => { /* best-effort live events are never terminal evidence */ },
          });
        } catch (error) {
          // A model/provider failure is reconciled from the genuine history below;
          // it is never interpreted as a terminal by itself.
          if (error instanceof RuntimeModelCallRejected) {
            enteredFailure ??= rejected(error.code, error.message);
          }
        }
        // The already-occurred fact is reconciled along the ORIGINAL observer
        // even when the fresh action failed or the caller cancelled: the concrete
        // failure is chosen only after that reconciliation, never by skipping it.
        // The reconcile uses a platform-internal cleanup signal, never the
        // already-aborted caller signal, and never a best-effort hook.
        const reconcileSignal = new AbortController().signal;
        const reconciled = await deps.observation.observe({ ...owned, signal: reconcileSignal }, { runRef });
        // RUN-16, in process (A.2 step 5.6, §12.2 "进程内的同类收尾"): the Kernel call exited with every
        // owned resource closed before the fixed Turn started; the readable Kernel holds no Turn of the
        // fixed identity, so the binding is revoked and the same claim re-authorizes (RUN-03) later.
        if (!enteredDone && deps.runReconcile !== undefined && handle.kernelExited && handle.resourcesClosed?.status === 'completed') {
          await revokeNotEntered({ ...owned, signal: reconcileSignal }, runRef, record.session.kernel.adapterId,
            record.session.kernel.kernelSessionId, kernelBinding, boundary.cursor === null ? 0 : boundary.position);
        }
        if (enteredFailure !== undefined) return enteredFailure;
        return reconciled;
      } finally {
        handle.settled = true;
        settleDone();
        owned.signal.removeEventListener('abort', abortFromCaller);
      }
    },
  };

  /**
   * RUN-16's in-process proof (`live_clean`): the Run is still `Entering` and
   * the Kernel Session after the last completed boundary holds no
   * `turn.started` of the fixed identity. Any read failure proves nothing and
   * leaves the Run for the start-up reconcile.
   */
  async function revokeNotEntered(
    ctx: CoreCallContext, runRef: RunRef, adapterId: string, kernelSessionId: string, kernel: KernelExecutionBinding,
    afterPosition: number,
  ): Promise<void> {
    const reconcile = deps.runReconcile;
    if (reconcile === undefined) return;
    let read;
    try { read = await deps.executions.readExecution(ctx, runRef); } catch { return; }
    if (read.status !== 'ready') return;
    const auth = read.value.run.executionAuthorization;
    if (read.value.run.status !== 'starting' || auth === undefined
      || auth.phase !== 'entering') {
      return;
    }
    let started: boolean;
    try {
      started = await deps.kernelStores.withStore(adapterId, async (reader: KernelSessionReader) => {
        const head = await reader.read(kernelSessionId, 0, 1, { signal: ctx.signal });
        if (head.records.length === 0) throw new Error('the Kernel Session has no position-1 history');
        const page = await reader.read(kernelSessionId, afterPosition, 200, { signal: ctx.signal });
        return page.records.some(candidate => candidate.recordType === 'turn.started'
          && isRecord(candidate.payload) && isRecord(candidate.payload['run'])
          && candidate.payload['run']['runId'] === kernel.runId
          && isRecord(candidate.payload['run']['turn']) && candidate.payload['run']['turn']['turnId'] === kernel.turnId);
      });
    } catch { return; }
    if (started) return;
    try {
      await reconcile.reconcileRun(ctx, { input: { runRef, basis: { kind: 'live_clean' }, probe: 'ready',
        result: { kind: 'not_entered', kernel: { ...kernel } } },
      meta: { requestId: `a2-run16:${runRef.runId}:${String(auth.generation)}`,
        expected: [{ ref: runRef, revision: read.value.run.revision }] } });
    } catch { /* the Run stays Entering; the start-up reconcile proves it (W-05) */ }
  }

  /** Read the real Kernel tail and the fixed turn.started position after the
   * Kernel persisted the Turn; the driver never invents a position. */
  async function readTurnTail(
    adapterId: string, kernelSessionId: string, kernel: KernelExecutionBinding, afterPosition: number, signal: AbortSignal,
  ): Promise<{ startPosition: number; position: number }> {
    const use = async (reader: KernelSessionReader) => {
      const head = await reader.read(kernelSessionId, 0, 1, { signal });
      if (head.records.length === 0) throw new Error('the Kernel Session has no position-1 history');
      // The new Turn's records all start after the last completed boundary, so
      // this bounded read cannot silently miss the fixed turn.started.
      const page = await reader.read(kernelSessionId, afterPosition, 200, { signal });
      const turnStart = page.records.find(candidate => candidate.recordType === 'turn.started'
        && isRecord(candidate.payload) && isRecord(candidate.payload['run'])
        && candidate.payload['run']['runId'] === kernel.runId
        && isRecord(candidate.payload['run']['turn']) && candidate.payload['run']['turn']['turnId'] === kernel.turnId);
      if (turnStart === undefined) throw new Error('the fixed turn.started record was not persisted');
      return { startPosition: turnStart.position, position: page.lastPosition };
    };
    return deps.kernelStores.withStore(adapterId, use);
  }
}
