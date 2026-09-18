import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { communicationIntentRefFor, waitConditionRefFor } from '../../src/contracts/coordination.js';
import { cancellationWorld, AT, PROJECT, WORKSPACE, agentActor, principalFor, admissionIntentOf } from './cancellation-process-fixture.js';

const execute = promisify(execFile);
const driver = fileURLToPath(new URL('./coordination-process.mjs', import.meta.url));

it.each([false, true])('SIGKILL after wait cancel commit restores derived intent (sideEffectStarted=%s) without a successor', async sideEffectStarted => {
  const dir = await mkdtemp(join(tmpdir(), 'communication-cancel-kill-'));
  await mkdir(join(dir, 'state'));
  const { s, waitId } = await cancellationWorld(join(dir, 'state'), String(sideEffectStarted));
  try {
    const originalIntent = await admissionIntentOf(s, waitId);
    const cancelIntentRef = communicationIntentRefFor(PROJECT, WORKSPACE, originalIntent.intent.intentId);
    if (sideEffectStarted) {
      const id = 'mark-unknown-boundary';
      const claim = await s.h.control.claimCommunicationIntent({ commandId: id, commandType: 'CommunicationClaimIntent', schemaVersion: 1,
        aggregateId: cancelIntentRef.intentId, expectedRevision: originalIntent.revision, correlationId: id, submittedAt: AT,
        identity: { projectId: PROJECT, actor: { kind: 'system', id: 'coordination-drive' }, idempotencyKey: id },
        payload: { workspaceId: WORKSPACE, consumerId: 'coordination-drive', leaseDurationMs: 60000, now: AT } });
      expect(claim.status, JSON.stringify(claim)).toBe('claimed');
      if (claim.status !== 'claimed') throw Error('intent not claimed');
      expect(await s.h.control.settleCommunicationIntent({ commandId: id + '-effect', commandType: 'CommunicationSettleIntent', schemaVersion: 1,
        aggregateId: cancelIntentRef.intentId, expectedRevision: claim.revision, correlationId: id, submittedAt: AT,
        identity: { projectId: PROJECT, actor: { kind: 'system', id: 'coordination-drive' }, idempotencyKey: id + '-effect' },
        payload: { workspaceId: WORKSPACE, consumerId: 'coordination-drive', leaseGeneration: claim.leaseGeneration,
          outcome: 'side_effect_started', reason: 'Formal unknown-state witness; no external action is claimed', settledAt: AT } })).toMatchObject({ status: 'committed' });
    }
    const waitRef = waitConditionRefFor(PROJECT, WORKSPACE, waitId);
    const wait = await s.h.ledger.load(waitRef);
    if (wait.status !== 'found') throw Error('wait missing');
    const marker = join(dir, 'killed-boundary.json');
    const common = { stateDir: join(dir, 'state'), projectId: PROJECT, workspaceId: WORKSPACE, at: AT, waitRef, cancelIntentRef, marker };
    const command = { commandId: 'cancel-at-commit', commandType: 'CancelCommunication', schemaVersion: 1, aggregateId: waitId,
      expectedRevision: wait.snapshot.revision, correlationId: 'cancel-at-commit', submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: 'cancel-at-commit', agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
      payload: { workspaceId: WORKSPACE, target: 'wait', reason: 'No longer needed' } };
    await s.h.close();
    const child = async (name: string, options: Record<string, unknown>) => {
      const path = join(dir, name + '.json'); await writeFile(path, JSON.stringify({ ...common, ...options }));
      try {
        const result = await execute(process.execPath, [driver, path], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
        return { signal: null, value: JSON.parse(result.stdout) };
      } catch (error) {
        const e = error as { signal?: string; stderr?: string; stdout?: string };
        if (options['cancelCommand'] && e.signal === 'SIGKILL') return { signal: e.signal, value: null };
        throw Error(String(e.stderr) + String(e.stdout));
      }
    };
    expect((await child('kill', { cancelCommand: command })).signal).toBe('SIGKILL');
    const killed = JSON.parse(await readFile(marker, 'utf8'));
    expect(killed.receipt.status).toBe('committed');
    expect(killed.wait.snapshot.wait.status).toBe('cancelled');
    expect(killed.intent.snapshot.intent).toMatchObject({ status: 'leased', sideEffectStarted });
    expect(killed.facts.CommunicationAdmissionRecorded ?? 0).toBe(0);
    const recovered = (await child('recover', { cancelReadback: true })).value;
    expect(recovered.pid).not.toBe(killed.pid);
    expect(recovered.results.flatMap((r: { coordination: { failures: unknown[] } }) => r.coordination.failures)).toEqual([]);
    expect(recovered.wait).toEqual(killed.wait);
    expect(recovered.observations[0].intent.snapshot.intent).toMatchObject({ status: sideEffectStarted ? 'outcome_unknown' : 'cancelled', sideEffectStarted,
      leaseGeneration: killed.intent.snapshot.intent.leaseGeneration });
    expect(recovered.intent.snapshot.intent).toMatchObject({ status: sideEffectStarted ? 'quarantined' : 'cancelled', sideEffectStarted,
      leaseGeneration: killed.intent.snapshot.intent.leaseGeneration });
    if (sideEffectStarted) {
      expect(recovered.observations[1].intent.snapshot.intent.status).toBe('quarantined');
      expect(recovered.observations[1].intent.snapshot.revision).toBe(recovered.observations[0].intent.snapshot.revision + 1);
      expect(recovered.observations[1].facts.CommunicationIntentSettled).toBe(recovered.observations[0].facts.CommunicationIntentSettled + 1);
      expect(recovered.intent.snapshot.intent.lastFailureClass).toBe('No verifiable external receipt; quarantined without replay');
    }
    expect(recovered.facts.CommunicationAdmissionRecorded ?? 0).toBe(0);
    expect(recovered.facts.TaskClaimed).toBe(killed.facts.TaskClaimed);
    expect(recovered.results.reduce((n: number, r: { started: number }) => n + r.started, 0)).toBe(0);
    const replay = (await child('third-pid', { cancelReadback: true })).value;
    expect(new Set([killed.pid, recovered.pid, replay.pid]).size).toBe(3);
    expect(replay.wait).toEqual(recovered.wait);
    expect(replay.intent).toEqual(recovered.intent);
    expect(replay.facts).toEqual(recovered.facts);
    expect(replay.results.reduce((n: number, r: { started: number }) => n + r.started, 0)).toBe(0);
  } finally { await s.h.close(); await rm(dir, { recursive: true, force: true }); }
}, 180000);
