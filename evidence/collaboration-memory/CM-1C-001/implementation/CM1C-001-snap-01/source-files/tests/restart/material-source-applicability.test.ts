import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createPersistentSqliteHarness } from '../../src/harness/persistent-harness.js';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from '../contract-support/fixtures/bootstrap-fixture-v1.js';
import { buildCreateGoalCommand, buildGoalCreateLedgerCommit } from '../contract-support/fixtures/goal-fixtures.js';
import { buildDispatchClaimCommand } from "../../src/fixtures/dispatch-fixtures.js";
import { buildDispatchClaimLedgerCommit } from "../../src/control/control-engine/records/dispatch.js";
import { buildGrantMaterialAccessCommand } from "../contract-support/fixtures/material-access-fixtures.js";
import { buildMaterialAccessGrantLedgerCommit } from "../../src/control/control-engine/records/material-access.js";
import type { MaterialAccessGrantV1, RevokeMaterialAccessCommand, SourceApplicabilityPort } from '../../src/contracts/material-access.js';
import { WorkspaceSourceApplicability } from '../../src/data/workspace-reader/source-applicability.js';
import { filesystemSourceAccess } from '../data/source-applicability-fixture.js';
import { ArtifactVault } from '../../src/data/artifact-vault/artifact-vault.js';

const AT = '2026-09-09T00:00:00.000Z';
const scope = { projectId: 'proj-alpha', workspaceId: 'ws-shared', goalId: 'goal-source' };
const run = (runId: string) => ({ aggregateType: 'Run' as const, projectId: scope.projectId, goalId: scope.goalId, runId });
const childNode = promisify(execFile);

