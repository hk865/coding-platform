/**
 * The shared Session entry boundary and request identity helpers.
 *
 * Every Session entry point runs only for a Host principal that carries a real
 * AbortSignal and a bound project/workspace; an unbound caller is rejected
 * BEFORE any store or Kernel access. The error label is the caller's own entry
 * name, so the four exact texts stay per service.
 *
 * The write-request isolation clones the whole GraphWrite synchronously, before
 * the first await, so a caller mutating its input cannot change what is
 * committed. The identity/fingerprint helpers are shared by the Session
 * services; the expected pins are sorted by their canonical ref before they
 * enter the fingerprint.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson, canonicalOf, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { GraphWrite } from '../model/session-contracts.js';

export type HostActor = { kind: 'human' | 'system'; id: string };
export type TrustedContext =
  | { ok: true; scope: WorkspaceScope; actor: HostActor }
  | { ok: false; rejection: CoreRejection };

export type OwnedRequest<T> =
  | { ok: true; input: T; requestId: string; expected: readonly VersionPin[] }
  | { ok: false; reason: string };

/** The trusted component boundary. `label` is the caller's entry name. */
export function trustedContext(ctx: CoreCallContext, label: string): TrustedContext {
  const bound = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown; signal?: unknown;
  };
  if (!nonEmpty(bound.projectId) || !nonEmpty(bound.workspaceId)) {
    return { ok: false, rejection: rejected('forbidden', `${label} requires a bound project/workspace context`) };
  }
  const signal = bound.signal;
  if (!isRecord(signal) || typeof signal['aborted'] !== 'boolean' || typeof signal['addEventListener'] !== 'function') {
    return { ok: false, rejection: rejected('forbidden', `${label} requires the bound AbortSignal`) };
  }
  const principal = bound.principal;
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: rejected('forbidden', `${label} requires a trusted Host principal`) };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: rejected('forbidden', `${label} requires a trusted Host actor`) };
  }
  return {
    ok: true,
    scope: { projectId: bound.projectId, workspaceId: bound.workspaceId },
    actor: { kind: actor['kind'], id: actor['id'] },
  };
}

export function ownRequest<T>(request: GraphWrite<T>, what: string): OwnedRequest<T> {
  try {
    const clone = structuredClone(request) as GraphWrite<T>;
    const meta = clone.meta as unknown as Record<string, unknown>;
    if (!isRecord(meta) || !nonEmpty(meta['requestId'])) return { ok: false, reason: `${what} requires meta.requestId` };
    if (!Array.isArray(meta['expected'])) return { ok: false, reason: `${what} requires meta.expected` };
    return {
      ok: true,
      input: clone.input,
      requestId: meta['requestId'],
      expected: meta['expected'] as readonly VersionPin[],
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${what} request cannot be isolated from the caller: ${detail}` };
  }
}

export function actorIdentity(actor: HostActor): { kind: string; id: string } {
  return { kind: actor.kind, id: actor.id };
}

export function identityKeyOf(
  prefix: string,
  actor: HostActor,
  scope: WorkspaceScope,
  requestId: string,
): string {
  return prefix + sha256Hex(canonicalJson({
    actor: actorIdentity(actor), projectId: scope.projectId, workspaceId: scope.workspaceId, requestId,
  } as unknown as JsonValue));
}

export function fingerprintOf(
  kind: string,
  actor: HostActor,
  scope: WorkspaceScope,
  payload: Record<string, unknown>,
  expected: readonly VersionPin[],
): string {
  const pins = [...expected].map((pin) => ({ ref: pin.ref, revision: pin.revision }))
    .sort((left, right) => {
      const leftKey = canonicalOf(left.ref) ?? '';
      const rightKey = canonicalOf(right.ref) ?? '';
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return sha256Hex(canonicalJson({
    kind, actor: actorIdentity(actor), projectId: scope.projectId, workspaceId: scope.workspaceId,
    ...payload, expected: pins,
  } as unknown as JsonValue));
}

export function eventIdOf(identityKey: string, suffix: string): string {
  return sha256Hex(`${identityKey}|${suffix}`);
}
