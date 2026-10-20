import { describe, expect, it } from 'vitest';
import { artifactBodyDigest, artifactBodySize } from '../../src/contracts/artifact.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { MaterialOrigin, RawArtifactPut, RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type { MaterialAuthorityReads } from '../../src/core/work-graph/materials/applicability.js';

const source = (revision: string): SourceRefV1 => ({ kind: 'workspace', refId: 'workspace', revision });
const runA = { aggregateType: 'Run' as const, projectId: 'project-a', goalId: 'goal', runId: 'run-a' };
const runB = { aggregateType: 'Run' as const, projectId: 'project-a', goalId: 'goal', runId: 'run-b' };
const ownerInput = (owner = runA, revision = 'first'): RawArtifactPut => ({
  body: 'shared material', contentType: 'text/plain', sourceRefs: [source(revision)],
  origin: { kind: 'run', owner }, requestedAt: '2026-09-24T00:00:00Z',
});
const hostContext = (projectId = 'project-a', workspaceId = 'workspace', actorId = 'local-gui'): CoreCallContext => {
  const actor = { kind: 'human' as const, id: actorId };
  return { projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
};
const authority = { load: async (ref: { aggregateType: string }) =>
  ref.aggregateType === 'Run' || ref.aggregateType === 'QueryRun' ? { status: 'found', snapshot: { ref, workspaceSnapshot: { workspaceId: 'workspace' } } }
    : { status: 'missing' } } as unknown as MaterialAuthorityReads;
const readyBody = (origin: MaterialOrigin = { kind: 'run', owner: runA }) => {
  const body = 'shared material';
  const ref: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: artifactBodyDigest(body),
    sizeBytes: artifactBodySize(body), source: source('first') };
  const bodies: RawArtifactStorePort = {
    put: async () => { throw new Error('unexpected body write'); },
    read: async () => ({ status: 'ready', value: { ref, body, sourceRefs: [source('first')], origin } }),
  };
  return { bodies, ref };
};

describe('R3b raw body contract', () => {
it('keeps the first owner, source and ref on duplicate memory puts without leaking mutable records', async () => {
  const store = new RawArtifactBodyStore();
  const first = await store.put(ownerInput());
  const replay = await store.put(ownerInput(runB, 'second'));
  expect(first.status).toBe('ready');
  expect(replay.status).toBe('ready');
  if (first.status !== 'ready' || replay.status !== 'ready') return;
  expect(first.value.replayed).toBe(false);
  expect(replay.value).toEqual({ ref: first.value.ref, replayed: true });
  const opened = await store.read(first.value.ref);
  expect(opened).toMatchObject({ status: 'ready', value: {
    body: 'shared material', sourceRefs: [source('first')], origin: { kind: 'run', owner: runA },
  } });
  if (opened.status !== 'ready') return;
  opened.value.sourceRefs[0]!.revision = 'mutated by reader';
  expect(await store.read(first.value.ref)).toMatchObject({ status: 'ready', value: { sourceRefs: [source('first')] } });
});

});

describe('R3b WorkGraph material contract', () => {
it('stores a Host artifact only for a matching trusted origin and isolates caller input', async () => {
  const { ref } = readyBody();
  const observed: RawArtifactPut[] = [];
  const bodies: RawArtifactStorePort = {
    put: async input => { observed.push(input); return { status: 'ready', value: { ref, replayed: false } }; },
    read: async () => { throw new Error('unexpected body read'); },
  };
  const service = createMaterialService({ bodies, authority, now: () => '2026-09-24T00:00:00Z' });
  const ctx = hostContext();
  const origin = { kind: 'platform_operation' as const, projectId: 'project-a', workspaceId: 'workspace',
    requestId: 'request-1', actor: { kind: 'human' as const, id: 'local-gui' } };
  const sources = [source('first')];
  expect(await service.storeArtifact(ctx, { body: 'shared material', contentType: 'text/plain', sources, origin }))
    .toMatchObject({ status: 'stored', ref, replayed: false });
  sources[0]!.revision = 'changed after call';
  expect(observed).toMatchObject([{ sourceRefs: [source('first')], origin }]);
  expect(await service.storeArtifact(ctx, { body: 'shared material', contentType: 'text/plain', sources: [source('first')],
    origin: { ...origin, actor: { kind: 'human', id: 'forged-user' } } }))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(observed).toHaveLength(1);
});

it('allows a trustworthy Host historical read without a fabricated Run and rejects scope or actor mismatch', async () => {
  const { bodies, ref } = readyBody();
  const service = createMaterialService({ bodies, authority, now: () => '2026-09-24T00:00:00Z' });
  const input = { ref, usage: 'historical_explanation' as const };
  expect(await service.openArtifact(hostContext(), input)).toMatchObject({ status: 'ready', value: { body: 'shared material' } });
  expect(await service.openArtifact(hostContext('project-b'), input)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  const mismatched = { ...hostContext(), materialReader: hostContext('project-b').materialReader };
  expect(await service.openArtifact(mismatched, input)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  const wrongActor = { ...hostContext(), materialReader: hostContext('project-a', 'workspace', 'other').materialReader };
  expect(await service.openArtifact(wrongActor, input)).toMatchObject({ status: 'rejected', code: 'forbidden' });
});

it('keeps Host current reads from asserting unverified currentness', async () => {
  const { bodies, ref } = readyBody();
  const service = createMaterialService({ bodies, authority, now: () => '2026-09-24T00:00:00Z' });
  expect(await service.openArtifact(hostContext(), { ref, usage: 'current' }))
    .toMatchObject({ status: 'rejected', code: 'source_stale' });
});

});
