/**
 * R4.3a local control coordinator (implementation).
 *
 * This is the ONE internal coordinator the Runtime assembles. It owns the narrow
 * live-handle map, resolves the exact accepted intent, drives the fixed local
 * driver at a real safe point and exposes the private exit/cleanup proof the
 * original observer must read before it releases anything. It is intentionally
 * NOT a second execution engine and never persists independent state:
 * `submitControl`/`readControl` stay in the raw WorkGraph control service and
 * the original Kernel history stays the only transcript.
 *
 * The safe-point decision reads the CURRENT canonical Run through the already
 * assembled `sourceAuthority` and the exact intent through the SAME raw control
 * service. A missing/unavailable read fails closed (pause), never a cached
 * continue. A cancel only aborts the handle's OWN controller; the fact write
 * and the post-run reconciliation stay on the tracked public promise.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type {
  ControlEntryIdentityV1, ControlIntentRef, ControlIntentSnapshotV1,
} from '../../contracts/control-intent.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { RunContinuationV1, RunRef, RunSnapshot, TaskTriple } from '../../contracts/dispatch.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import type { ControlObservationPort, RunControlPort } from '../work-graph/tasks/control-contracts.js';
import type { KernelExecutionBinding } from '../work-graph/tasks/execution-entry-contracts.js';
import type { SourceSnapshotReads } from '../work-graph/source-authority-ports.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { SessionMessage } from '../work-graph/communication/contracts.js';
import type { DeliverControlRequest } from './execution-contracts.js';
import type { RuntimeResourceCloseResult } from './observed-model-run.js';

export type RuntimeControlCoordinatorDependencies = {
  /** The SAME raw control service the composition root owns (optional). */
  controls?: RunControlPort & ControlObservationPort;
  /**
   * The SAME exact-Run reader the Runtime already holds. The safe point reads
   * the current canonical `controlState` from here; it is never a cache.
   */
  sourceAuthority?: () => SourceSnapshotReads;
};

/**
 * One live local execution handle. It keeps the full RunRef, the fixed
 * consumer/entry/session generations, the fixed Kernel binding, the independent
 * AbortController, the original tracked `done` promise, the actually consumed
 * intent and the real resource-close result.
 */
export type RuntimeControlHandle = {
  runRef: RunRef;
  /** The existing tracked execution promise that owns this handle. */
  done: Promise<unknown>;
  entry: ControlEntryIdentityV1;
  kernel: KernelExecutionBinding;
  controller: AbortController;
  /** Set by the model loop's `onResourcesClosed` once every owned resource is
   * actually closed; absent means the cleanup proof is not available yet. */
  resourcesClosed?: RuntimeResourceCloseResult;
  /** Set once the Kernel call itself returned (before or with cleanup). */
  kernelExited: boolean;
  /** Set once the driver's own tracked start/reconcile promise settled. */
  settled?: boolean;
  /** The exact intent this handle consumed, if any. */
  intentRef?: ControlIntentRef;
  resumeIntentRef?: ControlIntentRef;
  /** The original claim Task/Session; used to build a real yield continuation. */
  task?: TaskTriple;
  sessionRef?: SessionRef;
  /** The exact durably-saved waitAfterSend message this Run registered, if any. */
  waitMessage?: SessionMessage;
};

/** The private exit/cleanup proof the observer reads before any positive ack. */
export type RuntimeControlProof = {
  kernelExited: boolean;
  resourcesClosed?: RuntimeResourceCloseResult;
  consumedIntentRef?: ControlIntentRef;
  resumeIntentRef?: ControlIntentRef;
};

export type RuntimeControlDecision = { kind: 'continue' } | { kind: 'pause' };

/**
 * The read-only verdict a narrow long-running tool (the replyMode wait) may
 * observe. It NEVER consumes the intent, associates a handle or aborts a
 * controller; it only lets the tool yield to the original tool-group barrier,
 * which performs the real consuming decision.
 */
