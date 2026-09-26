/**
 * M1 workspace material source provider — adapts the existing WorkspaceAccessFactory
 * and WorkspaceSourceApplicability into the read-side SourceApplicabilityPort.
 *
 * `contextForScope(scope, signal)` is a trusted Host binding owned by the
 * composition root: it constructs the configured service Host identity for the
 * REAL project/workspace and must never be a model callback. This adapter
 * re-checks that the returned ctx scope/principal/materialReader/signal are
 * aligned before opening anything.
 *
 * Every capture:
 *  - opens a fresh `access.open(ctx, { projectId, workspaceId })`, reusing
 *    resolveRoot/authorize and the Kernel sandbox path policy, and adapts the
 *    live listFiles/read/allowed/sourceIdentity surface into ProjectSourceAccess;
 *  - lets `WorkspaceSourceApplicability` perform the two content observations
 *    (no second scanner, digest or permission system), keeping the Kernel's real
 *    byteLength so a truncated read is never re-hashed as complete content;
 *  - owns the outer try/finally so the observation access is released exactly
 *    once on success, failure and cancellation;
 *  - after the content observation opens a short-lived second access and
 *    re-checks root identity, Workspace revision and subject/permission revision.
 *    Any change returns stale and no sourced pin is published. Both resources
 *    are released in their own finally. This is NOT a filesystem TOCTOU fix: the
 *    read-side resolver still re-captures and re-validates on every use.
 *
 * Missing provider, truncated inventory, unsafe paths, unreadable paths,
 * revoked permissions, capacity overflow, additions/deletions and mid-capture
 * changes stay explicit failures; there is no metadata-only fallback.
 */
import type { CoreCallContext, MaterialReader } from '../../contracts/core/call-context.js';
import type { ActorRef } from '../../contracts/command-event.js';
import type { WorkspaceRef } from '../../contracts/ledger.js';
import type {
  MaterialSourceCaptureResult,
  MaterialSourceScope,
  MaterialSourceSetV1,
  SourceApplicabilityPort,
} from '../../contracts/material-access.js';
import { validMaterialSourceSet } from '../../contracts/material-access.js';
import type { WorkspaceAccessFactory, WorkspaceReadAccess } from './access.js';
import { WorkspaceSourceApplicability } from './source-applicability.js';
import type { ProjectSourceAccess } from './project-source-index.js';

export type MaterialSourceProviderDependencies = {
  access: WorkspaceAccessFactory;
  // Trusted Host binding owned by composition, never a model callback.
  contextForScope(scope: MaterialSourceScope, signal: AbortSignal): CoreCallContext;
};

/** The inventory hard cap the source algorithm is allowed to request. */
const INVENTORY_LIMIT = 60000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trustedActor(value: unknown): value is Extract<ActorRef, { kind: 'human' | 'system' }> {
  if (!isRecord(value)) return false;
  return (value['kind'] === 'human' || value['kind'] === 'system')
    && typeof value['id'] === 'string' && value['id'].length > 0;
}

