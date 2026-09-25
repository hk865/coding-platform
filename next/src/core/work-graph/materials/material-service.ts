import type { CoreCallContext, CorePrincipal, MaterialReader } from '../../../contracts/core/call-context.js';
import type { ArtifactRecord, ArtifactRef } from '../../../contracts/artifact.js';
import { ARTIFACT_MAX_SIZE_BYTES, artifactBodySize } from '../../../contracts/artifact.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { RawArtifactPut, RawArtifactRecord, RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { StoreFailure, StoreResult } from '../../record-store/ports.js';
import type { RunRef, RunSnapshot, SourceRefV1 } from '../../../contracts/dispatch.js';
import type { MaterialAccessResolver } from '../../../contracts/material-access.js';
import { sameArtifactOwnerRunRef } from '../../../contracts/material-access.js';
import type { MaterialPort, MaterialWriteOrigin, StoreArtifactResult } from './contracts.js';
import type { MaterialAuthorityReads } from './applicability.js';
import { createMaterialApplicability, materialOwnerFromOrigin } from './applicability.js';

export type MaterialServiceDependencies = {
  bodies: RawArtifactStorePort;
  authority: MaterialAuthorityReads;
  grants: MaterialAccessResolver;
  now(): string;
};

type BodyPutOrigin = RawArtifactPut['origin'];
type StorePutResult = StoreResult<{ ref: ArtifactRef; replayed: boolean }>;
type ApplicabilityFn = ReturnType<typeof createMaterialApplicability>;
type MaterialAdmission = Awaited<ReturnType<ApplicabilityFn>>;
type StoreRejectionCode = Extract<StoreArtifactResult, { status: 'rejected' }>['code'];
type RunPrincipal = Extract<CorePrincipal, { kind: 'work_run' }>;

/** Internal read outcome keeps the physical error semantics until each protocol
 * boundary converts once (Core -> unavailable, legacy ArtifactPort -> invalid). */
type MaterialReadFailure =
  | { kind: 'not_found' }
  | { kind: 'corrupt'; reason: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'forbidden'; reason: string }
  | { kind: 'source_stale'; reason: string }
  | { kind: 'cancelled'; reason: string };
type MaterialReadOutcome =
  | { status: 'ready'; value: ArtifactRecord }
  | { status: 'failed'; failure: MaterialReadFailure };

type MaterialCore = {
  storeRawBody(input: {
    contentType: string; body: string; sourceRefs: SourceRefV1[]; origin: BodyPutOrigin; requestedAt: string;
  }): Promise<StoreArtifactResult>;
  readArtifact(
    reader: MaterialReader,
    ref: ArtifactRef,
    usage: 'current' | 'historical_explanation' | undefined,
    signal?: AbortSignal,
  ): Promise<MaterialReadOutcome>;
};

