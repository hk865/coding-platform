/**
 * M2 material read facts — returns a fresh `MaterialPort.openArtifact` result
 * together with the exact canonical record versions that decision observed.
 *
 * WHY IT EXISTS
 *   B2 authorize / fresh begin / model issue / fresh consume commit an execution
 *   permit or a model consumption in one transaction. The ordinary
 *   `openArtifact(current)` re-checks the real grant and source, but returns only
 *   an ArtifactRecord: between its last authorization read and the B2 commit the
 *   grant can be revoked. Guarding Run/Session alone cannot stop a revoked
 *   material from reaching the model, so the caller needs the versions of the
 *   records that the decision actually read, not a version read afterwards.
 *
 * IMPLEMENTATION BOUNDARY
 *   This service owns no authorization algorithm, no second material state and no
 *   global commit horizon. Each call builds one private collector, wraps this
 *   call's authority/index/source with it, and composes the existing
 *   createMaterialAccessResolver + createMaterialService. Reuse points:
 *   material-service.ts (context/workspace checks, body integrity, cancellation),
 *   applicability.ts (all grant/current/history/owner/basis rules),
 *   record-readers.ts (canonical reads and candidate lookup),
 *   workspace/source-applicability.ts (real source pin re-read), and the
 *   RoleBindingFacts pattern (result and local guards travel together).
 *
 *   Facts are not a persistent permission: every fresh B2 barrier calls again.
 *   The collector is created per call and destroyed on return; it is never an
 *   instance/global mutable read set, so interleaved calls and cancellations
 *   cannot pollute each other. Only a ready result delivers guards; failure
 *   delivers []. An unavailable canonical authority or candidate provider fails
 *   closed as unavailable, so an old resolver cannot project the failure to []
 *   and have that misread as "no grant". Two versions of one key inside the call,
 *   including missing <-> found, is a revision-conflict window and is never
 *   masked by first/last-wins.
 */
import type { ArtifactRecord } from '../../../contracts/artifact.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { SourceApplicabilityPort } from '../../../contracts/material-access.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RecordGuard } from '../../record-store/ports.js';
import { createMaterialAccessResolver } from './applicability.js';
import type { MaterialReadFacts, MaterialReadFactsPort } from './contracts.js';
import { createMaterialService } from './material-service.js';
import type { MaterialAuthorityReads, MaterialCandidateReads } from './record-ports.js';

/**
 * Injected capabilities. The composition root injects the authority/index built
 * from the SAME backend.records, the SAME bodies and a TRUSTED source provider.
 * The source provider is never named by a model or a request field.
 */
export type MaterialReadFactsDependencies = {
  authority: MaterialAuthorityReads;
  index: MaterialCandidateReads;
  bodies: RawArtifactStorePort;
  sourceApplicability?: SourceApplicabilityPort;
  now(): string;
};

/** Per-call observation set: one exact version per canonical key, or a conflict. */
type FactsCollector = {
  observe(refKey: string, revision: number | null): void;
  observeUnavailable(reason: string): void;
  unavailableReason(): string | null;
  hasConflict(): boolean;
  guards(): RecordGuard[];
};

function createFactsCollector(): FactsCollector {
  const observed = new Map<string, number | null>();
  let conflicted = false;
  let unavailable: string | null = null;
  return {
    observe(refKey, revision) {
      const prior = observed.get(refKey);
      // An identical repeat of one version de-duplicates; any other value for the
      // same key (including null <-> number) is a mixed fact window.
      if (prior === undefined) observed.set(refKey, revision);
      else if (prior !== revision) conflicted = true;
    },
    observeUnavailable(reason) {
      if (unavailable === null) unavailable = reason;
    },
    unavailableReason: () => unavailable,
    hasConflict: () => conflicted,
    guards: () => [...observed].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision })),
  };
}

/**
 * Records each canonical read this call actually performs, and rejects an
 * authority answer whose returned identity is not the requested full ref.
 */
