/**
 * The trusted Host call-context binding and synchronous request isolation
 * shared by the execution entry/history/claim/run-state services.
 *
 * The service wrappers keep their own labels, rejection builders and narrowed
 * return types; this module keeps the original order of checks and texts. The
 * material reader and the actor are compared as the same trusted Host scope.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext, MaterialReader } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection } from '../../../contracts/core/results.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { GraphWrite } from '../model/task-contracts.js';

export type TrustedContextResult =
  | { ok: true; ctx: CoreCallContext; scope: WorkspaceScope;
      actor: Extract<ActorRef, { kind: 'human' | 'system' }>; signal: AbortSignal }
  | { ok: false; rejection: CoreRejection };

function sameHostActor(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && left['kind'] === right['kind'] && left['id'] === right['id']
    && (left['kind'] === 'human' || left['kind'] === 'system');
}

/** Bind the trusted Host scope and identity before the first await; the
 * AbortSignal is preserved by reference so cancellation is never lost.
 *
 * Each entry supplies its own signal check. */
export function trustedContextOf(ctx: CoreCallContext, options: {
  label: string;
  reject: (code: CoreError, reason: string) => CoreRejection;
  isSignal: (signal: unknown) => boolean;
}): TrustedContextResult {
  const raw = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown; materialReader?: unknown; signal?: unknown;
  } | null | undefined;
  if (raw === null || raw === undefined) {
    return { ok: false, rejection: options.reject('invalid', `${options.label} requires a bound call context`) };
  }
  const projectId = raw.projectId;
  const workspaceId = raw.workspaceId;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return {
      ok: false,
      rejection: options.reject('forbidden', `${options.label} requires a bound project/workspace context`),
    };
  }
  const signal = raw.signal;
  if (!options.isSignal(signal)) {
    return { ok: false, rejection: options.reject('forbidden', `${options.label} requires the bound AbortSignal`) };
  }
  let principal: unknown;
  let materialReader: unknown;
  try {
    principal = structuredClone(raw.principal);
    materialReader = structuredClone(raw.materialReader);
  } catch {
    return {
      ok: false,
      rejection: options.reject('invalid', 'the call context identity cannot be isolated from the caller'),
    };
  }
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: options.reject('forbidden', `${options.label} requires a trusted Host principal`) };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: options.reject('forbidden', `${options.label} requires a trusted Host actor`) };
  }
  if (!isRecord(materialReader) || materialReader['kind'] !== 'host'
    || materialReader['projectId'] !== projectId
    || (materialReader['workspaceId'] !== undefined && materialReader['workspaceId'] !== workspaceId)
    || !sameHostActor(materialReader['actor'], actor)) {
    return {
      ok: false,
      rejection: options.reject('forbidden', 'the material reader is not the same trusted Host scope'),
    };
  }
  return {
    ok: true,
    ctx: {
      projectId, workspaceId,
      principal: principal as CoreCallContext['principal'],
      materialReader: materialReader as MaterialReader,
      signal: signal as unknown as AbortSignal,
    },
    scope: { projectId, workspaceId },
    actor: { kind: actor['kind'], id: actor['id'] },
    signal: signal as unknown as AbortSignal,
  };
}

export type IsolatedWrite<T> =
  | { ok: true; input: T; requestId: string; expected: readonly VersionPin[] }
  | { ok: false; rejection: CoreRejection };

export function isolatedWriteOf<T>(request: GraphWrite<T>, options: {
  label: string;
  reject: (code: CoreError, reason: string) => CoreRejection;
  cannotIsolate: string;
}): IsolatedWrite<T> {
  const raw = request as unknown as { input?: unknown; meta?: unknown } | null | undefined;
  if (raw === null || raw === undefined || !isRecord(raw.input)) {
    return {
      ok: false,
      rejection: options.reject('invalid', `${options.label} requires a request input object`),
    };
  }
  const meta = raw.meta;
  if (!isRecord(meta) || !nonEmpty(meta['requestId'])) {
    return { ok: false, rejection: options.reject('invalid', `${options.label} requires meta.requestId`) };
  }
  if (!Array.isArray(meta['expected'])) {
    return {
      ok: false,
      rejection: options.reject('invalid', 'meta.expected must be an array of version pins'),
    };
  }
  let input: T;
  let expected: readonly VersionPin[];
  try {
    input = structuredClone(raw.input) as T;
    expected = structuredClone(meta['expected']) as VersionPin[];
  } catch {
    return { ok: false, rejection: options.reject('invalid', options.cannotIsolate) };
  }
  return { ok: true, input, requestId: meta['requestId'], expected };
}
