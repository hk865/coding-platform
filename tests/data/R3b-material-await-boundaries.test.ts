import { expect, it, vi } from 'vitest';
import { artifactBodyDigest, artifactBodySize } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { MaterialAuthorityReads } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type { MaterialAccessResolver } from '../../src/contracts/material-access.js';

const run: RunRef = { aggregateType: 'Run', projectId: 'await-project', goalId: 'await-goal', runId: 'await-run' };
const workspaceId = 'await-workspace';
const actor = { kind: 'human' as const, id: 'operator' };
const source = { kind: 'workspace' as const, refId: workspaceId, revision: '1' };
const body = 'Await boundary material';
const ref = { kind: 'artifact' as const, contentType: 'text/plain', digest: artifactBodyDigest(body),
  sizeBytes: artifactBodySize(body), source };
const grants: MaterialAccessResolver = { grantsFor: async () => [] };
const canonical = (refValue: RunRef) => ({ status: 'found' as const,
  snapshot: { ref: refValue, workspaceSnapshot: { workspaceId } } });
const workContext = (signal: AbortSignal): CoreCallContext => ({ projectId: run.projectId, workspaceId,
  principal: { kind: 'work_run', runRef: run, roleBinding: { schemaVersion: 1, bindingId: 'await-binding',
    templateId: 'worker', templateRevision: '1', bindingVersion: 1, policyRevision: 'policy-1' } },
  materialReader: { kind: 'run', requester: run }, signal });
const hostContext = (): CoreCallContext => ({ projectId: run.projectId, workspaceId,
  principal: { kind: 'host', actor }, materialReader: { kind: 'host', projectId: run.projectId, workspaceId, actor },
  signal: new AbortController().signal });

it('cancels a work-run write after canonical scope lookup without starting raw storage', async () => {
  let release!: (value: ReturnType<typeof canonical>) => void;
  const authority: MaterialAuthorityReads = { load: vi.fn(() => new Promise(resolve => { release = resolve; })) } as unknown as MaterialAuthorityReads;
  const put = vi.fn<RawArtifactStorePort['put']>(async () => ({ status: 'ready', value: { ref, replayed: false } }));
  const bodies: RawArtifactStorePort = { put, read: async () => { throw Error('unexpected raw read'); } };
  const materials = createMaterialService({ bodies, authority, grants, now: () => '2026-09-24T00:00:00Z' });
  const controller = new AbortController();
  const writing = materials.storeArtifact(workContext(controller.signal), {
    contentType: 'text/plain', body, sources: [source], origin: { kind: 'execution', ref: run },
  }).catch(error => error as unknown);
  expect(authority.load).toHaveBeenCalledWith(run);
  expect(put).not.toHaveBeenCalled();
  controller.abort(new Error('caller cancelled during canonical scope lookup'));
  release(canonical(run));
  expect(await writing).toMatchObject({ status: 'rejected', code: 'cancelled' });
  expect(put).not.toHaveBeenCalled();
});

it('requires the Host history owner load to return the requested canonical full ref', async () => {
  const bodies: RawArtifactStorePort = { put: async () => { throw Error('unexpected raw put'); },
    read: async () => ({ status: 'ready', value: { ref, body, sourceRefs: [source],
      origin: { kind: 'run', owner: run } } }) };
  let loadedRef: RunRef = run;
  const authority: MaterialAuthorityReads = { load: async () => canonical(loadedRef) } as unknown as MaterialAuthorityReads;
  const materials = createMaterialService({ bodies, authority, grants, now: () => '2026-09-24T00:00:00Z' });
  const request = { ref, usage: 'historical_explanation' as const };
  expect(await materials.openArtifact(hostContext(), request)).toMatchObject({ status: 'ready', value: { body } });
  loadedRef = { ...run, runId: 'different-run' };
  expect(await materials.openArtifact(hostContext(), request)).toMatchObject({ status: 'rejected', code: 'forbidden' });
});
