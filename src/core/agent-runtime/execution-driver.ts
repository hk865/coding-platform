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
import type { PreparedTaskExecution } from '../../contracts/core/prepared-execution.js';
import type { RunRef, RunSnapshot, RuntimeInputBindingV1 } from '../../contracts/dispatch.js';
import type { RunExecutionHistoryV1 } from '../../contracts/core/execution-history.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { GoalRef, WorkspaceRef } from '../../contracts/ledger.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type {
  HookPort, SqliteStores, ToolCall, ToolDefinition, ToolGroupBarrier, WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import { runObservedModel } from './observed-model-run.js';
import type { SourceToolOptions } from './exploration-tools.js';
import type { RuntimeSourceCaptureFactory } from './source-tool-ports.js';
import { createSessionMailboxTools, SESSION_MAILBOX_TOOL_NAMES } from './communication-tools.js';
import { createWhiteboardTools, WHITEBOARD_TOOL_NAMES } from './whiteboard-tools.js';
import { ModelBudget } from './model-budget.js';
import { createRuntimeModelCallAccess, RuntimeModelCallRejected } from './model-call-access.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';
import { loadPreparedManifest, snapshotRuntimeConfiguration } from './execution-preparation.js';
import { createRuntimeSourceCaptureFactory } from './source-capture-access.js';
import type { SessionMailboxPort } from '../work-graph/communication/contracts.js';
import type { PlanTaskPort } from '../work-graph/tasks/plan-contracts.js';
import type { ExecutionObservationService } from './execution-observation.js';
import type { RuntimeControlCoordinator, RuntimeControlHandle } from './execution-control.js';
import type {
  ExecutionEntryPort, KernelExecutionBinding, KernelObservationSource, ObservedExecutionHistory, TaskEntryPermit,
} from '../work-graph/tasks/execution-entry-contracts.js';
import type {
  StartTaskExecutionRequest, RuntimeExecutionDependencies, TaskExecutionRecord,
} from './execution-contracts.js';

export type ExecutionDriverDependencies = Pick<RuntimeExecutionDependencies,
  | 'entry' | 'historyWriter' | 'executions' | 'sessionOperations' | 'kernelStores' | 'workspaceHost'
  | 'sourceAuthority' | 'sourcePolicyFor' | 'host' | 'kernel' | 'now' | 'newId'
  | 'modelRequests' | 'roles' | 'materials' | 'bodies' | 'plans' | 'messages'> & {
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

/** The frozen C1 + W2 platform coordination tool names. Declaring a name here
 * grants nothing: the real selection set is the manifest/Role/Host intersection
 * re-checked above. */
const PLATFORM_COORDINATION_TOOL_NAMES = new Set<string>([...SESSION_MAILBOX_TOOL_NAMES, ...WHITEBOARD_TOOL_NAMES]);

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Builtin Kernel file/process tools. The platform coordination tools below are
 * extension tools and are never file/read/shell capabilities. */
const BUILTIN_TOOL_NAMES = new Set<string>(['read', 'write', 'shell']);
/** Names the coordination factories must never collide with. Declaring a name
 * here still grants nothing; this is an assembly guard only. */
const RESERVED_TOOL_NAMES = new Set<string>([
  ...BUILTIN_TOOL_NAMES, 'edit', 'check', 'list_files', 'search', 'symbols', 'code_index',
  'project_source', 'project_index', 'python_index', 'cpp_index', 'source_excerpt', 'read_source', 'read_material',
]);

type CoordinationTools = { names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] };

/**
 * Filter the two already-reviewed factories down to the effective manifest
 * intersection. An unknown selected name or a selected platform tool whose
 * dependency is unbound fails closed here, before any provider, authorize/begin
 * write or new-entry Host call. The returned `names` and the actual definitions
 * are kept one-to-one; a factory product mismatch throws so the Kernel run
 * aborts before the first provider call.
 */
function selectCoordinationTools(input: {
  selected: readonly string[];
  mailbox: SessionMailboxPort | undefined;
  plans: PlanTaskPort;
  context: CoreCallContext;
  sessionRef: SessionRef;
  goalRef: GoalRef;
  requestIdForCall: (call: Readonly<ToolCall>) => string;
}): { ok: true; value: CoordinationTools | null } | { ok: false; rejection: CoreRejection } {
  const unknown = input.selected.filter(name => !BUILTIN_TOOL_NAMES.has(name) && !PLATFORM_COORDINATION_TOOL_NAMES.has(name));
  if (unknown.length > 0) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects tool names this Runtime does not know: ${[...new Set(unknown)].join(', ')}`) };
  }
  const wanted = new Set(input.selected);
  const mailboxNames = SESSION_MAILBOX_TOOL_NAMES.filter(name => wanted.has(name));
  const whiteboardNames = WHITEBOARD_TOOL_NAMES.filter(name => wanted.has(name));
  if (mailboxNames.length === 0 && whiteboardNames.length === 0) return { ok: true, value: null };
  if (mailboxNames.length > 0 && input.mailbox === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects communication tools but no SessionMailbox dependency is bound: ${mailboxNames.join(', ')}`) };
  }
  const handles: Array<{ names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] }> = [];
  if (mailboxNames.length > 0) {
    handles.push(createSessionMailboxTools({
      mailbox: input.mailbox as SessionMailboxPort,
      context: input.context,
      sessionRef: input.sessionRef,
      requestIdForCall: input.requestIdForCall,
    }));
  }
  if (whiteboardNames.length > 0) {
    handles.push(createWhiteboardTools({
      plans: input.plans,
      context: input.context,
      goalRef: input.goalRef,
      requestIdForCall: input.requestIdForCall,
    }));
  }
  const names = [...mailboxNames, ...whiteboardNames];
  if (new Set(names).size !== names.length) {
    return { ok: false, rejection: rejected('unsupported', 'the selected coordination tool names are duplicated') };
  }
  if (names.some(name => RESERVED_TOOL_NAMES.has(name))) {
    return { ok: false, rejection: rejected('unsupported', 'a coordination tool name collides with a builtin, exploration or material tool') };
  }
  return {
    ok: true,
    value: {
      names,
      create: (workspace: WorkspaceSandbox): ToolDefinition[] => {
        const definitions = handles.flatMap(handle => handle.create(workspace)).filter(definition => wanted.has(definition.name));
        const produced = definitions.map(definition => definition.name);
        if (produced.length !== names.length || new Set(produced).size !== produced.length
          || names.some(name => !produced.includes(name))) {
          throw new Error('the coordination tool factory did not produce exactly the selected definitions');
        }
        return definitions;
      },
    },
  };
}
function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as never) === canonicalJson(right as never); } catch { return false; }
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
const CORE_ERROR_CODES = new Set<string>(['invalid','forbidden','not_found','source_stale','capacity','unsupported','unavailable','cancelled']);
function mapWorkspace(result: { status: 'rejected'; code: string; reason: string }): CoreRejection {
  return rejected((CORE_ERROR_CODES.has(result.code) ? result.code : 'unavailable') as CoreRejection['code'], result.reason);
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
      const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: runRef.projectId, workspaceId: record.session.workspaceId };

      // 2. Fix the Kernel run/turn identity. A prior begin binding is reused
      //    verbatim; a fresh Run derives a stable identity from the claim so a
      //    lost begin response cannot create a second Turn.
      const existingAuth = record.run.executionAuthorization;
      const isV2 = existingAuth !== undefined && 'schemaVersion' in existingAuth && existingAuth.schemaVersion === 2;
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

      // 3. An already begun/entered/settled Run is only observed. Observation
      //    needs the formal identity and the fixed Run/claim/Kernel association,
      //    not a fresh authorization for a new model action; the current Host
      //    may already have revoked new execution.
      if (isV2 && existingAuth.phase !== 'authorized') {
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
        materialReader: {
          kind: 'run', requester: runRef,
          ...(manifest.materialBasis === null ? {} : { currentBasis: structuredClone(manifest.materialBasis) }),
        },
        signal,
      };
      const requestIdForCall = (call: Readonly<ToolCall>): string => {
        if (!nonEmpty(call.callId) || !nonEmpty(call.name)) throw new Error('the Kernel tool call carries no trusted identity');
        return 'c2-tool:' + sha256Hex(canonicalJson({ runRef, sessionRef, operation: call.name, callId: call.callId } as never));
      };
      const coordination = selectCoordinationTools({
        selected: manifest.permissions.tools,
        mailbox: deps.messages,
        plans: deps.plans,
        context: toolContext,
        sessionRef,
        goalRef,
        requestIdForCall,
      });
      if (!coordination.ok) return coordination.rejection;
      const coordinationTools = coordination.value;

      // 4. A fresh authorization (or the existing authorized binding) still
      //    re-checks the current Role and Host. The accepted Run grant is kept:
      //    the current Host may be wider, but every accepted capability must
      //    still fit both the current Host upper bound and the Role ceiling.
      let roleFacts;
      try {
        roleFacts = await deps.roles.resolveRoleBindingFacts(owned, { roleBinding: record.run.roleBinding, declaredPermissions: manifest.permissions });
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
      const roleCeiling = roleResolution.status === 'resolved' ? roleResolution.spec.permissions : null;
      const hostTools = new Set(hostConfig.tools);
      const ceilingTools = roleCeiling === null ? null : new Set(roleCeiling.tools);
      if (manifest.permissions.policyRevision !== record.run.roleBinding.policyRevision
        || !manifest.permissions.tools.every(tool => hostTools.has(tool) && (ceilingTools === null || ceilingTools.has(tool)))
        || !manifest.permissions.writeScope.every(path => hostConfig.writeScope.includes(path))
        || (roleCeiling?.writeScope === 'none' && manifest.permissions.writeScope.length !== 0)) {
        return rejected('forbidden', 'the accepted Run permissions no longer fit the current Host and Role ceilings');
      }
      if (signal.aborted) return rejected('cancelled', 'the start was cancelled after the Host configuration read');

      // 5. Resolve the trusted workspace root and Kernel database.
      let rootResolved;
      try {
        rootResolved = await deps.workspaceHost.resolveRoot(workspace);
      } catch (error) {
        return rejected('unavailable', `resolving the workspace root failed: ${messageOf(error)}`);
      }
      if (rootResolved.status !== 'ready') return mapWorkspace(rootResolved);
      if (rootResolved.value.workspaceRevision !== record.run.workspaceSnapshot.revision) {
        return rejected('source_stale', 'the workspace revision moved since the Run was prepared');
      }
      const location = deps.kernelStores.byAdapterId(record.session.kernel.adapterId);
      if (!location || 'expectedSessionId' in location) return rejected('unsupported', 'the prepared Session is not mapped to a current Kernel store');
      if (!nonEmpty(location.databasePath)) return rejected('unsupported', 'the mapped Kernel store has no database path');

      // 6. Obtain the entry permit: reuse the persisted V2 permit when the Run
      //    is already authorized, otherwise read the current revision and
      //    authorize a fresh grant.
      let permit: TaskEntryPermit;
      if (isV2 && existingAuth.phase === 'authorized') {
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
      let currentRevision: number;
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
      const refreshedPermit: TaskEntryPermit = { ...permit, authorizationRevision: begun.value.authorization.revision };
      currentRevision = begun.value.runRevision;

      // 8. Read the trusted session boundary and build this Run's model loop.
      const cursorOwner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });
      let boundary;
      try {
        boundary = await cursorOwner.completedBoundary({ session: record.session, signal });
      } catch (error) {
        return rejected('unavailable', `reading the completed history boundary failed: ${messageOf(error)}`);
      }
      if (boundary.status === 'rejected') return boundary;
      const sessionContext = boundary.cursor === null
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
        entry: { consumerId: refreshedPermit.consumerId, entryGeneration: refreshedPermit.entryGeneration,
          sessionGeneration: refreshedPermit.claim.generation },
        kernel: { ...kernelBinding },
        kernelExited: false,
      };
      control?.register(handle);

      const readOnly = manifest.permissions.writeScope.length === 0;
      let enteredFailure: CoreRejection | undefined;
      let enteredDone = false;
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
              const sameEntering = retryAuth !== undefined && 'schemaVersion' in retryAuth
                && retryAuth.schemaVersion === 2 && retryAuth.phase === 'entering'
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
            const enteredAuth = entered.value.executionAuthorization;
            if (enteredAuth !== undefined && 'schemaVersion' in enteredAuth && enteredAuth.schemaVersion === 2) {
              refreshedPermit.authorizationRevision = enteredAuth.revision;
            }
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
      if (hasFileRead) {
        let currentAuthorization;
        try {
          currentAuthorization = await deps.workspaceHost.authorize(owned, workspace);
        } catch (error) {
          return rejected('unavailable', `the Host read policy could not be resolved: ${messageOf(error)}`);
        }
        if (currentAuthorization.status !== 'ready') return mapWorkspace(currentAuthorization);
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
        };
        sourceFactory = createRuntimeSourceCaptureFactory(
          { authority: deps.sourceAuthority, ...(deps.sourcePolicyFor === undefined ? {} : { sourcePolicyFor: deps.sourcePolicyFor }), hostSignal: signal, now: deps.now },
          { projectId: runRef.projectId, workspaceId: record.session.workspaceId, goalId: runRef.goalId, runId: runRef.runId, taskId: manifest.claim.task.taskId, root: rootResolved.value.root },
          prepared.envelope,
        );
      }

      // R4.3a real tool-group safe point: it reads the CURRENT canonical Run and
      // the accepted control intent. A cancel aborts this handle's own
      // controller; a pause is committed by the Kernel at this real boundary.
      const toolGroupBarrier: ToolGroupBarrier | undefined = control === undefined ? undefined
        : async (invocation) => {
            if (invocation.runId !== kernelBinding.runId || invocation.turnId !== kernelBinding.turnId) {
              return { kind: 'pause' };
            }
            return control.decide(owned, runRef);
          };

      try {
        try {
          await runObservedModel({
            kernel: deps.kernel, bound: hostConfig.model, meter, root: rootResolved.value.root, databasePath: location.databasePath,
            sessionId: record.session.kernel.kernelSessionId, input: manifest.input, budget: hostConfig.budget, readOnly,
            taskBudget: record.run.budget, sessionContext, executionIdentity: { runId: kernelBinding.runId, turnId: kernelBinding.turnId },
            now: deps.now, signal: controller.signal, deniedPrefixes: hostConfig.deniedPrefixes, modelCalls, manifestDigest: bundleRef.digest,
            allowedTools: builtinTools,
            ...(coordinationTools === null ? {} : { coordinationTools }),
            // The file path check is only installed when `read` is actually
            // granted; an ungranted builtin read is rejected by the Kernel as an
            // unknown tool and must never open the source read policy.
            controlHooks: hasFileRead ? [enteredHook, toolPathHook] : [enteredHook],
            skills: hostConfig.skills,
            ...(hostConfig.systemInstruction === null ? {} : { systemInstruction: hostConfig.systemInstruction }),
            processSandboxOptions: hostConfig.processSandboxOptions,
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
        if (enteredFailure !== undefined) return enteredFailure;
        return reconciled;
      } finally {
        handle.settled = true;
        settleDone();
        owned.signal.removeEventListener('abort', abortFromCaller);
      }
    },
  };

  /** Read the real Kernel tail and the fixed turn.started position after the
   * Kernel persisted the Turn; the driver never invents a position. */
  async function readTurnTail(
    adapterId: string, kernelSessionId: string, kernel: KernelExecutionBinding, afterPosition: number, signal: AbortSignal,
  ): Promise<{ startPosition: number; position: number }> {
    const location = deps.kernelStores.byAdapterId(adapterId);
    if (!location || 'expectedSessionId' in location) throw new Error('the Kernel adapter is not a current registered store');
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
