import { expect, it, vi } from 'vitest';
import { HistoryMaterialsContext } from '../../src/data/context-compiler/history-materials-context.js';
import type { MaterialAccessGrantV1, MaterialAccessResolver } from '../../src/contracts/material-access.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { StateLedger } from '../../src/contracts/ledger.js';
import type { MaterialPort } from '../../src/core/work-graph/materials/contracts.js';

const scope = { projectId: 'host-boundary-project', workspaceId: 'host-boundary-workspace', goalId: 'host-boundary-goal' };
const owner = { aggregateType: 'Run' as const, projectId: scope.projectId, goalId: 'source-goal', runId: 'source-run' };
const reader = { aggregateType: 'Run' as const, projectId: scope.projectId, goalId: scope.goalId, runId: 'reader-run' };
const ref = { kind: 'artifact' as const, contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 4,
  source: { kind: 'workspace' as const, refId: scope.workspaceId, revision: '1' } };
const grant: MaterialAccessGrantV1 = { schemaVersion: 1, grantId: 'history-grant', scope, reader, materials: [ref],
  issuedBy: { aggregateType: 'Control', projectId: scope.projectId, goalId: scope.goalId },
  purpose: 'Original report', basis: { planRef: null, workspaceRevision: 1, sourceDigest: null },
  grantedAt: '2026-09-24T00:00:00Z', history: { owner, usage: 'historical_explanation' } };
const ledger = { load: async () => ({ status: 'found', snapshot: { ref: { aggregateType: 'MaterialAccessGrant', ...scope,
  grantId: grant.grantId }, revision: 1, schemaVersion: 1, grant } }) } as unknown as Pick<StateLedger, 'load'>;
const actor = { kind: 'human' as const, id: 'local-gui' };
const hostContext: CoreCallContext = { projectId: scope.projectId, workspaceId: scope.workspaceId,
  principal: { kind: 'host', actor }, materialReader: { kind: 'host', projectId: scope.projectId,
    workspaceId: scope.workspaceId, actor }, signal: new AbortController().signal };
const readHostContext = () => hostContext;
const vault = { open: async () => { throw Error('Host read fell back to legacy vault'); } };

it('fails closed when a configured Host material path lacks canonical basis validation', async () => {
  const openArtifact = vi.fn<MaterialPort['openArtifact']>(async () => ({ status: 'ready',
    value: { ref, body: 'body', sourceRefs: [ref.source], ownerRunRef: owner } }));
  const grantAuthority: MaterialAccessResolver = { grantsFor: async () => [grant] }; // Deliberately no currentBasisValid.
  let rejection: unknown;
  let result: Awaited<ReturnType<HistoryMaterialsContext['read']>> | undefined;
  try {
    const context = new HistoryMaterialsContext({ ledger, vault, materials: { openArtifact }, readHostContext, grantAuthority });
    result = await context.read({ scope, grantId: grant.grantId });
  } catch (error) {
    rejection = error;
  }
  if (rejection !== undefined) expect(String(rejection)).toMatch(/basis|currentBasisValid|authority|权威|校验/i);
  else expect(result?.result).toMatchObject({ status: 'rejected' });
  expect(openArtifact).not.toHaveBeenCalled();
});

it('rechecks the canonical basis after a single Host body read before returning it', async () => {
  let release!: () => void;
  const bodyReady = new Promise<void>(resolve => { release = resolve; });
  let valid = true;
  const currentBasisValid = vi.fn(async () => valid);
  const grantAuthority: MaterialAccessResolver = { grantsFor: async () => [grant], currentBasisValid };
  const openArtifact = vi.fn<MaterialPort['openArtifact']>(async () => {
    await bodyReady;
    return { status: 'ready', value: { ref, body: 'body', sourceRefs: [ref.source], ownerRunRef: owner } };
  });
  const context = new HistoryMaterialsContext({ ledger, vault, materials: { openArtifact }, readHostContext, grantAuthority });
  const reading = context.read({ scope, grantId: grant.grantId }).catch(error => error as unknown);
  // Wait for the body read to start; the first basis check must have succeeded.
  await vi.waitFor(() => expect(openArtifact).toHaveBeenCalledTimes(1));
  valid = false;
  release();
  expect(await reading).toMatchObject({ grant, result: { status: 'rejected', code: 'stale' },
    applicability: 'historical_explanation' });
  expect(openArtifact).toHaveBeenCalledTimes(1);
  expect(currentBasisValid).toHaveBeenCalledTimes(2);
});

it.each([
  ['wrong Control goal', { ...grant, issuedBy: { aggregateType: 'Control', projectId: scope.projectId, goalId: 'other-goal' } }],
  ['Run issuer instead of Control', { ...grant, issuedBy: owner }],
  ['wrong history usage', { ...grant, history: { owner, usage: 'current' } }],
] as const)('refuses a persisted history grant with %s before reading its body', async (_name, malformed) => {
  // Model a legacy committed record: the candidate finder and canonical Ledger
  // agree about the row, but its issuer/history claim is not a valid history grant.
  const invalid = malformed as unknown as MaterialAccessGrantV1;
  const grantRef = { aggregateType: 'MaterialAccessGrant' as const, ...scope, grantId: invalid.grantId };
  const matchingLedger = { load: async (requested: typeof grantRef) =>
    requested.aggregateType === grantRef.aggregateType && requested.projectId === grantRef.projectId &&
      requested.workspaceId === grantRef.workspaceId && requested.goalId === grantRef.goalId &&
      requested.grantId === grantRef.grantId
      ? { status: 'found' as const, snapshot: { ref: grantRef, revision: 1, schemaVersion: 1, grant: invalid } }
      : { status: 'missing' as const } } as unknown as Pick<StateLedger, 'load'>;
  const openArtifact = vi.fn<MaterialPort['openArtifact']>(async () => ({ status: 'ready',
    value: { ref, body: 'body', sourceRefs: [ref.source], ownerRunRef: owner } }));
  const grantAuthority: MaterialAccessResolver = { grantsFor: async () => [invalid], currentBasisValid: async () => true };
  const context = new HistoryMaterialsContext({ ledger: matchingLedger, vault, materials: { openArtifact },
    readHostContext, grantAuthority });
  expect(await context.read({ scope, grantId: invalid.grantId })).toMatchObject({
    grant: invalid, result: { status: 'rejected', code: 'forbidden' }, applicability: 'historical_explanation',
  });
  expect(openArtifact).not.toHaveBeenCalled();
});
