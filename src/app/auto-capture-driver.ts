/**
 * L8 Host automatic-capture driver (spec §1 L8; book rulings 2–6).
 *
 * One driver per Host. A trigger is accepted for ONE workspace at a time:
 *
 * - The acceptance writes the request record (`requestSeq + 1`, status
 *   `requested`) BEFORE the workspace is queued, so a queued request survives a
 *   close and a later start retries it.
 * - Triggers for a workspace that is already waiting merge into the waiting
 *   entry: no second request record is written.
 * - A trigger for a workspace whose capture is running writes its new request
 *   immediately and queues exactly one more capture.
 * - At most one capture runs for the whole Host; the queue is drained in order.
 *
 * A capture start reads the request record ONCE and the public observation
 * state ONCE. That snapshot's `requestSeq` is the capture identity
 * (`auto-capture:<projectId>:<workspaceId>:<requestSeq>`) and the observation
 * watermark; its `revision` guards the failure write, and the state's current
 * observation is passed as `previous`. A failed capture, a failed
 * observation-state read, or a catalog read that is rejected/throws (not a
 * cancellation), writes `failAutoCapture` with that start revision; a cancelled
 * or aborted one writes nothing. The start snapshot read itself is the
 * documented exception: without a revision it leaves the request pending.
 * `not_found` is the legal empty catalog (`[]` mappings), never an invented one.
 */
import { randomUUID } from 'node:crypto';
import type { ArchitectureAutoCaptureFailureV1, ArchitectureAutoCaptureRecordV1,
  AutoCaptureTriggerV1 } from '../contracts/architecture-observation.js';
import type { WorkspaceScope } from '../contracts/core/identity.js';
import type { PersistedSourceCaptureRef } from '../contracts/core/source.js';
import { moduleMappingsOf, type AdoptedArchitecture } from '../contracts/architecture-catalog.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import type { ObservedArchitecturePort } from '../core/work-graph/architecture/contracts.js';
import { createHostCoreCallContext, type HostActor } from './core-call-context.js';

/** The Host's own system actor for automatic captures. Never the operator. */
export const AUTO_CAPTURE_ACTOR: Readonly<{ kind: 'system'; id: 'host:auto-capture' }> =
  Object.freeze({ kind: 'system', id: 'host:auto-capture' });

export type AutoCaptureDriverDependencies = {
  architecture: Pick<ObservedArchitecturePort,
    'requestAutoCapture' | 'failAutoCapture' | 'readAutoCapture' | 'captureSourceChanges'>
    // `observationState` is the only read that exposes the computed `pending`
    // flag; the interface's four-operation Pick cannot decide a startup retry.
    & Pick<ObservedArchitecturePort, 'observationState'>;
  catalog: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  boundWorkspaces: () => readonly WorkspaceScope[];
  /** Production always passes the Host's fixed automatic-capture system actor. */
  actor: { kind: 'system'; id: string };
  track?: <T>(work: Promise<T>) => Promise<T>;
};

export type AutoCaptureDriver = {
  /** Detached: one capture for a freshly bound workspace. */
  workspaceRegistered(scope: WorkspaceScope): void;
  /** Detached: one capture for every bound workspace of the project. */
  projectChanged(projectId: string,
    trigger: 'catalog_adopted' | 'catalog_revised' | 'check_passed'): void;
  /** Host start, detached: every pending bound workspace gets a `startup_retry`. */
  retryPending(workspaces: readonly WorkspaceScope[]): void;
  /** Stop the queue, abort the running capture, drain. */
  close(): Promise<void>;
};

type QueueEntry = { scope: WorkspaceScope };