it.each(['memory', 'sqlite'] as const)('source applicability checks real files without counter bumps and preserves historical reads/revocation (%s)', async adapter => {
  const dir = await mkdtemp(join(tmpdir(), 'material-source-host-'));
  const root = join(dir, 'source');
  await mkdir(root);
  await mkdir(join(dir, 'state'));
  await writeFile(join(root, 'main.py'), 'value = 1\n');
  const access = filesystemSourceAccess(root);
  let available = true;
  const sourceApplicability = new WorkspaceSourceApplicability(s => available && s.projectId === scope.projectId && s.workspaceId === scope.workspaceId ? access : null);
  // A reopened test harness resets its default deterministic sequence. Keep
  // event identities unique across this test's two hosts, as production does.
  let eventSequence = 0;
  const deps = { eventId: () => 'source-applicability-event-' + ++eventSequence };
  let duringCapture: { entered: () => void; resume: Promise<void> } | null = null;
  const sourcePort: SourceApplicabilityPort = { capture: async (query, signal) => { const result = await sourceApplicability.capture(query, signal); const paused = duringCapture; if (paused) { duringCapture = null; paused.entered(); await paused.resume; } return result; } };
  let persistent = adapter === 'sqlite' ? await createPersistentSqliteHarness({ dir: join(dir, 'state'), sourceApplicability: sourcePort, deps }) : null;
  let host = persistent ?? createInMemoryHarness({ sourceApplicability: sourcePort, deps });
  try {
    const boot = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: 'boot', correlationId: 'boot', submittedAt: AT });
    expect(await host.ledger.commit(buildBootstrapLedgerCommit(boot, { eventIds: ['b1', 'b2', 'b3', 'b4'], occurredAt: AT }))).toMatchObject({ status: 'committed' });
    const goal = buildCreateGoalCommand({ ...scope, objective: 'sourced grant', actor: { kind: 'human', id: 'test' } }, { commandId: 'goal', correlationId: 'goal', idempotencyKey: 'goal', submittedAt: AT });
    expect(await host.ledger.commit(buildGoalCreateLedgerCommit(goal, { eventId: 'goal', occurredAt: AT, projectRevision: 1, workspaceRevision: 1 }))).toMatchObject({ status: 'committed' });
    for (const runId of ['producer', 'consumer']) {
      const claim = buildDispatchClaimCommand({ commandId: runId, ...scope, taskId: 'task-' + runId, runId, attemptId: 'attempt-' + runId, idempotencyKey: runId, correlationId: runId, submittedAt: AT });
      expect(await host.ledger.commit(buildDispatchClaimLedgerCommit(claim, { eventId: runId, occurredAt: AT, workspaceId: scope.workspaceId, planRef: { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: 'plan' }, workspaceRevision: 1 }))).toMatchObject({ status: 'committed' });
    }
    const capture = await sourceApplicability.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['.'] } });
    if (capture.status !== 'sourced') throw Error(JSON.stringify(capture));
    const basis = { planRef: null, workspaceRevision: 1, sourceDigest: 'd'.repeat(64), sourcePin: capture.pin };
    const stored = await host.vault.put({ contentType: 'text/plain', body: 'Original source reasoning for value = 1', sourceRefs: [{ kind: 'workspace', refId: scope.workspaceId, revision: basis.sourceDigest }], ownerRef: run('producer'), requestedAt: AT });
    if (stored.status !== 'stored') throw Error('put failed');
    const grant: MaterialAccessGrantV1 = { schemaVersion: 1, grantId: 'source-grant', scope, materials: [stored.ref], reader: run('consumer'), issuedBy: { aggregateType: 'Control', projectId: scope.projectId, goalId: scope.goalId }, purpose: 'read current source reasoning', basis, grantedAt: AT };
    const command = (g: MaterialAccessGrantV1) => buildGrantMaterialAccessCommand(g, { commandId: g.grantId, projectId: scope.projectId, actorKind: 'system', actorId: 'host', idempotencyKey: g.grantId, correlationId: g.grantId, submittedAt: AT });
    const read = () => host.vault.open(stored.ref, { requesterRunRef: run('consumer'), currentBasis: basis, usage: 'current', includeOwner: true });
    expect(await host.grantMaterialAccess(command(grant))).toMatchObject({ status: 'committed' });
    expect(await read()).toMatchObject({ status: 'ready', record: { applicability: 'current', ownerRunRef: run('producer') } });
    const oldPut = await host.vault.put({ contentType: 'text/plain', body: 'Legacy material carrying only a producer-declared digest', sourceRefs: [stored.ref.source], ownerRef: run('producer'), requestedAt: AT });
    if (oldPut.status !== 'stored') throw Error('legacy put failed');
    const oldBasis = { planRef: null, workspaceRevision: 1, sourceDigest: basis.sourceDigest };
    const oldGrant = { ...grant, grantId: 'legacy-digest-only', materials: [oldPut.ref], basis: oldBasis };
    expect(await host.grantMaterialAccess(command(oldGrant))).toMatchObject({ status: 'committed' }); // legacy records remain readable by the protocol
    expect(await host.vault.open(oldPut.ref, { requesterRunRef: run('consumer'), currentBasis: oldBasis })).toMatchObject({ status: 'rejected', code: 'stale' });
    expect(await host.vault.open(oldPut.ref, { requesterRunRef: run('consumer'), currentBasis: oldBasis, usage: 'current' })).toMatchObject({ status: 'rejected', code: 'stale' });
    // No new workspace revision, event or projection has occurred.
    const before = await host.ledger.load({ aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId });
    await writeFile(join(root, 'main.py'), 'value = 2\n');
    expect(await host.ledger.load({ aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId })).toEqual(before);
    expect(await read()).toMatchObject({ status: 'rejected', code: 'stale' });
    expect(await host.vault.open(stored.ref, { requesterRunRef: run('consumer'), currentBasis: basis })).toMatchObject({ status: 'rejected', code: 'stale' });
    expect(await host.vault.open(stored.ref, { requesterRunRef: run('producer') })).toMatchObject({ status: 'ready', record: { body: 'Original source reasoning for value = 1' } });
    const history: MaterialAccessGrantV1 = { ...grant, grantId: 'history-grant', history: { usage: 'historical_explanation', owner: run('producer') } };
    expect(await host.grantMaterialAccess(command(history))).toMatchObject({ status: 'committed' });
    expect(await host.vault.open(stored.ref, { requesterRunRef: run('consumer'), currentBasis: basis })).toMatchObject({ status: 'ready', record: { applicability: 'historical_explanation' } });
    expect(await read()).toMatchObject({ status: 'rejected', code: 'stale' });
    if (persistent) {
      await persistent.close();
      const requestFile = join(dir, 'child-read.json');
      await writeFile(requestFile, JSON.stringify({ sourceRoot: root, stateDir: join(dir, 'state'), scope, ref: stored.ref, reader: run('consumer'), basis }));
      const child = await childNode(process.execPath, [fileURLToPath(new URL('./material-source-process.mjs', import.meta.url)), requestFile], { timeout: 45000, maxBuffer: 256 * 1024 });
      const reopened = JSON.parse(child.stdout);
      expect(reopened.pid).not.toBe(process.pid);
      expect(reopened.result).toMatchObject({ status: 'rejected', code: 'stale' });
      expect(reopened.historical).toMatchObject({ status: 'ready', record: { applicability: 'historical_explanation', ownerRunRef: run('producer') } });
      persistent = await persistent.reopen({ readModelFile: 'rebuilt.sqlite' }); host = persistent; await host.advanceProjection();
    }
    expect(await read()).toMatchObject({ status: 'rejected', code: 'stale' });
    expect(await host.vault.open(stored.ref, { requesterRunRef: run('consumer'), currentBasis: basis, usage: 'historical_explanation', includeOwner: true })).toMatchObject({ status: 'ready', record: { applicability: 'historical_explanation', ownerRunRef: run('producer') } });
    await writeFile(join(root, 'main.py'), 'value = 1\n');
    expect(await read()).toMatchObject({ status: 'ready' });
    available = false;
    expect(await read()).toMatchObject({ status: 'rejected', code: 'stale' });
    available = true;
    // Wrong-scope pins reject both public commands and direct adapter folds.
    const wrong = { ...grant, grantId: 'wrong-source-scope', basis: { ...basis, sourcePin: { ...capture.pin, workspaceId: 'other-workspace' } } };
    expect(await host.grantMaterialAccess(command(wrong))).toMatchObject({ status: 'rejected', code: 'scope_mismatch' });
    expect(await host.ledger.commit(buildMaterialAccessGrantLedgerCommit(command(wrong), { eventId: 'wrong-scope', occurredAt: AT }))).toMatchObject({ status: 'rejected', code: 'invalid_commit' });
    const revoke: RevokeMaterialAccessCommand = { commandId: 'revoke-source', commandType: 'RevokeMaterialAccess', schemaVersion: 1, identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'revoke-source' }, aggregateId: grant.grantId, expectedRevision: 1, correlationId: 'revoke-source', submittedAt: AT, payload: { grantRef: { aggregateType: 'MaterialAccessGrant', ...scope, grantId: grant.grantId }, reason: 'reader authority ended' } };
    const race = { ...grant, grantId: 'revoked-during-source-capture', materials: [oldPut.ref] };
    expect(await host.grantMaterialAccess(command(race))).toMatchObject({ status: 'committed' });
    expect(await host.materialAccessGrants({ projectId: scope.projectId, materialDigest: oldPut.ref.digest })).toMatchObject({ status: 'ready', grants: expect.arrayContaining([expect.objectContaining({ grant: race })]) });
    let resume!: () => void;
    let entered!: () => void;
    const reachedCapture = new Promise<void>(resolve => { entered = resolve; });
    duringCapture = { entered, resume: new Promise<void>(resolve => { resume = resolve; }) };
    const concurrentRead = host.vault.open(oldPut.ref, { requesterRunRef: run('consumer'), currentBasis: basis, usage: 'current' });
    await Promise.race([reachedCapture, concurrentRead.then(result => { throw Error('source capture was bypassed before the racing read returned: ' + JSON.stringify(result)); })]);
    const raceRevoke = { ...revoke, commandId: 'revoke-racing', aggregateId: race.grantId, identity: { ...revoke.identity, idempotencyKey: 'revoke-racing' }, payload: { ...revoke.payload, grantRef: { ...revoke.payload.grantRef, grantId: race.grantId } } };
    try { expect(await host.control.revokeMaterialAccess(raceRevoke)).toMatchObject({ status: 'committed' }); } finally { resume(); }
    expect(await concurrentRead).toMatchObject({ status: 'rejected', code: 'stale' });
    expect(await host.control.revokeMaterialAccess(revoke)).toMatchObject({ status: 'committed' });
    expect(await host.materialAccessGrants({ projectId: scope.projectId, materialDigest: stored.ref.digest })).toMatchObject({ status: 'ready', grants: expect.arrayContaining([expect.objectContaining({ revision: 1, ref: revoke.payload.grantRef })]) });
    expect(await read()).toMatchObject({ status: 'rejected', code: 'stale' }); // only the historical grant remains
    expect(await host.grantMaterialAccess(command(grant))).toMatchObject({ status: 'committed', replayed: true });
    expect(await read()).toMatchObject({ status: 'rejected', code: 'stale' });
    // A legacy resolver lacking trusted applicability cannot assert sourced-current.
    const legacyVault = new ArtifactVault(new Map(), { grants: { grantsFor: async () => [grant] } });
    expect(await legacyVault.put({ contentType: stored.ref.contentType, body: 'Original source reasoning for value = 1', sourceRefs: [stored.ref.source], ownerRef: run('producer'), requestedAt: AT })).toMatchObject({ status: 'stored' });
    expect(await legacyVault.open(stored.ref, { requesterRunRef: run('consumer'), currentBasis: basis, usage: 'current' })).toMatchObject({ status: 'rejected', code: 'stale' });
    expect(await legacyVault.open(stored.ref, { requesterRunRef: run('consumer'), currentBasis: basis })).toMatchObject({ status: 'rejected', code: 'stale' });
  } finally { if (persistent) await persistent.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
