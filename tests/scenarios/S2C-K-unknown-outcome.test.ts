/**
 * Slice 2C row 2C-22 (LE4, decision 45): after a Host restart an in-flight Run
 * whose Kernel store is gone is reconciled `outcome_unknown`; the retired line
 * reads `retired` (conclusion `missing`) with attention `unknown` and is not
 * archived by maintenance. The attestation cases pin the lead's 2026-10-15
 * ruling: an attested crash is written `kernel_turn_open` (K SES-07/SES-10,
 * decision 51); when the store stays missing/damaged, maintenance pass 1's KA1
 * closure is `unreadable`, the Runtime records the probe as the Turn closure
 * (SES-19a, lead 2026-10-15), so pass 2 reads the
 * unreadable conclusion and today's retirement rule archives the line as retired
 * (2C-22(2), spec §3.6 A1).
 *
 * Entry LE4: `openHostScenario`, a real crash/restart, `lines/list`,
 * `lines/archived`, `executions/resolve-unknown`, the Host Workflow maintenance
 * through `h.advance` (only the Host's Runtime closes a dangling Turn) and the
 * Runtime-less `runMaintenance` for the archive decision. The Kernel store is
 * moved aside at the storage boundary (the L-fixtures `missing` manipulation);
 * no record is written directly and no database is read for verification.
 */
import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import { AG2B_SCOPE, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { moveKernelAside, readExecution } from '../helpers/A2-restart-fixture.js';
import {
  archivedLineContaining, lineArchived, lineList, ready, requireControl, requireLine, runMaintenance, sessionCard,
} from '../helpers/S2C-K-scenario-support.js';
import type { WriteResult } from '../../src/contracts/core/results.js';

afterEach(cleanupScenarios);

/**
 * Corrupt the mapped Kernel rows (valid SQLite, unreadable records) so the
 * start-up probe reads `damaged` rather than `transient`/`missing`: a
 * non-database file is `transient`, an absent one is `missing`.
 */
async function damageKernel(database: string): Promise<void> {
  const kernel = new DatabaseSync(join(database, 'kernel.sqlite'));
  try {
    kernel.exec("UPDATE session_records SET record_json = '{'");
  } finally {
    kernel.close();
  }
}

/** One crash mid-Turn after the Kernel store was moved aside: the Run ends `outcome_unknown`. */
async function crashedMissingKernel(h: HostScenario, flowId: string): Promise<{ runRef: NonNullable<Awaited<ReturnType<HostScenario['taskRow']>>['execution']>; head: string }> {
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select(flowId, 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;
  await moveKernelAside(h.database);
  await h.restart({ crash: true });
  const unknown = await readExecution(h.host, runRef);
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  expect(unknown.session).toMatchObject({ health: 'unavailable', healthConclusion: 'missing' });
  return { runRef, head };
}

/** One crash mid-Turn after the Kernel rows were corrupted: the Run ends `outcome_unknown`. */
async function crashedDamagedKernel(h: HostScenario, flowId: string): Promise<{ runRef: NonNullable<Awaited<ReturnType<HostScenario['taskRow']>>['execution']>; head: string }> {
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select(flowId, 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;
  await damageKernel(h.database);
  await h.restart({ crash: true });
  const unknown = await readExecution(h.host, runRef);
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  expect(unknown.session).toMatchObject({ health: 'unavailable', healthConclusion: 'damaged' });
  return { runRef, head };
}

it('2C-22 (1) a Run left outcome_unknown by a missing Kernel reads retired (missing) with attention unknown, and maintenance leaves the unknown holder alone', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c22-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c22: the missing-Kernel Turn is never answered' },
  ] } });
  const { head } = await crashedMissingKernel(h, 's2c22-run1');

  const list = ready(await lineList(h), 'lines/list after the unknown reconcile');
  const row = requireLine(list, head, 'the retired unknown line');
  expect(row.status.own).toBe('retired');
  expect(row.status.ownReason.code).toBe('retired_missing');
  expect(row.retired).toMatchObject({ conclusion: 'missing' });
  expect(row.status.attention?.code).toBe('unknown');
  expect(row.status.attentionCounts.unknown).toBeGreaterThanOrEqual(1);

  // decision 45: the unknown holder is not archived by maintenance.
  await runMaintenance(h, 's2c22-unknown');
  const archived = ready(await lineArchived(h), 'lines/archived before the attestation');
  expect(archived.rows.map(item => item.key.sessionId)).not.toContain(head);
  expect(requireLine(ready(await lineList(h), 'lines/list after the unknown maintenance'), head).status.own).toBe('retired');
}, 240_000);