function createMaterialCore(deps: MaterialServiceDependencies): MaterialCore {
  const applicability = createMaterialApplicability({ authority: deps.authority, grants: deps.grants });
  return {
    async storeRawBody(input) {
      if (typeof input.contentType !== 'string' || input.contentType.length === 0) {
        return { status: 'rejected', code: 'invalid', reason: 'contentType must be a non-empty string' };
      }
      if (typeof input.body !== 'string') {
        return { status: 'rejected', code: 'invalid', reason: 'body must be a string' };
      }
      if (input.sourceRefs.length === 0) {
        return { status: 'rejected', code: 'missing_source', reason: 'sourceRefs must not be empty' };
      }
      const sizeBytes = artifactBodySize(input.body);
      if (sizeBytes > ARTIFACT_MAX_SIZE_BYTES) {
        return { status: 'rejected', code: 'size_exceeded', reason: `body size ${sizeBytes} exceeds ${ARTIFACT_MAX_SIZE_BYTES}` };
      }
      let stored: StorePutResult;
      try {
        stored = await deps.bodies.put({
          contentType: input.contentType, body: input.body, sourceRefs: input.sourceRefs,
          origin: input.origin, requestedAt: input.requestedAt,
        });
      } catch (error) {
        return { status: 'rejected', code: 'unavailable', reason: errorText(error) };
      }
      if (stored.status === 'ready') return { status: 'stored', ref: stored.value.ref, replayed: stored.value.replayed };
      return { status: 'rejected', code: mapBodyStoreError(stored), reason: stored.reason };
    },

    async readArtifact(reader, ref, usage, signal) {
      if (signal?.aborted) return cancelledRead();
      let stored: StoreResult<RawArtifactRecord>;
      try {
        stored = await deps.bodies.read(ref);
      } catch (error) {
        return failed({ kind: 'unavailable', reason: errorText(error) });
      }
      // A read has no side effect to roll back: once the caller has aborted, do
      // not hand back a body even though the physical read already committed.
      if (signal?.aborted) return cancelledRead();
      if (stored.status !== 'ready') return failed(fromStoreFailure(stored));
      const raw = stored.value;
      let admission: MaterialAdmission;
      try {
        admission = await applicability({ reader, ref, origin: raw.origin, usage });
      } catch (error) {
        return failed({ kind: 'unavailable', reason: errorText(error) });
      }
      if (signal?.aborted) return cancelledRead();
      if (admission.status === 'rejected') return failed({ kind: admission.code, reason: admission.reason });
      const owner = materialOwnerFromOrigin(raw.origin);
      const value: ArtifactRecord = {
        ref: raw.ref,
        body: raw.body,
        sourceRefs: raw.sourceRefs,
        ...(owner !== null ? { ownerRunRef: owner } : {}),
        ...(admission.applicability !== undefined ? { applicability: admission.applicability } : {}),
      };
      return { status: 'ready', value };
    },
  };
}

export function createMaterialService(deps: MaterialServiceDependencies): MaterialPort {
  const core = createMaterialCore(deps);
  return {
    async storeArtifact(ctx: CoreCallContext, input: {
      contentType: string; body: string; sources: SourceRefV1[]; origin: MaterialWriteOrigin;
    }): Promise<StoreArtifactResult> {
      // Isolate every caller-owned input synchronously, before the first await.
      const contentType = input.contentType;
      const body = input.body;
      const sourceRefs = input.sources.map(source => ({ ...source }));
      const origin = structuredClone(input.origin);
      const principal = snapshotPrincipal(ctx.principal);
      const reader = snapshotReader(ctx.materialReader);
      const projectId = ctx.projectId;
      const workspaceId = ctx.workspaceId;
      const signal = ctx.signal;
      if (signal.aborted) {
        return { status: 'rejected', code: 'cancelled', reason: 'material store was cancelled' };
      }
      if (!contextReaderMatchesPrincipal(principal, reader, projectId, workspaceId)) {
        return { status: 'rejected', code: 'forbidden', reason: 'CoreCallContext principal, scope and materialReader disagree' };
      }
      if (!writeOriginMatchesContext(principal, projectId, workspaceId, origin)) {
        return { status: 'rejected', code: 'forbidden', reason: 'material write origin does not match the trusted caller' };
      }
      if (principal.kind === 'work_run') {
        const bound = await workRunWorkspaceBound(deps, principal, workspaceId);
        // The canonical lookup may have waited; the caller's signal is the one
        // admitted at entry. Do not start the raw write when it was aborted.
        if (signal.aborted) {
          return { status: 'rejected', code: 'cancelled', reason: 'material store was cancelled' };
        }
        if (bound !== 'ok') return { status: 'rejected', code: bound === 'forbidden' ? 'forbidden' : 'unavailable',
          reason: bound === 'forbidden' ? 'the run workspace does not match the canonical Run scope' : 'the canonical Run scope could not be read' };
      }
      const rawOrigin: BodyPutOrigin = origin.kind === 'execution'
        ? { kind: 'run', owner: structuredClone(origin.ref) }
        : structuredClone(origin);
      return core.storeRawBody({ contentType, body, sourceRefs, origin: rawOrigin, requestedAt: deps.now() });
    },
    async openArtifact(ctx: CoreCallContext, input: {
      ref: ArtifactRef; usage: 'current' | 'historical_explanation';
    }): Promise<ReadResult<ArtifactRecord>> {
      const ref = structuredClone(input.ref);
      const usage = input.usage;
      const principal = snapshotPrincipal(ctx.principal);
      const reader = snapshotReader(ctx.materialReader);
      const projectId = ctx.projectId;
      const workspaceId = ctx.workspaceId;
      const signal = ctx.signal;
      if (signal.aborted) return coreReadFailure({ kind: 'cancelled', reason: 'material open was cancelled' });
      if (!contextReaderMatchesPrincipal(principal, reader, projectId, workspaceId)) {
        return coreReadFailure({ kind: 'forbidden', reason: 'CoreCallContext principal, scope and materialReader disagree' });
      }
      if (principal.kind === 'work_run') {
        const bound = await workRunWorkspaceBound(deps, principal, workspaceId);
        if (signal.aborted) return coreReadFailure({ kind: 'cancelled', reason: 'material open was cancelled' });
        if (bound !== 'ok') return coreReadFailure({ kind: bound === 'forbidden' ? 'forbidden' : 'unavailable',
          reason: bound === 'forbidden' ? 'the run workspace does not match the canonical Run scope' : 'the canonical Run scope could not be read' });
      }
      const outcome = await core.readArtifact(reader, ref, usage, signal);
      return outcome.status === 'ready' ? { status: 'ready', value: outcome.value } : coreReadFailure(outcome.failure);
    },
  };
}