function scopeKeyOf(scope: WorkspaceScope): string {
  // Unambiguous tuple encoding: NUL-joining two unrestricted ids can collide
  // (`("a", "b\u0000c")` vs `("a\u0000b", "c")`). Canonical JSON keeps the two
  // positions distinct.
  return canonicalJson([scope.projectId, scope.workspaceId]);
}
function copyScope(scope: WorkspaceScope): WorkspaceScope {
  return { projectId: scope.projectId, workspaceId: scope.workspaceId };
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAutoCaptureDriver(deps: AutoCaptureDriverDependencies): AutoCaptureDriver {
  const actor: HostActor = { kind: deps.actor.kind, id: deps.actor.id };
  /** Waiting captures by workspace; one entry per workspace is the coalescing rule. */
  const queue = new Map<string, QueueEntry>();
  /** Workspaces whose accepted request write has not finished yet: a later trigger merges. */
  const accepting = new Set<string>();
  /** Every detached task this driver started, so `close()` drains exactly its own work. */
  const detached = new Set<Promise<unknown>>();
  let running: AbortController | null = null;
  let closed = false;
  let closing: Promise<void> | null = null;

  const context = (scope: WorkspaceScope, signal: AbortSignal) =>
    createHostCoreCallContext({ scope: copyScope(scope), actor, signal });

  /** Run one detached task through the Host's one tracker when it is published. */
  function detach<T>(work: Promise<T>): Promise<T> {
    const tracked = deps.track === undefined ? work : deps.track(work);
    const settled: Promise<unknown> = tracked.then(() => undefined, () => undefined);
    detached.add(settled);
    void settled.finally(() => detached.delete(settled));
    return tracked;
  }

  /** One request record for an accepted trigger, before it may be queued. */
  async function writeRequest(scope: WorkspaceScope, trigger: AutoCaptureTriggerV1):
    Promise<ArchitectureAutoCaptureRecordV1 | null> {
    try {
      const written = await deps.architecture.requestAutoCapture(context(scope, new AbortController().signal), {
        input: { workspace: copyScope(scope), trigger, requestedAt: new Date().toISOString() },
        // A request acceptance is a fresh fact, not a replayable client command.
        meta: { requestId: `auto-capture-request:${scope.projectId}:${scope.workspaceId}:${randomUUID()}`, expected: [] },
      });
      return written.status === 'committed' ? written.value : null;
    } catch {
      return null;
    }
  }

  /** The one accepted-trigger path: write before queueing; waiters merge. */
  function accept(scope: WorkspaceScope, trigger: AutoCaptureTriggerV1): void {
    if (closed) return;
    const key = scopeKeyOf(scope);
    // Already waiting, or a request write for this workspace is still in flight:
    // the trigger merges into it and writes no second record.
    if (queue.has(key) || accepting.has(key)) return;
    accepting.add(key);
    void detach((async () => {
      try {
        const record = await writeRequest(scope, trigger);
        if (record === null || closed || queue.has(key)) return;
        queue.set(key, { scope: copyScope(scope) });
        pump();
      } finally {
        accepting.delete(key);
      }
    })());
  }

  /** Start the next queued capture, never more than one for the whole Host. */
  function pump(): void {
    if (closed || running !== null || queue.size === 0) return;
    const first = queue.entries().next();
    if (first.done) return;
    const [key, entry] = first.value;
    queue.delete(key);
    const controller = new AbortController();
    running = controller;
    void detach((async () => {
      try {
        await runCapture(entry.scope, controller);
      } finally {
        if (running === controller) running = null;
        pump();
      }
    })());
  }

  async function runCapture(scope: WorkspaceScope, controller: AbortController): Promise<void> {
    // 1. The start snapshot: exactly one record read. This read is the
    // documented exception: it produces the revision that guards a failure
    // write, so a failure here has nothing to guard with and leaves the accepted
    // request pending for a later trigger or start.
    let snapshot: ArchitectureAutoCaptureRecordV1;
    try {
      const read = await deps.architecture.readAutoCapture(context(scope, controller.signal), {
        workspace: copyScope(scope),
      });
      if (read.status !== 'ready' || read.value === null) return;
      snapshot = read.value;
    } catch {
      return;
    }
    if (controller.signal.aborted) return;

    // 2. The start snapshot's current observation: ONE public read, so the
    // capture receives the observation it replaced as `previous` (accepted
    // suggestion "previous ref at start"). No current observation -> null.
    // A cancellation writes nothing; any OTHER failure (`rejected` keeps its
    // code/reason, `not_found`/`not_ready` and a throw become `unavailable`)
    // goes to the SAME failure exit as a failed capture, guarded by the start
    // revision.
    let previous: PersistedSourceCaptureRef | null = null;
    let failure: ArchitectureAutoCaptureFailureV1 | null = null;
    try {
      const state = await deps.architecture.observationState(context(scope, controller.signal), {
        workspace: copyScope(scope),
      });
      if (controller.signal.aborted) return;
      if (state.status === 'ready') {
        previous = state.value.current?.persistedRef ?? null;
      } else if (state.status === 'rejected') {
        if (state.code === 'cancelled') return;
        failure = { code: state.code, reason: state.reason };
      } else {
        failure = { code: 'unavailable', reason: `the start observation state read returned ${state.status}` };
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      failure = { code: 'unavailable', reason: messageOf(error) };
    }
    if (controller.signal.aborted) return;

    // 3. The active catalog. `not_found` (no adoption yet) is the legal empty
    // module layer. Any other rejected or thrown read is a capture failure, on
    // the SAME failure exit as a failed capture, with its code and reason;
    // a cancellation still writes nothing. Skipped when step 2 already failed.
    let adopted: AdoptedArchitecture | null = null;
    if (failure === null) {
      try {
        const catalog = await deps.catalog.readArchitectureRevision(context(scope, controller.signal), {
          selection: { kind: 'current' },
        });
        if (catalog.status === 'ready') adopted = catalog.value.catalog.catalog;
        else if (catalog.status !== 'not_found') {
          if (catalog.status === 'not_ready') return;
          if (catalog.code === 'cancelled') return;
          failure = { code: catalog.code, reason: catalog.reason };
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        failure = { code: 'unavailable', reason: messageOf(error) };
      }
      if (controller.signal.aborted) return;
    }

    // 4. The capture, on the driver's own controller. Its identity is the start
    // snapshot's requestSeq, so one requestSeq starts at most one capture.
    if (failure === null) {
      const mappings = adopted === null ? [] : moduleMappingsOf(adopted);
      try {
        const captured = await deps.architecture.captureSourceChanges(context(scope, controller.signal), {
          input: { workspace: copyScope(scope), mappings, previous, requestSeq: snapshot.requestSeq },
          meta: { requestId: `auto-capture:${scope.projectId}:${scope.workspaceId}:${snapshot.requestSeq}`, expected: [] },
        });
        if (captured.status === 'committed') return;
        // Cancelled/aborted writes nothing; any other rejection is recorded.
        if (captured.code === 'cancelled') return;
        failure = { code: captured.code, reason: captured.reason };
      } catch (error) {
        if (controller.signal.aborted) return;
        failure = { code: 'unavailable', reason: messageOf(error) };
      }
    }
    if (controller.signal.aborted) return;
    if (failure === null) return;

    // 5. The failure keeps the requestSeq, guarded by the start revision, and
    // runs on THIS round's own signal (book ruling 4): a Host close cancels it,
    // and the failure owner checks the signal before its commit starts.
    try {
      await deps.architecture.failAutoCapture(context(scope, controller.signal), {
        input: { workspace: copyScope(scope), expectedRevision: snapshot.revision, failure },
        meta: { requestId: `auto-capture-failure:${scope.projectId}:${scope.workspaceId}:${snapshot.revision}`, expected: [] },
      });
    } catch {
      // The request stays pending; a later trigger/start retries it.
    }
  }

  return {
    workspaceRegistered(scope) {
      accept(scope, 'workspace_registered');
    },
    projectChanged(projectId, trigger) {
      if (closed) return;
      let bound: readonly WorkspaceScope[];
      try { bound = deps.boundWorkspaces(); } catch { return; }
      for (const scope of bound) {
        if (scope.projectId !== projectId) continue;
        accept(scope, trigger);
      }
    },
    retryPending(workspaces) {
      if (closed) return;
      void detach((async () => {
        for (const scope of workspaces) {
          if (closed) return;
          let pending: boolean;
          try {
            const state = await deps.architecture.observationState(context(scope, new AbortController().signal), {
              workspace: copyScope(scope),
            });
            if (state.status !== 'ready') continue;
            pending = state.value.autoCapture?.pending === true;
          } catch {
            continue;
          }
          if (pending) accept(scope, 'startup_retry');
        }
      })());
    },
    close() {
      closing ??= (async () => {
        closed = true;
        queue.clear();
        // Abort the running capture BEFORE the platform drains its own work: the
        // cancelled capture writes nothing and its request stays pending.
        running?.abort();
        while (detached.size > 0) await Promise.allSettled([...detached]);
      })();
      return closing;
    },
  };
}
