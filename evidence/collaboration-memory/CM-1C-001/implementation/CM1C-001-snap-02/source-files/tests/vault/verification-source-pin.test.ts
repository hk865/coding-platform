import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteArtifactVault } from '../../src/data/artifact-vault/sqlite-artifact-vault.js';
import { VerificationSourceApplicability } from '../../src/data/workspace-reader/verification-source-applicability.js';
import { ExplorationSourceApplicability } from '../../src/data/workspace-reader/exploration-source.js';
import { materialSourcePinIsCurrent } from '../../src/data/workspace-reader/source-applicability.js';
import { CandidateWorkspaceReader } from '../../src/data/workspace-reader/candidate-workspace-reader.js';
import { validMaterialSourceSet } from '../../src/contracts/material-access.js';
import type { MaterialAccessGrantV1 } from '../../src/contracts/material-access.js';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const scope = { projectId: 'project', workspaceId: 'workspace' };
const sourceSet = { kind: 'verification_workspace' as const, paths: ['.'] as ['.'] };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'verification-pin-')); dirs.push(dir);
  const root = join(dir, 'source'); await mkdir(root); await writeFile(join(root, 'source.ts'), 'export const reviewed = true;\n');
  const source = new VerificationSourceApplicability(() => root);
  const capture = await source.capture({ ...scope, sourceSet });
  if (capture.status !== 'sourced') throw Error(JSON.stringify(capture));
  return { dir, root, source, pin: capture.pin };
}
it('preserves Candidate exclusions in the new source kind while original exploration still binds all directories', async () => {
  const s = await fixture(), exploration = new ExplorationSourceApplicability(() => s.root);
  const before = await exploration.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['.'] } });
  await mkdir(join(s.root, 'dist')); await writeFile(join(s.root, 'dist', 'generated.js'), 'generated');
  expect(await materialSourcePinIsCurrent(s.source, s.pin, scope)).toBe(true);
  expect(await exploration.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['.'] } })).not.toEqual(before);
  expect(s.pin.identity.workspace).toBe('verification-source-v1:' + s.root);
  expect(s.pin.manifestDigest).not.toBe(await new CandidateWorkspaceReader().digest(s.root));
  expect(validMaterialSourceSet({ kind: 'verification_workspace', paths: ['src'] })).toBe(false);
  expect(await exploration.capture({ ...scope, sourceSet })).toMatchObject({ status: 'rejected' });
  expect(await s.source.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['.'] } })).toMatchObject({ status: 'rejected' });
});
it('checks the exact verification source pin across SQLite reopen and rejects actual corrupt stored report bodies', async () => {
  const s = await fixture(), path = join(s.dir, 'artifacts.sqlite');
  const owner = { aggregateType: 'Run' as const, projectId: scope.projectId, goalId: 'goal', runId: 'producer' };
  const reader = { ...owner, runId: 'reviewer' };
  const grants: MaterialAccessGrantV1[] = [];
  const options = { grants: { grantsFor: async () => grants, currentBasisValid: async (grant: MaterialAccessGrantV1) => materialSourcePinIsCurrent(s.source, grant.basis.sourcePin, scope) } };
  let vault = new SqliteArtifactVault(path, options);
  const basis = { planRef: null, workspaceRevision: 1, sourceDigest: await new CandidateWorkspaceReader().digest(s.root), sourcePin: s.pin };
  try {
    const put = await vault.put({ contentType: 'text/plain', body: 'Original tool report', sourceRefs: [{ kind: 'workspace', refId: scope.workspaceId, revision: '1' }], ownerRef: owner, requestedAt: '2026-09-09T00:00:00.000Z' });
    if (put.status !== 'stored') throw Error(JSON.stringify(put));
    grants.push({ schemaVersion: 1, grantId: 'grant', scope: { ...scope, goalId: 'goal' }, materials: [put.ref], reader, issuedBy: owner, purpose: 'review source', basis, grantedAt: '2026-09-09T00:00:00.000Z' });
    await vault.close(); vault = new SqliteArtifactVault(path, options);
    expect(await vault.open(put.ref, { requesterRunRef: reader, currentBasis: basis, usage: 'current', includeOwner: true })).toMatchObject({ status: 'ready', record: { ownerRunRef: owner, body: 'Original tool report' } });
    await writeFile(join(s.root, 'source.ts'), 'source changed\n');
    expect(await vault.open(put.ref, { requesterRunRef: reader, currentBasis: basis, usage: 'current' })).toMatchObject({ status: 'rejected', code: 'stale' });
    await writeFile(join(s.root, 'source.ts'), 'export const reviewed = true;\n');
    await vault.close();
    const db = new DatabaseSync(path); try { db.exec("UPDATE artifacts SET record=json_set(record,'$.body','corrupted original')"); } finally { db.close(); }
    vault = new SqliteArtifactVault(path, options);
    expect(await vault.open(put.ref, { requesterRunRef: reader, currentBasis: basis, usage: 'current' })).toMatchObject({ status: 'rejected', code: 'invalid' });
  } finally { await vault.close(); }
});
