import { expect, it } from 'vitest';
import { artifactBodyDigest, artifactBodySize } from '../../src/contracts/artifact.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext, PlatformMaterialOrigin } from '../../src/contracts/core/call-context.js';
import type { RawArtifactRecord, RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createLegacyArtifactPort, createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type { MaterialAuthorityReads } from '../../src/core/work-graph/materials/applicability.js';
import type { MaterialAccessResolver } from '../../src/contracts/material-access.js';

const actor = { kind: 'human' as const, id: 'operator' };
const source = { kind: 'workspace' as const, refId: 'source-workspace', revision: '1' };
const body = 'platform material';
const ref: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: artifactBodyDigest(body),
  sizeBytes: artifactBodySize(body), source };
const origin: PlatformMaterialOrigin = { kind: 'platform_operation', projectId: 'owner-project',
  workspaceId: 'owner-workspace', requestId: 'request-1', actor };
const record: RawArtifactRecord = { ref, body, sourceRefs: [source], origin };
const authority = { load: async () => ({ status: 'missing' }) } as unknown as MaterialAuthorityReads;
const grants: MaterialAccessResolver = { grantsFor: async () => [] };
const ctx = (projectId: string, workspaceId: string, signal = new AbortController().signal): CoreCallContext => ({
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal,
});
const pending = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
};
const service = (bodies: RawArtifactStorePort) => createMaterialService({ bodies, authority, grants,
  now: () => '2026-09-24T00:00:00Z' });
const historical = { ref, usage: 'historical_explanation' as const };

it('lets a Host read its own newly stored platform artifact but keeps project and workspace scope exact', async () => {
  let stored: RawArtifactRecord | undefined;
  const raw: RawArtifactStorePort = {
    put: async input => {
      stored = { ref, body: input.body, sourceRefs: input.sourceRefs, origin: input.origin };
      return { status: 'ready', value: { ref, replayed: false } };
    },
    read: async () => stored ? { status: 'ready', value: stored }
      : { status: 'rejected', code: 'not_found', reason: 'body not yet stored' },
  };
  const materials = service(raw);
  expect(await materials.storeArtifact(ctx('owner-project', 'owner-workspace'), {
    contentType: 'text/plain', body, sources: [source], origin,
  })).toMatchObject({ status: 'stored', ref });
  expect(stored?.origin).toEqual(origin);
  expect(await materials.openArtifact(ctx('owner-project', 'owner-workspace'), historical))
    .toMatchObject({ status: 'ready', value: { body, ref } });
  expect(await materials.openArtifact(ctx('other-project', 'owner-workspace'), historical))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await materials.openArtifact(ctx('owner-project', 'other-workspace'), historical))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
});

it('uses the material reader identity at call admission even if its object mutates during raw I/O', async () => {
  const gate = pending<Awaited<ReturnType<RawArtifactStorePort['read']>>>();
  const raw: RawArtifactStorePort = { put: async () => { throw Error('unexpected put'); }, read: () => gate.promise };
  const materials = service(raw);
  const request = ctx('other-project', 'owner-workspace');
  const opening = materials.openArtifact(request, historical);
  expect(request.materialReader.kind).toBe('host');
  if (request.materialReader.kind === 'host') request.materialReader.projectId = 'owner-project';
  gate.resolve({ status: 'ready', value: record });
  expect(await opening).toMatchObject({ status: 'rejected', code: 'forbidden' });
});

it('does not let a later caller mutation revoke a valid reader while the body read is waiting', async () => {
  const gate = pending<Awaited<ReturnType<RawArtifactStorePort['read']>>>();
  const raw: RawArtifactStorePort = { put: async () => { throw Error('unexpected put'); }, read: () => gate.promise };
  const materials = service(raw);
  const request = ctx('owner-project', 'owner-workspace');
  const opening = materials.openArtifact(request, historical);
  expect(request.materialReader.kind).toBe('host');
  if (request.materialReader.kind === 'host') request.materialReader.projectId = 'other-project';
  gate.resolve({ status: 'ready', value: record });
  expect(await opening).toMatchObject({ status: 'ready', value: { body } });
});

it('returns cancelled if a body read completes only after the caller aborts', async () => {
  const controller = new AbortController();
  const gate = pending<Awaited<ReturnType<RawArtifactStorePort['read']>>>();
  const raw: RawArtifactStorePort = { put: async () => { throw Error('unexpected put'); }, read: () => gate.promise };
  const materials = service(raw);
  const opening = materials.openArtifact(ctx('owner-project', 'owner-workspace', controller.signal), historical);
  controller.abort(new Error('caller left'));
  gate.resolve({ status: 'ready', value: record });
  expect(await opening).toMatchObject({ status: 'rejected', code: 'cancelled' });
});

it('maps raw corruption to unavailable for Core and invalid for legacy without hiding the reason', async () => {
  const reason = 'stored artifact digest mismatch at key';
  const raw: RawArtifactStorePort = { put: async () => { throw Error('unexpected put'); },
    read: async () => ({ status: 'rejected', code: 'corrupt', reason }) };
  expect(await service(raw).openArtifact(ctx('owner-project', 'owner-workspace'), historical))
    .toMatchObject({ status: 'rejected', code: 'unavailable', reason: expect.stringContaining(reason) });
  const legacy = createLegacyArtifactPort({ bodies: raw, authority, grants, now: () => '2026-09-24T00:00:00Z' });
  expect(await legacy.open(ref, { requesterRunRef: { aggregateType: 'Run', projectId: 'owner-project',
    goalId: 'goal', runId: 'run' } }))
    .toMatchObject({ status: 'rejected', code: 'invalid', issues: [expect.stringContaining(reason)] });
});

it('binds a Core work_run owner read to the canonical Run workspace as well as its full Run ref', async () => {
  const run = { aggregateType: 'Run' as const, projectId: 'owner-project', goalId: 'goal', runId: 'owner-run' };
  const runRecord: RawArtifactRecord = { ...record, origin: { kind: 'run', owner: run } };
  const raw: RawArtifactStorePort = { put: async () => { throw Error('unexpected put'); },
    read: async () => ({ status: 'ready', value: runRecord }) };
  const canonical: MaterialAuthorityReads = { load: async (ref: { aggregateType: string; projectId: string; goalId?: string; runId?: string }) => ref.aggregateType === 'Run' &&
    ref.projectId === run.projectId && ref.goalId === run.goalId && ref.runId === run.runId
      ? { status: 'found', snapshot: { ref: run, workspaceSnapshot: { workspaceId: 'actual-workspace' } } }
      : { status: 'missing' } } as unknown as MaterialAuthorityReads;
  const materials = createMaterialService({ bodies: raw, authority: canonical, grants,
    now: () => '2026-09-24T00:00:00Z' });
  const roleBinding = { schemaVersion: 1 as const, bindingId: 'owner-role', templateId: 'worker',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'policy-1' };
  const workContext = (workspaceId: string): CoreCallContext => ({ projectId: run.projectId, workspaceId,
    principal: { kind: 'work_run', runRef: run, roleBinding },
    materialReader: { kind: 'run', requester: run }, signal: new AbortController().signal });
  expect(await materials.openArtifact(workContext('actual-workspace'), historical))
    .toMatchObject({ status: 'ready', value: { body } });
  expect(await materials.openArtifact(workContext('other-workspace'), historical))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
});
