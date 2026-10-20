/**
 * A.2 step 5.2 through the real Host (docs/refactor/STATE-MACHINES-SPEC.md
 * §7.7, D-15, lead decision LA-1): the workspace-level Runtime capability
 * report read over HTTP from `runtime/capabilities` on a SQLite ledger with a
 * registered Kernel store.
 *
 * `continueHistory`, `safePointPause` and `cancel` are supported, and each
 * reason states the boundary of that support as it holds today (D-15): a
 * continuation is a new Run, never a resume of the original Turn, and a Session
 * whose last Kernel Turn has no terminal takes no new Turn; a pause or cancel of
 * a Run that never entered is the platform's own (step 5.1 proves that
 * behaviour in tests/scenarios/A7-control.test.ts, D-7 and D-8); a cancel of a Run
 * paused at a safe point is applied on the live handle's exit proof (5.6); a Query has no control.
 * Step 5.7 reports `recoverRun` as supported: the start-up reconciliation only, never a fresh
 * resume of the original Turn (D-17); a Run paused when its Host stopped ends paused-interrupted and
 * only a person continues it (C4); the start-up re-drive follows the Host setting
 * `automation.resumeOnStartup`, the reason states what turning it off does, and a Host with it
 * off also says so, with or without the instance lease (LA-6, L-10). The §7.7 target boundaries
 * were added by the substeps that built them: 5.4 the requeue continuation brief (C3); 5.6 the new
 * Session after an open Kernel Turn, the restart rebuild, paused-interrupted, the paused stop and the
 * restart stop; 5.8 the automatic requeue of a clean interruption (RUN-19) and the start-up re-drive
 * of a Goal whose required active Task has the automation verdict requeue or claim_requeued; 5.9 the
 * re-drive of a Goal whose required active Task has the verdict reverify (the last clause that was
 * listed as not built yet). Slice K (L1, L7, L8; lead decisions D9, D10) reports Kernel session API
 * version 3, and the recoverRun reason puts the continuation of an interrupted Work line in the same
 * Session once the platform has closed its dangling Kernel Turn, in a new Session only when that
 * closure is not possible. Every item has its own reason
 * (no shared placeholder), and the report is the same after the Host reopens
 * the ledger with the same settings.
 *
 * No model is called and no Run is started: the report is a declaration.
 */
import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PLATFORM_TOKEN_HEADER, PLATFORM_TOKEN_PLACEHOLDER, type CoreScope } from '../../src/app/core-http-types.js';
import { SETTINGS_API_PREFIX } from '../../src/app/host-settings-types.js';
import { UI_PLATFORM_TOKEN_META_NAME } from '../../src/ui/api/protocol.js';
import { createRuntimeCapabilitiesFixture } from '../helpers/runtime-capabilities-fixture.js';

const at = '2026-10-05T00:00:00.000Z';
const scope: CoreScope = { projectId: 'a2-capabilities-project', workspaceId: 'a2-capabilities-workspace' };
const adapterId = 'a2-capabilities-kernel';

const fixture = createRuntimeCapabilitiesFixture({
  scope, adapterId, actorId: 'a2-capabilities-operator', workspaceName: 'A2 capabilities workspace',
  storeKey: 'a2-capabilities-store', now: () => at,
});
const { directory, startHost, readCapabilities } = fixture;
afterEach(async () => { await fixture.cleanup(); });

