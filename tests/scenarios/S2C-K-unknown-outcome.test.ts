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
import { cleanupScenarios, openHostScenario } from './harness.js';
import { moveKernelAside } from '../helpers/A2-restart-fixture.js';
import {
  crashedUnknownKernel, lineArchived, lineList, ready, requireLine, runMaintenance,
} from '../helpers/S2C-K-scenario-support.js';

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

it('2C-22 (1) a Run left outcome_unknown by a missing Kernel reads retired (missing) with attention unknown, and maintenance leaves the unknown holder alone', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c22-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c22: the missing-Kernel Turn is never answered' },
  ] } });
  const { head } = await crashedUnknownKernel(h, 's2c22-run1', 'missing', () => moveKernelAside(h.database));

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

it('2C-22 (3) a damaged Kernel at the restart leaves the Run outcome_unknown; the line reads retired (damaged) with attention unknown and maintenance leaves the unknown holder alone', async () => {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c22c-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c22c: the damaged-Kernel Turn is never answered' },
  ] } });
  const { head } = await crashedUnknownKernel(h, 's2c22c-run1', 'damaged', () => damageKernel(h.database));

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
