/**
 * R4c.2c SourceAuthority exact-fact reader.
 *
 * This factory adapts the already assembled `MaterialAuthorityReads` to the
 * snapshot-only `SourceSnapshotReads` port that the Runtime source consumers
 * need, so they do not each re-scan or re-decode accepted facts.
 *
 * Boundaries owned here:
 *  - reuse `deps.authority.load` once per supported ref; the injected material
 *    reader keeps its own exact `readMany` and canonical decoding, so this file
 *    never opens a second Store connection, codec, cache, index or fact source;
 *  - supported kinds are Workspace / Run / QueryRun; ReviewWork and QueryJob
 *    have no provider here and stay `unsupported` instead of a false empty read;
 *  - a genuine absence stays `not_found`; damaged/unreadable reads stay
 *    `unavailable`, and a thrown provider error is explicit `unavailable`.
 *  - the caller ref is snapshotted and validated before the first await, a
 *    found result must carry the complete requested ref, and the returned
 *    snapshot is an independent copy.
 *
 * This port has no `events` member: Query-origin consumers keep the real
 * `SourceAuthorityReads` event capability. Do not supply fake empty pages.
 */
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { MaterialCanonicalRef } from './materials/record-ports.js';
import type {
  SourceCanonicalRef,
  SourceCanonicalSnapshot,
  SourceSnapshotReadDependencies,
  SourceSnapshotReads,
  SourceSnapshotResult,
} from './source-authority-ports.js';

/** The exact key set of every accepted kind. An unexpected or missing key is an
 * ambiguous request that must not be widened into another stored fact. */
const REF_KEYS = {
  Workspace: ['projectId', 'workspaceId'],
  Run: ['projectId', 'goalId', 'runId'],
  QueryRun: ['projectId', 'workspaceId', 'queryJobId', 'runId'],
  ReviewWork: ['projectId', 'workspaceId', 'goalId', 'reviewId'],
  QueryJob: ['projectId', 'workspaceId', 'queryJobId'],
} as const;

type RefKind = keyof typeof REF_KEYS;
type SupportedSourceRef = Extract<SourceCanonicalRef, { aggregateType: 'Workspace' | 'Run' | 'QueryRun' }>;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const unavailable = (reason: string): SourceSnapshotResult => ({ status: 'unavailable', reason });

function isRefKind(value: unknown): value is RefKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REF_KEYS, value);
}

/**
 * Snapshot the caller's ref synchronously (before the first await), reject every
 * malformed/ambiguous shape, and rebuild the exact canonical ref that will be delegated.
 * Returns `null` for an unusable request so the caller can answer `unavailable` without
 * consulting a provider or guessing at a related fact.
 */
function copyExactRef(ref: SourceCanonicalRef): SourceCanonicalRef | null {
  let cloned: unknown;
  try {
    cloned = structuredClone(ref);
  } catch {
    return null;
  }
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) return null;
  const record = cloned as Record<string, unknown>;
  const kind = record['aggregateType'];
  if (!isRefKind(kind)) return null;
  const keys = REF_KEYS[kind] as readonly string[];
  const own = Object.keys(record);
  if (own.length !== keys.length + 1) return null;
  for (const key of own) {
    if (key !== 'aggregateType' && !keys.includes(key)) return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) return null;
  }
  // Non-finite/unsupported members are a damaged request, never another fact.
  try {
    canonicalJson(cloned as JsonValue);
  } catch {
    return null;
  }
  const clean: Record<string, JsonValue> = { aggregateType: kind };
  for (const key of keys) clean[key] = record[key] as string;
  return clean as unknown as SourceCanonicalRef;
}

export function createSourceAuthorityReader(deps: SourceSnapshotReadDependencies): SourceSnapshotReads {
  /** One delegate call to the injected exact material reader for a supported ref. */
  async function loadSupported(ref: SupportedSourceRef): Promise<SourceSnapshotResult> {
    const refKey = canonicalJson(ref as unknown as JsonValue);
    let result;
    try {
      result = await deps.authority.load(ref as MaterialCanonicalRef);
    } catch (error) {
      return unavailable(`material authority read failed: ${messageOf(error)}`);
    }
    if (result.status === 'not_found') return { status: 'not_found', ref: structuredClone(ref) };
    if (result.status === 'unavailable') return { status: 'unavailable', reason: result.reason };
    // A provider may only answer `found` for the complete requested ref; anything else is
    // treated as unreadable rather than silently accepted as the requested fact.
    try {
      if (canonicalJson(result.snapshot.ref as unknown as JsonValue) !== refKey) {
        return unavailable('the stored fact does not match the complete requested ref');
      }
    } catch (error) {
      return unavailable(`the stored fact ref is not readable: ${messageOf(error)}`);
    }
    return { status: 'found', snapshot: structuredClone(result.snapshot) as SourceCanonicalSnapshot };
  }

  return {
    async load(ref) {
      const clean = copyExactRef(ref);
      if (clean === null) return unavailable('the requested source ref is incomplete, ambiguous or not serializable');
      // ReviewWork and QueryJob have no provider here; `unsupported` is a distinct answer,
      // never an empty scan whose absence would look like a missing real fact.
      if (clean.aggregateType === 'ReviewWork' || clean.aggregateType === 'QueryJob') {
        return { status: 'unsupported', reason: `no source snapshot provider for ${clean.aggregateType}` };
      }
      return loadSupported(clean);
    },
  };
}