export type RuntimeControlInspection = { kind: 'continue' } | { kind: 'pause' } | { kind: 'cancel' };

export type RuntimeControlCoordinator = {
  /** Read the accepted intent and consume it only at a real local safe point. */
  deliver(ctx: CoreCallContext, request: DeliverControlRequest): Promise<ReadResult<ControlIntentSnapshotV1>>;
  /** Register one live handle before the external Kernel call. */
  register(handle: RuntimeControlHandle): RuntimeControlHandle;
  /** The private cleanup proof the original observer must consult before a
   * positive pause/cancel conclusion. `undefined` means "not proven". */
  proof(runRef: RunRef): RuntimeControlProof | undefined;
  /**
   * The durable platform continuation of a handle that really registered a wait:
   * the original Task/Session plus the exact saved message. It is a projection of
   * already-happened facts, never a permission to start a Run.
   */
  inputs(ctx: CoreCallContext, runRef: RunRef): Promise<ControlIntentSnapshotV1[]>;
  continuation(runRef: RunRef): RunContinuationV1 | undefined;
  /**
   * The real safe-point decision over the current canonical Run controlState.
   * Missing/unavailable facts fail closed; a cancel aborts this handle's own
   * controller and lets the Kernel's own signal check win.
   */
  decide(ctx: CoreCallContext, runRef: RunRef): Promise<RuntimeControlDecision>;
  /**
   * Read the CURRENT canonical Run control pointer WITHOUT any side effect. A
   * pause/cancel is reported so a narrow tool can yield; the intent is left for
   * the existing barrier. Missing/unavailable facts keep the historical
   * 'continue' (the barrier still fails closed at its own real safe point).
   */
  inspect(ctx: CoreCallContext, runRef: RunRef): Promise<RuntimeControlInspection>;
  /** Drain the coordinator without starting any background recovery. */
  close(): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isControlIntentRef(value: unknown): value is ControlIntentRef {
  return isRecord(value) && value['aggregateType'] === 'ControlIntent'
    && nonEmpty(value['projectId']) && nonEmpty(value['workspaceId']) && nonEmpty(value['intentId']);
}
function isRunRef(value: unknown): value is RunRef {
  return isRecord(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as never) === canonicalJson(right as never); } catch { return false; }
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRuntimeControlCoordinator(
  deps: RuntimeControlCoordinatorDependencies,
): RuntimeControlCoordinator {
  const handles = new Map<string, RuntimeControlHandle>();
  // The key is the FULL canonical RunRef. A serialization failure never
  // degrades to the bare runId: such a handle is simply not addressable.
  const keyOf = (runRef: RunRef): string | null => {
    try { return canonicalJson(runRef as never); } catch { return null; }
  };
  const unsupported = (reason: string): ReadResult<ControlIntentSnapshotV1> =>
    ({ status: 'rejected', code: 'unsupported', reason });
  /** True while the live Kernel call can still actually receive a signal. */
  const handleLive = (handle: RuntimeControlHandle): boolean =>
    handle.kernelExited !== true && handle.settled !== true;

  return {
    async deliver(
      ctx: CoreCallContext,
      request: DeliverControlRequest,
    ): Promise<ReadResult<ControlIntentSnapshotV1>> {
      const controls = deps.controls;
      if (controls === undefined) return unsupported('control delivery is not wired without the trusted raw controls');
      const ref = request?.intentRef;
      if (!isControlIntentRef(ref)) {
        return { status: 'rejected', code: 'invalid', reason: 'deliverControl requires a complete ControlIntentRef' };
      }
      let read: ReadResult<ControlIntentSnapshotV1>;
      try {
        read = await controls.readControl(ctx, ref);
      } catch (error) {
        return { status: 'rejected', code: 'unavailable', reason: `the control intent read failed: ${messageOf(error)}` };
      }
      if (read.status !== 'ready') return read;
      const intent = read.value;
      // An already-observed intent is returned as-is: no second delivery, no
      // second abort and no new execution.
      if (intent.status !== 'queued') return { status: 'ready', value: intent };
      const key = keyOf(intent.runRef);
      const handle = key === null ? undefined : handles.get(key);
      // No matching live handle: the request stays durable and unsignalled.
      if (handle === undefined) return { status: 'ready', value: intent };
      // A late delivery must not overwrite the original consumed-intent
      // association of an already-exited handle, nor let an old pause/terminal
      // claim a new observation. Only a live Kernel call can consume.
      if (!handleLive(handle)) return { status: 'ready', value: intent };
      if (intent.kind === 'cancel') {
        // A cancel is associated only for the FIRST live delivery to this fixed
        // handle and only when its own controller has not already been aborted
        // by the caller or an earlier control: a late cancel must never
        // overwrite the original pause/cancel stop cause.
        if (!handle.controller.signal.aborted && handle.intentRef === undefined) {
          handle.intentRef = intent.ref;
          try { handle.controller.abort('caller_requested'); } catch { /* an already-aborted controller is fine */ }
        }
      }
      // A pause is associated only at the real safe-point decision in `decide`.
      return { status: 'ready', value: intent };
    },
    register(handle: RuntimeControlHandle): RuntimeControlHandle {
      const key = keyOf(handle.runRef);
      if (key === null) throw new Error('the live control handle RunRef is not canonicalizable JSON');
      handles.set(key, handle);
      return handle;
    },
    async inputs(ctx, runRef) {
      if (deps.controls === undefined || deps.sourceAuthority === undefined) return [];
      const loaded = await deps.sourceAuthority().load(runRef);
      if (loaded.status !== 'found') return [];
      const run = loaded.snapshot as RunSnapshot;
      const inputs: ControlIntentSnapshotV1[] = [];
      for (const ref of run.controlInputs ?? []) {
        const read = await deps.controls.readControl(ctx, ref);
        if (read.status === 'ready' && read.value.kind === 'steer' && read.value.status === 'queued' && sameRef(read.value.runRef, runRef)) inputs.push(read.value);
      }
      return inputs;
    },
    continuation(runRef: RunRef): RunContinuationV1 | undefined {
      const key = keyOf(runRef);
      if (key === null) return undefined;
      const handle = handles.get(key);
      if (handle === undefined || handle.waitMessage === undefined
        || handle.task === undefined || handle.sessionRef === undefined) return undefined;
      return {
        schemaVersion: 1, kind: 'wait_reply',
        task: structuredClone(handle.task),
        sessionRef: { projectId: handle.sessionRef.projectId, sessionId: handle.sessionRef.sessionId },
        messageRef: structuredClone(handle.waitMessage.ref),
      };
    },
    proof(runRef: RunRef): RuntimeControlProof | undefined {
      const key = keyOf(runRef);
      if (key === null) return undefined;
      const handle = handles.get(key);
      if (handle === undefined) return undefined;
      return {
        kernelExited: handle.kernelExited,
        ...(handle.resourcesClosed === undefined ? {} : { resourcesClosed: handle.resourcesClosed }),
        ...(handle.intentRef === undefined ? {} : { consumedIntentRef: handle.intentRef }),
        ...(handle.resumeIntentRef === undefined ? {} : { resumeIntentRef: handle.resumeIntentRef }),
      };
    },
    async decide(ctx: CoreCallContext, runRef: RunRef): Promise<RuntimeControlDecision> {
      const controls = deps.controls;
      const sourceAuthority = deps.sourceAuthority;
      // No trusted control facts: keep the historical no-barrier behavior.
      if (controls === undefined || sourceAuthority === undefined) return { kind: 'continue' };
      if (!isRunRef(runRef)) return { kind: 'pause' };
      let loaded;
      try {
        loaded = await sourceAuthority().load(runRef);
      } catch {
        return { kind: 'pause' };
      }
      if (loaded.status !== 'found' || !isRunRef(loaded.snapshot.ref) || !sameRef(loaded.snapshot.ref, runRef)) {
        return { kind: 'pause' };
      }
      const run = loaded.snapshot as RunSnapshot;
      const control = run.controlState;
      if (control === undefined) return { kind: 'continue' };
      let read: ReadResult<ControlIntentSnapshotV1>;
      try {
        read = await controls.readControl(ctx, control.intentRef);
      } catch {
        return { kind: 'pause' };
      }
      if (read.status !== 'ready') return { kind: 'pause' };
      const intent = read.value;
      if (!sameRef(intent.ref, control.intentRef) || !sameRef(intent.runRef, runRef)) {
        return { kind: 'pause' };
      }
      const key = keyOf(runRef);
      const handle = key === null ? undefined : handles.get(key);
      if (control.desiredState === 'paused') {
        // Same first-live rule as `deliver`/cancel: only the fixed handle's
        // still-live call whose own controller has not already been aborted, and
        // which has not already consumed an intent, may record this pause. A
        // cancel that actually aborted the controller while this readControl was
        // awaiting keeps its original association; the Kernel's existing signal
        // priority still decides the real terminal.
        if (handle !== undefined && handleLive(handle) && !handle.controller.signal.aborted
          && handle.intentRef === undefined) {
          handle.intentRef = intent.ref;
        }
        return { kind: 'pause' };
      }
      if (control.desiredState === 'cancelled') {
        // Same first-live rule as `deliver`: only the fixed handle's still-live
        // call whose own controller has not already been aborted may consume the
        // cancel; an already-returned/aborted call keeps its original stop cause.
        if (handle !== undefined && handleLive(handle) && !handle.controller.signal.aborted
          && handle.intentRef === undefined) {
          handle.intentRef = intent.ref;
          try { handle.controller.abort('caller_requested'); } catch { /* already aborted */ }
        }
        // The Kernel's own post-callback signal check wins and records
        // run.cancelled; this is not a pause.
        return { kind: 'continue' };
      }
      // An explicit resume/steer pointer is the ONLY unblock proof: it releases
      // the hold so the Run continues and the unified input supply can read the
      // applicable new input at the next before_model. Unknown pointers still
      // fail closed.
      if (control.desiredState === 'running' || control.desiredState === 'steered') {
        return { kind: 'continue' };
      }
      return { kind: 'pause' };
    },
    async inspect(ctx: CoreCallContext, runRef: RunRef): Promise<RuntimeControlInspection> {
      const controls = deps.controls;
      const sourceAuthority = deps.sourceAuthority;
      // No trusted control facts: nothing to yield to; the historical path runs.
      if (controls === undefined || sourceAuthority === undefined) return { kind: 'continue' };
      if (!isRunRef(runRef)) return { kind: 'continue' };
      let loaded;
      try {
        loaded = await sourceAuthority().load(runRef);
      } catch {
        return { kind: 'continue' };
      }
      if (loaded.status !== 'found' || !isRunRef(loaded.snapshot.ref) || !sameRef(loaded.snapshot.ref, runRef)) {
        return { kind: 'continue' };
      }
      const run = loaded.snapshot as RunSnapshot;
      const control = run.controlState;
      if (control === undefined) return { kind: 'continue' };
      let read: ReadResult<ControlIntentSnapshotV1>;
      try {
        read = await controls.readControl(ctx, control.intentRef);
      } catch {
        return { kind: 'continue' };
      }
      if (read.status !== 'ready') return { kind: 'continue' };
      const intent = read.value;
      if (!sameRef(intent.ref, control.intentRef) || !sameRef(intent.runRef, runRef)) return { kind: 'continue' };
      if (control.desiredState === 'paused') return { kind: 'pause' };
      if (control.desiredState === 'cancelled') return { kind: 'cancel' };
      return { kind: 'continue' };
    },
    async close(): Promise<void> {
      handles.clear();
    },
  };
}