function trackAuthorityReads(authority: MaterialAuthorityReads, collector: FactsCollector): MaterialAuthorityReads {
  return {
    async load(ref) {
      const requestedKey = canonicalKey(ref);
      const result = await authority.load(ref);
      if (result.status === 'found') {
        if (requestedKey === null || canonicalKey(result.snapshot.ref) !== requestedKey) {
          const reason = 'the canonical material authority returned a snapshot for a different ref';
          collector.observeUnavailable(reason);
          return { status: 'unavailable', reason };
        }
        collector.observe(requestedKey, result.snapshot.revision);
        return result;
      }
      if (result.status === 'not_found') {
        if (requestedKey === null || canonicalKey(result.ref) !== requestedKey) {
          const reason = 'the canonical material authority not_found did not echo the requested ref';
          collector.observeUnavailable(reason);
          return { status: 'unavailable', reason };
        }
        collector.observe(requestedKey, null);
        return result;
      }
      // unavailable/corrupt stays explicit: the resolver must not turn it into
      // an empty grant list that looks like "nothing authorizes this material".
      collector.observeUnavailable(result.reason);
      return result;
    },
  };
}

/** Candidate projections are finders only; remember a provider failure so the
 * call fails closed instead of succeeding through an empty candidate set. */
function trackCandidateReads(index: MaterialCandidateReads, collector: FactsCollector): MaterialCandidateReads {
  return {
    async materialAccessCandidates(query) {
      const result = await index.materialAccessCandidates(query);
      if (result.status === 'unavailable') collector.observeUnavailable(result.reason);
      return result;
    },
  };
}

/** The existing helper does not pass the caller's signal, so bind this call's
 * ORIGINAL signal to every trusted capture; the model never supplies one. */
function bindSourceSignal(port: SourceApplicabilityPort, signal: AbortSignal): SourceApplicabilityPort {
  return {
    capture(query, providedSignal) {
      return port.capture(query, providedSignal ?? signal);
    },
  };
}

function canonicalKey(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}

function rejection(code: 'cancelled' | 'unavailable' | 'revision_conflict', reason: string): ReadResult<ArtifactRecord> {
  return { status: 'rejected', code, reason };
}

/** Builds the WorkGraph material read-facts port. */
export function createMaterialReadFactsService(deps: MaterialReadFactsDependencies): MaterialReadFactsPort {
  return {
    async openArtifactFacts(
      ctx: CoreCallContext,
      input: Parameters<MaterialReadFactsPort['openArtifactFacts']>[1],
    ): Promise<MaterialReadFacts> {
      // Freeze the caller-owned context/input synchronously, before the first
      // await, keeping the ORIGINAL signal so cancellation reaches every nested
      // read. The ordinary service admission is never bypassed.
      const signal = ctx.signal;
      const principal = structuredClone(ctx.principal);
      const materialReader = structuredClone(ctx.materialReader);
      const projectId = ctx.projectId;
      const workspaceId = ctx.workspaceId;
      const ref = structuredClone(input.ref);
      const usage = input.usage;

      const collector = createFactsCollector();
      const authority = trackAuthorityReads(deps.authority, collector);
      const index = trackCandidateReads(deps.index, collector);
      const sourcePort = deps.sourceApplicability;
      const source = sourcePort === undefined ? undefined : bindSourceSignal(sourcePort, signal);

      const grants = createMaterialAccessResolver(authority, index, source);
      const service = createMaterialService({ bodies: deps.bodies, authority, grants, now: deps.now });

      const frozenCtx: CoreCallContext = {
        projectId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        principal,
        materialReader,
        signal,
      };
      const result = await service.openArtifact(frozenCtx, { ref, usage });

      if (signal.aborted) {
        return { result: rejection('cancelled', 'material read facts were cancelled'), guards: [] };
      }
      const unavailable = collector.unavailableReason();
      if (unavailable !== null) return { result: rejection('unavailable', unavailable), guards: [] };
      if (collector.hasConflict()) {
        return {
          result: rejection('revision_conflict', 'the material read observed two different versions of the same canonical record'),
          guards: [],
        };
      }
      return result.status === 'ready' ? { result, guards: collector.guards() } : { result, guards: [] };
    },
  };
}