function coreReadFailure(failure: MaterialReadFailure): ReadResult<ArtifactRecord> {
  switch (failure.kind) {
    case 'not_found': return { status: 'not_found' };
    case 'corrupt': return { status: 'rejected', code: 'unavailable', reason: failure.reason };
    case 'invalid': return { status: 'rejected', code: 'invalid', reason: failure.reason };
    case 'unsupported': return { status: 'rejected', code: 'unsupported', reason: failure.reason };
    case 'unavailable': return { status: 'rejected', code: 'unavailable', reason: failure.reason };
    case 'forbidden': return { status: 'rejected', code: 'forbidden', reason: failure.reason };
    case 'source_stale': return { status: 'rejected', code: 'source_stale', reason: failure.reason };
    case 'cancelled': return { status: 'rejected', code: 'cancelled', reason: failure.reason };
  }
}

function failed(failure: MaterialReadFailure): MaterialReadOutcome {
  return { status: 'failed', failure };
}

function cancelledRead(): MaterialReadOutcome {
  return failed({ kind: 'cancelled', reason: 'material read was cancelled' });
}

function fromStoreFailure(failure: StoreFailure): MaterialReadFailure {
  switch (failure.code) {
    case 'not_found': return { kind: 'not_found' };
    case 'corrupt': return { kind: 'corrupt', reason: failure.reason };
    case 'unique_conflict': return { kind: 'unavailable', reason: failure.reason };
    case 'invalid': return { kind: 'invalid', reason: failure.reason };
    case 'unsupported': return { kind: 'unsupported', reason: failure.reason };
    case 'revision_conflict':
    case 'idempotency_conflict':
    case 'unavailable': return { kind: 'unavailable', reason: failure.reason };
  }
}

async function workRunWorkspaceBound(deps: MaterialServiceDependencies, principal: RunPrincipal, workspaceId: string | undefined): Promise<'ok' | 'forbidden' | 'unavailable'> {
  try {
    return await canonicalRunScopeMatches(deps.authority, principal.runRef, workspaceId) ? 'ok' : 'forbidden';
  } catch {
    return 'unavailable';
  }
}

async function canonicalRunScopeMatches(authority: MaterialAuthorityReads, runRef: RunRef, workspaceId: string | undefined): Promise<boolean> {
  const canonical = await authority.load(runRef);
  if (canonical.status !== 'found') return false;
  const snapshot = canonical.snapshot as RunSnapshot;
  return sameArtifactOwnerRunRef(snapshot.ref, runRef) && snapshot.workspaceSnapshot.workspaceId === workspaceId;
}