async function postSettings(origin: string, token: string, suffix: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(SETTINGS_API_PREFIX + suffix, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return await response.json() as Record<string, unknown>;
}

function expectAllIn(reason: string, phrases: readonly string[]): void {
  for (const phrase of phrases) expect(reason, phrase).toContain(phrase);
}

/** §7.7 recoverRun (5.7): the boundaries every report states, whatever the Host setting. */
const RECOVER_RUN_BOUNDARIES = [
  // D-5/D-6/D-17: reconciliation only, under the instance lease, before any driver.
  'start-up reconciliation only, never a fresh resume of the original Turn',
  'starts holding the instance lease', 'before any execution driver starts',
  'A Kernel terminal is recorded as the Run ended',
  // W-01..W-05, RUN-16, RUN-03: the same claim drives a not-entered Run again.
  'never entered the Kernel keeps its claim', 'the same claim drives it again',
  // RUN-19 (class interrupted), RUN-23 (LA-7).
  'a clean interruption (no tool call in flight) ends crashed with the failure class interrupted',
  // 5.8 (RUN-19 "可自动重新入队", ND-7): the automation requeues it, uncounted; a person still may.
  'which the automation requeues automatically, without counting it toward the automatic rework limit',
  'and which a person can requeue too',
  'a queued cancel with a clean Kernel Turn ends the Run cancelled',
  // RUN-24, C4, GOAL-29: paused-interrupted, not a failure, continued only by a person.
  'ends paused-interrupted, which is not a failure and releases its Session and Lease',
  'only a person continues it', 'resuming the Goal continues it',
  // RUN-20, RUN-22, L-1, W-07.
  'recorded as unknown, keeping its Session and Lease until a person attests it',
  'an attestation also needs the instance lease', 'a probe that proves nothing leaves the Run as recorded',
  // LA-1, C3: the continuation; slice K (L7, L8, lead decision D9): in the same Session once the platform has
  // closed the dangling Kernel Turn of a Work line, in a new Session only when that closure is not possible.
  'new Run with a continuation brief: for a Work line, after the platform closes its dangling Kernel Turn as interrupted, in the same Session',
  'when that closure is not possible, in a new Session that continues the original Session',
  // LA-6: the start-up re-drive, its switch, owner guards, no scheduler.
  'starts the existing collaboration driver for each active Goal',
  // 5.8, 5.9: re-drive condition (a) for the verdicts the Workflow acts on (reverify since 5.9).
  'a required active Task whose automation verdict is requeue, reverify or claim_requeued',
  'or a Run that never entered and is not paused or cancelled',
  'follows the Host setting automation.resumeOnStartup (on by default)',
  'judged by the Workflow and the owners', 'a paused-interrupted Run is still continued only by a person',
  'there is no periodic scheduler',
  // LA-6: what turning the setting off does (§7.7 "关闭时重启后不启动驱动…").
  'When that setting is off, the reconciliation still runs but no driver starts after it',
  'the automation continues only at workflow/advance, workflow/driver-start or an operator\'s action',
  // L-10.
  'does not hold the instance lease neither reconciles nor starts an execution driver',
  'plain reads and owner writes are served as usual',
];
/** LA-6 (5.7): the sentence the reason adds when this Host's `automation.resumeOnStartup` is off. */
const RESUME_ON_STARTUP_OFF = 'This Host has automation.resumeOnStartup turned off';
it('reports continuation, safe-point pause, cancel and start-up reconciliation as supported with their boundaries over the Host route', async () => {
  const paths = {
    publicDir: await directory('a2-capabilities-public-'),
    root: await directory('a2-capabilities-ws-'),
    database: await directory('a2-capabilities-db-'),
  };
  await writeFile(join(paths.publicDir, 'index.html'),
    `<!doctype html><meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  const first = await startHost(paths);
  const report = await readCapabilities(first.origin, first.token);

  expect(report).toMatchObject({
    adapterId,
    createSession: { supported: true }, readHistory: { supported: true },
    continueHistory: { supported: true }, safePointPause: { supported: true }, cancel: { supported: true },
    // Step 5.7 reports start-up reconciliation; nothing else changes in A.2.
    recoverRun: { supported: true },
    nativeCompact: { supported: false }, scopedWorkspaceWrites: { supported: false },
  });
  // Slice K L1 (lead decision D10): the Kernel with the interrupted terminal and the Turn closure.
  expect(report.kernelSessionApiVersion).toBe(3);

  // LA-1: a continuation is a new Run, never the original Turn; with a Kernel
  // terminal it continues in the same Session (including the yielded successor),
  // and the frozen Kernel takes no new Turn in a Session whose last Turn is open.
  expectAllIn(report.continueHistory.reason, [
    'a continuation is a new Run, never a resume of the original Turn',
    // 5.4 (C3): a requeue Run starts with its continuation brief.
    'A Run created by a requeue starts with a continuation brief',
    'labelled a continuation, not a resumed execution',
    'has a Kernel terminal, a new Run in the same Session continues its history',
    'the successor Run after a yielded wait',
    'has no Kernel terminal',
    // 5.6 (LA-1, RD-3, RUN-20(iii)): the new Session after an open Kernel Turn and the restart rebuild; since
    // slice K (L11, lead decision D9) the new Session is the continuation of a Query line and the fallback when
    // the platform cannot close the dangling Turn (KA-17 asserts the closure sentences).
    'the Kernel refuses a new Turn in that Session',
    'a Run interrupted by a Host restart, including one paused then',
    'a Run stopped at restart by a queued cancel',
    'one a person attested while its Kernel Turn was still open',
    'kernel_turn_open', 'a new Run in a new Session', 'last completed history',
    'exactly one waiting message', 'continuation_unrebuildable',
  ]);
  // §7.7 safePointPause as it holds today: live handle at a safe point, D-7 for
  // a Run that never entered, no restart reconciliation yet, D-11.
  expectAllIn(report.safePointPause.reason, [
    'pauses through its live handle at the next safe point (before a model call or between tool groups)',
    'a resume re-enters the original Turn',
    'has not entered the Kernel is paused and resumed by the platform at once',
    // 5.6: the RUN-14 live-handle guard, the paused-interrupted end (C4) and GOAL-29.
    'only while this Host process still holds the live handle',
    'ends paused-interrupted after the restart, which is not a failure',
    'only a person continues it', 'resuming the Goal continues it',
    'A Query cannot be paused',
  ]);
  // §7.7 cancel as it holds today: live handle with the pending stop request,
  // D-7, the undeliverable cancel of a paused Run (§7.3 case 3), the
  // yielded-wait fence, and no Query control (§7.3 case 1, GAP-06).
  expectAllIn(report.cancel.reason, [
    'cancelled through its live handle',
    'pending stop request until the Run\'s stop is proved',
    'has not entered the Kernel is cancelled by the platform at once',
    // 5.6: RD-7 (the exit proof), RUN-23 at restart (LA-7) and C7.
    'already paused at a safe point is applied by the platform on the exit proof',
    'whether or not the Kernel paused it',
    'cannot be cancelled', 'Task disposition',
    'only fences its continuation',
    'A Query cannot be cancelled',
    'refused as invalid',
    'there is no QueryJob close',
  ]);
  // 5.7 (§7.7, D-15, C4, LA-6): recoverRun is the start-up reconciliation only, with the default
  // setting (the start-up re-drive on), so the "turned off" sentence is absent.
  expectAllIn(report.recoverRun.reason, RECOVER_RUN_BOUNDARIES);
  expect(report.recoverRun.reason).not.toContain(RESUME_ON_STARTUP_OFF);
  // 5.6 moved every remaining §7.7 target phrase into the lists above (5.4 moved 'continuation brief').
  expect(report.safePointPause.reason).not.toContain('continuation brief');
  expect(report.cancel.reason).not.toContain('continuation brief');
  // Every item states its own reason; nothing shares one placeholder.
  const items = [report.createSession, report.readHistory, report.continueHistory, report.recoverRun,
    report.safePointPause, report.cancel, report.nativeCompact, report.scopedWorkspaceWrites];
  expect(items.every(item => item.reason.length > 0)).toBe(true);
  expect(new Set(items.map(item => item.reason)).size).toBe(items.length);

  // The report is a declaration over configuration, not state: the reopened
  // Host on the same ledger reports exactly the same.
  await first.host.close();
  const reopened = await startHost(paths);
  expect(await readCapabilities(reopened.origin, reopened.token)).toEqual(report);
});

it('says in the recoverRun reason that this Host has the setting automation.resumeOnStartup off, with or without the instance lease (LA-6, L-10)', async () => {
  const paths = {
    publicDir: await directory('a2-capabilities-public-'),
    root: await directory('a2-capabilities-ws-'),
    database: await directory('a2-capabilities-db-'),
  };
  await writeFile(join(paths.publicDir, 'index.html'),
    `<!doctype html><meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  // The Host installs `automation` from its private settings at start (C8 wiring, 5.6).
  // Reach the stored setting the way a person does: save it through the published
  // Host settings route, close that Host, then start the Host under test.
  const configureOff = await startHost(paths);
  expect((await postSettings(configureOff.origin, configureOff.token, 'automation/save',
    { autoReworkLimit: 3, resumeOnStartup: false })).status).toBe('ready');
  await configureOff.host.close();
  const off = await startHost(paths);
  // The start-up reconciliation ran on this Host (it holds the instance lease); the setting only
  // decides whether a driver starts after it.
  expect(off.host.reconcile).toMatchObject({ lease: 'owned', report: { redriveGoals: [], problems: [] } });
  const offReport = await readCapabilities(off.origin, off.token);
  expect(offReport.recoverRun.supported).toBe(true);
  expectAllIn(offReport.recoverRun.reason, [...RECOVER_RUN_BOUNDARIES, RESUME_ON_STARTUP_OFF]);
  // A second Host on the same store while the first holds the instance lease (HL-02, L-10) neither
  // reconciles nor drives; its report says the same about its own setting and points to no entry
  // that this Host refuses as busy.
  const held = await startHost(paths);
  expect(held.host.reconcile).toMatchObject({ lease: 'held_by_other', report: null });
  expect(await readCapabilities(held.origin, held.token)).toEqual(offReport);
  await held.host.close();
  await off.host.close();

  // The same ledger with the setting back on: the sentence is gone and nothing else differs.
  const configureOn = await startHost(paths);
  expect((await postSettings(configureOn.origin, configureOn.token, 'automation/save',
    { autoReworkLimit: 3, resumeOnStartup: true })).status).toBe('ready');
  await configureOn.host.close();
  const on = await startHost(paths);
  const onReport = await readCapabilities(on.origin, on.token);
  expectAllIn(onReport.recoverRun.reason, RECOVER_RUN_BOUNDARIES);
  expect(onReport.recoverRun.reason).not.toContain(RESUME_ON_STARTUP_OFF);
  expect(offReport.recoverRun.reason).toBe(`${onReport.recoverRun.reason}. ${RESUME_ON_STARTUP_OFF}`);
  expect({ ...offReport, recoverRun: onReport.recoverRun }).toEqual(onReport);
});