function sameActor(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  return left['kind'] === right['kind'] && left['id'] === right['id'];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unavailable(issue: string): MaterialSourceCaptureResult {
  return { status: 'unavailable', issues: [issue] };
}

function rejected(issue: string): MaterialSourceCaptureResult {
  return { status: 'rejected', issues: [issue] };
}

/** The trusted context must describe exactly the requested scope and identity. */
function contextAligned(ctx: unknown, scope: MaterialSourceScope, signal: AbortSignal): boolean {
  if (!isRecord(ctx)) return false;
  if (ctx['projectId'] !== scope.projectId || ctx['workspaceId'] !== scope.workspaceId) return false;
  const principal = ctx['principal'];
  if (!isRecord(principal) || principal['kind'] !== 'host') return false;
  const actor = principal['actor'];
  if (!trustedActor(actor)) return false;
  const reader = ctx['materialReader'];
  if (!isRecord(reader) || reader['kind'] !== 'host') return false;
  if (reader['projectId'] !== scope.projectId || reader['workspaceId'] !== scope.workspaceId) return false;
  if (!sameActor(reader['actor'], actor)) return false;
  return ctx['signal'] === signal;
}

/** Adapts one live workspace read access into the source algorithm's port. */
function adapt(access: WorkspaceReadAccess, signal: AbortSignal): ProjectSourceAccess {
  return {
    allowed: (path) => access.authorization.allowsRead(path),
    async inventory() {
      signal.throwIfAborted();
      const page = await access.listFiles(INVENTORY_LIMIT);
      signal.throwIfAborted();
      return { paths: page.paths, truncated: page.truncated };
    },
    async sourceIdentity() {
      signal.throwIfAborted();
      return access.sourceIdentity();
    },
    async read(path, maxBytes) {
      signal.throwIfAborted();
      const file = await access.read(path, maxBytes);
      signal.throwIfAborted();
      // `byteLength` is the Kernel's real raw-byte fact. A read whose file is
      // larger than the requested bound was truncated, and hashing that text as
      // if it were the complete body would be a silent source forgery.
      if (file.byteLength > maxBytes) throw Error('source read exceeds the requested byte bound');
      return { content: file.content };
    },
  };
}

type AccessOutcome =
  | { status: 'ready'; value: WorkspaceReadAccess }
  | { status: 'failed'; failure: MaterialSourceCaptureResult };

async function openAccess(
  access: WorkspaceAccessFactory,
  ctx: CoreCallContext,
  workspace: WorkspaceRef,
): Promise<AccessOutcome> {
  let opened;
  try {
    opened = await access.open(ctx, workspace);
  } catch (error) {
    return { status: 'failed', failure: unavailable('workspace access could not be opened: ' + messageOf(error)) };
  }
  if (opened.status === 'ready') return { status: 'ready', value: opened.value };
  if (opened.code === 'forbidden') return { status: 'failed', failure: rejected('workspace read access was denied: ' + opened.reason) };
  return { status: 'failed', failure: unavailable('workspace read access is unavailable: ' + opened.reason) };
}

/** Releases one acquired access; `false` means the release itself failed. */
async function releaseAccess(access: WorkspaceReadAccess): Promise<boolean> {
  try {
    await access.release();
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the read-side source port over the real workspace access capability.
 * The composition root injects this SAME instance into the grant service and
 * `createMaterialAccessResolver(authority, index, source)`.
 */
export function createMaterialSourceProvider(deps: MaterialSourceProviderDependencies): SourceApplicabilityPort {
  return {
    async capture(
      query: MaterialSourceScope & { sourceSet: MaterialSourceSetV1 },
      signal: AbortSignal = new AbortController().signal,
    ): Promise<MaterialSourceCaptureResult> {
      if (!query || typeof query.projectId !== 'string' || !query.projectId
        || typeof query.workspaceId !== 'string' || !query.workspaceId) {
        return rejected('invalid source scope or source set');
      }
      // Snapshot the complete scope and source selection BEFORE the first await.
      // A caller that mutates its query while a workspace open is pending must
      // not be able to redirect the pin to another selection.
      let sourceSet: MaterialSourceSetV1;
      try {
        sourceSet = structuredClone(query.sourceSet);
      } catch {
        return rejected('the source selection cannot be isolated from the caller');
      }
      if (!validMaterialSourceSet(sourceSet) || sourceSet.kind !== 'workspace_paths') {
        return rejected('invalid source scope or source set');
      }
      const scope: MaterialSourceScope = { projectId: query.projectId, workspaceId: query.workspaceId };
      if (signal.aborted) return unavailable('source capture was cancelled before opening a workspace');

      let ctx: CoreCallContext;
      try {
        ctx = deps.contextForScope(scope, signal);
      } catch (error) {
        return unavailable('the trusted source context could not be constructed: ' + messageOf(error));
      }
      if (!contextAligned(ctx, scope, signal)) {
        return rejected('the trusted source context does not match the requested scope');
      }
      if (signal.aborted) return unavailable('source capture was cancelled before opening a workspace');

      const workspace: WorkspaceRef = { aggregateType: 'Workspace', ...scope };

      const opened = await openAccess(deps.access, ctx, workspace);
      if (opened.status === 'failed') return opened.failure;
      const first = opened.value;
      const firstIdentity = first.workspaceIdentity;
      const firstRevision = first.workspaceRevision;
      const firstSubject = first.authorization.subjectKey;
      const firstPermission = first.authorization.permissionRevision;
      let observed: MaterialSourceCaptureResult;
      let firstReleased = false;
      try {
        const applicability = new WorkspaceSourceApplicability(() => adapt(first, signal));
        observed = await applicability.capture({ ...scope, sourceSet }, signal);
      } catch (error) {
        observed = unavailable('source observation failed: ' + messageOf(error));
      } finally {
        firstReleased = await releaseAccess(first);
      }
      // The read has no irreversible committed side effect: a cancellation that
      // lands during observation or its release must never publish a sourced pin.
      if (signal.aborted) return unavailable('source capture was cancelled during observation');
      // Keep the real observation diagnosis (stale/truncated/read-error) ahead of
      // a secondary release failure; a release failure only blocks a SOURCED pin.
      if (observed.status !== 'sourced') return observed;
      if (!firstReleased) return unavailable('the workspace read access could not be released');

      const reopened = await openAccess(deps.access, ctx, workspace);
      if (reopened.status === 'failed') return reopened.failure;
      let authorizationChanged = false;
      let secondReleased = false;
      try {
        const second = reopened.value;
        authorizationChanged = second.workspaceIdentity !== firstIdentity
          || second.workspaceRevision !== firstRevision
          || second.authorization.subjectKey !== firstSubject
          || second.authorization.permissionRevision !== firstPermission;
      } finally {
        secondReleased = await releaseAccess(reopened.value);
      }
      // Check the ORIGINAL signal only after every acquired access was released,
      // and never return from inside finally: a real observation error is kept,
      // while a late cancellation cannot publish a sourced pin.
      if (signal.aborted) return unavailable('source capture was cancelled during final reauthorization');
      if (!secondReleased) return unavailable('the workspace read access could not be released');
      if (authorizationChanged) {
        return { status: 'stale', issues: ['workspace root, revision, subject or permission changed during capture'] };
      }
      return observed;
    },
  };
}
