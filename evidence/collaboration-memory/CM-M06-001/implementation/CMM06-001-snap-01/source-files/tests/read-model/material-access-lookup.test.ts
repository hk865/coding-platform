import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
import { expect, it } from 'vitest';
import { ReadModelIndexImpl } from '../../src/data/read-model-index/read-model-index.js';
import { createSqliteReadModelIndex } from '../../src/data/read-model-index/sqlite-read-model-index.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from "../contract-support/fixtures/material-access-fixtures.js";
import { buildMaterialAccessGrantLedgerCommit } from "../../src/control/control-engine/records/material-access.js";
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';

it.each(['memory', 'sqlite'] as const)('%s exact lookup keeps all candidates and distinguishes full identity and material', async adapter => {
  const index = adapter === 'memory' ? new ReadModelIndexImpl(new ControlPolicyExplanation()) : createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ':memory:' });
  const reader = { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'shared-name' };
  const material: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 10, source: { kind: 'artifact', refId: 'body', revision: '1' } };
  const at = '2026-09-09T00:00:00.000Z';
  try {
    expect(await index.materialAccessCandidates({ reader, material })).toMatchObject({ status: 'not_ready' });
    const events = Array.from({ length: 258 }, (_, i) => {
      const selected = i === 257 ? { ...reader, goalId: 'other-goal' } : reader;
      const grant = buildMaterialAccessGrantV1({ grantId: 'grant-' + i, scope: { projectId: 'p', workspaceId: 'w', goalId: selected.goalId }, materials: [material], reader: selected,
        issuedBy: { aggregateType: 'Control', projectId: 'p', goalId: selected.goalId }, purpose: 'lookup regression', basis: { planRef: null, workspaceRevision: i, sourceDigest: null }, grantedAt: at });
      const command = buildGrantMaterialAccessCommand(grant, { commandId: 'c-' + i, projectId: 'p', actorKind: 'system', actorId: 'test', idempotencyKey: 'k-' + i, correlationId: 'c-' + i, submittedAt: at });
      return { cursor: makeCommitCursor(i + 1), event: buildMaterialAccessGrantLedgerCommit(command, { eventId: 'e-' + i, occurredAt: at }).events[0]! };
    });
    await index.advance({ afterCursor: null, throughCursor: makeCommitCursor(258), events, hasMore: false });
    const candidates = await index.materialAccessCandidates({ reader, material });
    expect(candidates.status).toBe('ready');
    if (candidates.status === 'ready') {
      expect(candidates.grants).toHaveLength(257);
      expect(candidates.grants.every(row => row.grant.reader.aggregateType === 'Run' && row.grant.reader.goalId === 'g')).toBe(true);
    }
    expect(await index.materialAccessCandidates({ reader, material: { ...material, sizeBytes: 11 } })).toMatchObject({ status: 'ready', grants: [] });
    expect(await index.materialAccessCandidates({ reader: { ...reader, projectId: 'another' }, material })).toMatchObject({ status: 'ready', grants: [] });
    const display = await index.materialAccessGrants({ projectId: 'p' });
    if (display.status === 'ready') expect(display.grants).toHaveLength(256);
  } finally { if ('close' in index) await index.close(); }
});