it('2C-22 (2) after the person attests a missing-Kernel unknown Run, the attestation writes kernel_turn_open, maintenance pass 1 records the unreadable probe, and pass 2 archives the line as retired (lead 2026-10-15)', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c22b-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c22b: the missing-Kernel Turn is never answered' },
  ] } });
  const { runRef, head } = await crashedMissingKernel(h, 's2c22b-run1');
  const unknown = await readExecution(h.host, runRef);

  const attested = await h.post<WriteResult<unknown>>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef, reason: '2C-22: checked by hand, nothing more was written' }, 's2c22-attest',
    [{ ref: runRef, revision: unknown.run.revision }]));
  expect(attested).toMatchObject({ status: 'committed' });

  // Lead ruling 2026-10-15: the attestation writes the readable-Kernel
  // `kernel_turn_open` conclusion (K SES-07/SES-10, decision 51) so that, when
  // the Kernel store is readable again, KA1 closes the Turn (KA-14).
  const afterAttest = await readExecution(h.host, runRef);
  expect(afterAttest.session).toMatchObject({ health: 'unavailable', healthConclusion: 'kernel_turn_open' });

  // Maintenance pass 1 must run on the Host: only its Runtime can close the
  // dangling Turn and reach the health owner, while `runMaintenance` uses the
  // Runtime-less composition root. Driving the Host's Workflow runs the same
  // bounded maintenance page (§4.2; `invariants: false` because a re-drive may
  // follow). KA1's closure stays `unreadable` (the store is still missing); the
  // Runtime probes the Session and records the `missing` verdict as the Turn
  // closure (SES-19a, lead 2026-10-15).
  await h.advance(h.select('s2c22-attested-1', 'ag2b-work'), { maxSteps: 16, invariants: false }).catch(() => undefined);
  const afterPass1 = await readExecution(h.host, runRef);
  expect(afterPass1.session).toMatchObject({ health: 'unavailable', healthConclusion: 'missing' });

  // Pass 2 reads the unreadable conclusion: no `kernel_turn_open` exemption
  // remains, so today's retirement rule archives the line as retired.
  await runMaintenance(h, 's2c22-attested-2');
  const page = ready(await lineArchived(h), 'lines/archived after the attestation');
  const archived = archivedLineContaining(page, head);
  expect(archived, 'the retired line is archived').toBeDefined();
  expect(archived?.status.bucket).toBe('archived');
  expect(archived?.status.archivedTag).toBe('retired');
  expect(archived?.status.own).toBe('retired');
  expect(archived?.retired).toMatchObject({ conclusion: 'missing' });
  const reactivate = requireControl(archived!, 'reactivate', 'the archived retired reactivate control');
  expect(reactivate).toMatchObject({ availability: 'unavailable', reasonCode: 'reactivate_refused_retired' });
  // The retired line never returns to available or re-enables.
  const card = await sessionCard(h, { projectId: runRef.projectId, sessionId: head });
  expect(card).toMatchObject({ lifecycle: 'archived', health: 'unavailable', healthConclusion: 'missing' });
}, 240_000);

it('2C-22 (3) a damaged Kernel at the restart leaves the Run outcome_unknown; the line reads retired (damaged) with attention unknown and maintenance leaves the unknown holder alone', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c22c-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c22c: the damaged-Kernel Turn is never answered' },
  ] } });
  const { head } = await crashedDamagedKernel(h, 's2c22c-run1');

  const row = requireLine(ready(await lineList(h), 'lines/list after the damaged reconcile'), head,
    'the retired damaged unknown line');
  expect(row.status.own).toBe('retired');
  expect(row.status.ownReason.code).toBe('retired_damaged');
  expect(row.retired).toMatchObject({ conclusion: 'damaged' });
  expect(row.status.attention?.code).toBe('unknown');
  expect(row.status.attentionCounts.unknown).toBeGreaterThanOrEqual(1);

  // Decision 45: the unknown holder is not archived by maintenance.
  await runMaintenance(h, 's2c22c-damaged');
  const archived = ready(await lineArchived(h), 'lines/archived after the damaged maintenance');
  expect(archived.rows.map(item => item.key.sessionId)).not.toContain(head);
  expect(requireLine(ready(await lineList(h), 'lines/list after the damaged maintenance'), head).status.own).toBe('retired');
}, 240_000);

it('2C-22 (4) after the person attests a damaged-Kernel unknown Run, the attestation writes kernel_turn_open, pass 1 records the damaged probe, and pass 2 archives the line as retired (lead 2026-10-15)', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c22d-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c22d: the damaged-Kernel Turn is never answered' },
  ] } });
  const { runRef, head } = await crashedDamagedKernel(h, 's2c22d-run1');
  const unknown = await readExecution(h.host, runRef);

  const attested = await h.post<WriteResult<unknown>>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef, reason: '2C-22: checked by hand, the damaged Kernel wrote nothing' }, 's2c22d-attest',
    [{ ref: runRef, revision: unknown.run.revision }]));
  expect(attested).toMatchObject({ status: 'committed' });

  const afterAttest = await readExecution(h.host, runRef);
  expect(afterAttest.session).toMatchObject({ health: 'unavailable', healthConclusion: 'kernel_turn_open' });

  // Pass 1 on the Host (only its Runtime can close the dangling Turn, SES-19a).
  await h.advance(h.select('s2c22d-attested-1', 'ag2b-work'), { maxSteps: 16, invariants: false }).catch(() => undefined);
  const afterPass1 = await readExecution(h.host, runRef);
  expect(afterPass1.session).toMatchObject({ health: 'unavailable', healthConclusion: 'damaged' });

  await runMaintenance(h, 's2c22d-attested-2');
  const page = ready(await lineArchived(h), 'lines/archived after the damaged attestation');
  const archived = archivedLineContaining(page, head);
  expect(archived, 'the damaged retired line is archived').toBeDefined();
  expect(archived?.status.bucket).toBe('archived');
  expect(archived?.status.archivedTag).toBe('retired');
  expect(archived?.status.own).toBe('retired');
  expect(archived?.retired).toMatchObject({ conclusion: 'damaged' });
  const reactivate = requireControl(archived!, 'reactivate', 'the archived damaged reactivate control');
  expect(reactivate).toMatchObject({ availability: 'unavailable', reasonCode: 'reactivate_refused_retired' });
  const card = await sessionCard(h, { projectId: runRef.projectId, sessionId: head });
  expect(card).toMatchObject({ lifecycle: 'archived', health: 'unavailable', healthConclusion: 'damaged' });
}, 240_000);