function snapshotReader(reader: MaterialReader): MaterialReader {
  if (reader.kind === 'host') {
    return { kind: 'host', projectId: reader.projectId,
      ...(reader.workspaceId !== undefined ? { workspaceId: reader.workspaceId } : {}), actor: { ...reader.actor } };
  }
  return { kind: 'run', requester: structuredClone(reader.requester),
    ...(reader.currentBasis !== undefined ? { currentBasis: structuredClone(reader.currentBasis) } : {}) };
}

function snapshotPrincipal(principal: CorePrincipal): CorePrincipal {
  if (principal.kind === 'host') return { kind: 'host', actor: { ...principal.actor } };
  if (principal.kind === 'work_run') {
    return { kind: 'work_run', runRef: structuredClone(principal.runRef), roleBinding: structuredClone(principal.roleBinding),
      ...(principal.agentPrincipal !== undefined ? { agentPrincipal: structuredClone(principal.agentPrincipal) } : {}) };
  }
  return { kind: 'query_run', queryRunRef: structuredClone(principal.queryRunRef), initiator: { ...principal.initiator } };
}

function contextReaderMatchesPrincipal(
  principal: CorePrincipal,
  reader: MaterialReader,
  projectId: string,
  workspaceId: string | undefined,
): boolean {
  if (principal.kind === 'host') {
    if (reader.kind !== 'host') return false;
    if (reader.projectId !== projectId) return false;
    if (reader.workspaceId !== workspaceId) return false;
    return sameActor(reader.actor, principal.actor);
  }
  if (reader.kind !== 'run') return false;
  if (principal.kind === 'work_run') {
    if (reader.requester.aggregateType !== 'Run' || !sameArtifactOwnerRunRef(reader.requester, principal.runRef)) return false;
  } else {
    if (reader.requester.aggregateType !== 'QueryRun' || !sameArtifactOwnerRunRef(reader.requester, principal.queryRunRef)) return false;
    if (workspaceId !== undefined && reader.requester.workspaceId !== workspaceId) return false;
  }
  return reader.requester.projectId === projectId;
}

function writeOriginMatchesContext(
  principal: CorePrincipal,
  projectId: string,
  workspaceId: string | undefined,
  origin: MaterialWriteOrigin,
): boolean {
  if (!origin || typeof origin !== 'object') return false;
  if (origin.kind === 'platform_operation') {
    if (principal.kind !== 'host') return false;
    if (!sameActor(origin.actor, principal.actor)) return false;
    if (origin.projectId !== projectId) return false;
    if (origin.workspaceId !== undefined && origin.workspaceId !== workspaceId) return false;
    return true;
  }
  if (origin.kind !== 'execution' || !origin.ref) return false;
  if (origin.ref.projectId !== projectId) return false;
  if (principal.kind === 'work_run') {
    return origin.ref.aggregateType === 'Run' && sameArtifactOwnerRunRef(origin.ref, principal.runRef);
  }
  if (principal.kind === 'query_run') {
    if (origin.ref.aggregateType !== 'QueryRun' || !sameArtifactOwnerRunRef(origin.ref, principal.queryRunRef)) return false;
    return workspaceId === undefined || origin.ref.workspaceId === workspaceId;
  }
  return false;
}

function sameActor(a: { kind: string; id: string }, b: { kind: string; id: string }): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function mapBodyStoreError(failure: StoreFailure): 'invalid' | 'not_found' | 'revision_conflict' | 'idempotency_conflict' | 'unsupported' | 'unavailable' {
  switch (failure.code) {
    case 'invalid': return 'invalid';
    case 'not_found': return 'not_found';
    case 'revision_conflict': return 'revision_conflict';
    case 'idempotency_conflict': return 'idempotency_conflict';
    case 'corrupt':
    case 'unique_conflict': return 'unavailable';
    case 'unsupported': return 'unsupported';
    case 'unavailable': return 'unavailable';
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
