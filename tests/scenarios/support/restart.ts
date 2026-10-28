/**
 * Help code of the restart scenario group (A.2 step 6: tests/scenarios/A8-host-restart*.test.ts and
 * tests/scenarios/A10-check-recovery.test.ts), on top of the shared harness (../harness.ts), the help
 * code other groups use too (./common.ts) and the restart fixture (tests/helpers/A2-restart-fixture.ts).
 *
 * - Readers of the reconcile report and of the scenario files (ledger events, artifacts, a Kernel Turn).
 * - The C-01 crash point of a chosen check (§12.10 step 1, "故障注入"): a check whose process sleeps while a
 *   marker file under `.cache` is in the workspace. The other crash points (the ledger's write lock, the
 *   Kernel store moved aside) are in ./common.ts.
 * - §12.10 step 4's "同一身份的请求得到原回执": `performedOf`, the Workflow request a drive performed for a receipt.
 * - The moved cases' Workflow drives checked step by step: `crashMidTurn` (through common.ts `driveChecked`).
 * - The A8-3l step 6 negative control: a Turn forced on the frozen Kernel's own store.
 * - §12.10 step 4 "再次重启（同一数据、新实例）后不产生新的写入": `expectQuietHarnessRestart` (a
 *   `HostScenario`) and `expectQuietRestart` (a moved case's own files), over the harness's `fileCounts`
 *   and `reportChanges`.
 *
 * Scripted model replies only; no real model is called.
 */
import { expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HostReconcileReportV1 } from '../../../src/app/core-http-types.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../../src/business/workflow/contracts.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import {
  appConfigSchema, ProviderRegistry, runCodingAgent, type ModelClientPort, type ModelEvent, type ModelRequest,
} from '../../../vendor/coding-agent/dist/public-api.js';
import {
  AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, plain, seedAG2bWorkGraph, startAG2bHost, type AG2bHost, type AG2bOverrides,
} from '../../helpers/AG2b-collaboration-fixture.js';
import {
  deferred, post, selectWork, workRow, writeAutomationSettings, writeStaleLock,
} from '../../helpers/A2-restart-fixture.js';
import { eventTypesIn, fileCounts, readSqlite, type Driven, type HostScenario, type InvariantTarget } from '../harness.js';
import { driveChecked, kernelRecordRows, READ_THEN_TEXT } from './common.js';

/** Run 1 answers without writing the result file, so its round FAILs (the automation then requeues it). */
export const RUN1_WITHOUT_FILE = { kind: 'text' as const, text: 'restart scenario: Run 1 answers without the result file' };

/** The `ref` of a Session line in the reconcile report. */
export function sessionLineRef(sessionRef: { projectId: string; sessionId: string }): string {
  return JSON.stringify({ projectId: sessionRef.projectId, sessionId: sessionRef.sessionId });
}

/**
 * The ledger's event count, of one `eventType` or all (its own read-only connection): "no fact changed"
 * and "the check is begun" on a moved case's own Hosts.
 */
export function ledgerEvents(database: string, eventType?: string): number {
  const types = eventTypesIn(database);
  return eventType === undefined ? types.length : types.filter(type => type === eventType).length;
}

/** How many stored artifact bodies mention `text` (artifacts.sqlite, its own read-only connection). */
export function artifactsMentioning(database: string, text: string): number {
  return readSqlite(join(database, 'artifacts.sqlite'), artifacts =>
    Number((artifacts.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE instr(record, ?) > 0').get(text) as { n: number }).n), 0);
}

/**
 * The Workflow request a drive performed to get its first receipt of `kind`, with that receipt: the drive's first
 * input, or the `next` of the step before the receipt (§12.10 step 4: the request a scenario sends again).
 */
export function performedOf(first: WorkflowAdvanceInput, driven: Driven, kind: WorkflowStepReceipt['kind']):
{ input: WorkflowAdvanceInput; receipt: WorkflowStepReceipt } {
  const inputs = [first, ...driven.steps.map(step => step.next)];
  for (const [index, step] of driven.steps.entries()) {
    const input = inputs[index];
    if (step.receipt?.kind === kind && input !== null && input !== undefined) return { input, receipt: step.receipt };
  }
  throw new Error(`the drive performed no ${kind}`);
}

/**
 * The Kernel's `turn.started` record of one Kernel Run (its position and the instant the Kernel recorded), and every
 * `agent.event` type of that Turn in position order (its own read-only connection on kernel.sqlite).
 */
export function kernelTurnOf(database: string, kernelRunId: string): { position: number; recordedAt: string; eventTypes: string[] } | null {
  const rows = kernelRecordRows(database);
  const start = rows.find(row => row.recordType === 'turn.started'
    && (JSON.parse(row.json) as { payload: { run: { runId: string } } }).payload.run.runId === kernelRunId);
  if (start === undefined) return null;
  const eventTypes = rows.flatMap((row) => {
    if (row.recordType !== 'agent.event') return [];
    const event = (JSON.parse(row.json) as { payload: { event?: { type: string; meta?: { runId?: string } } } }).payload.event;
    return event?.meta?.runId === kernelRunId ? [event.type] : [];
  });
  return { position: start.position, recordedAt: (JSON.parse(start.json) as { recordedAt: string }).recordedAt, eventTypes };
}

/**
 * The marker whose presence in the workspace makes the next check process sleep (`HOLDABLE_CHECK`). It is
 * under `.cache`, which the verification source digest leaves out (`candidateWorkspaceIncludesPath`), so
 * placing or taking it never changes a round's source (no `source_changed` gap, no VD-8).
 */
export const HOLD_CHECK_MARKER = '.cache/ag2b-hold-check';
/** Written by the test once the held process may end (after the restart that interrupted its check). */
export const RELEASE_CHECK_MARKER = '.cache/ag2b-release-check';

/**
 * The AG2b static check (PASS iff the result file holds the result text), except that a check process
 * that finds `HOLD_CHECK_MARKER` in the workspace takes it (and any stale release marker) and waits for
 * `RELEASE_CHECK_MARKER`, then exits 0: the C-01 crash point of exactly that check (the process runs on
 * the live workspace root, so the marker is taken by the process itself, never by the test racing it);
 * the next check runs normally. Nobody releasing it within 20 s (under the 30 s check timeout) exits 9,
 * a failed check: a restart slower than that fails its C-01 assertion, never turns into a booked PASS.
 */
export const HOLDABLE_CHECK = `node -e "const fs=require('node:fs');if(fs.existsSync('${HOLD_CHECK_MARKER}')){fs.rmSync('${HOLD_CHECK_MARKER}');`
  + `fs.rmSync('${RELEASE_CHECK_MARKER}',{force:true});const t=Date.now();const w=setInterval(()=>{`
  + `if(fs.existsSync('${RELEASE_CHECK_MARKER}')){clearInterval(w)}else if(Date.now()-t>20000){process.exit(9)}},50)}`
  + `else{const text=fs.readFileSync('${AG2B_RESULT_FILE}','utf8');if(text.trim()!=='${AG2B_RESULT_TEXT}'){process.exit(3)}`
  + `console.log('AG2B_CHECK_OK')}"`;

/** The next check process will hold (`HOLDABLE_CHECK`); put it in place before the round opens. */
export async function holdChecks(root: string): Promise<void> {
  await mkdir(join(root, '.cache'), { recursive: true });
  await writeFile(join(root, HOLD_CHECK_MARKER), 'hold\n');
}
/** Lets a held check process end now (its result, if any, is booked or refused as the records decide). */
export async function releaseHeldCheck(root: string): Promise<void> {
  await mkdir(join(root, '.cache'), { recursive: true });
  await writeFile(join(root, RELEASE_CHECK_MARKER), 'release\n');
}
export function checksHeld(root: string): boolean { return existsSync(join(root, HOLD_CHECK_MARKER)); }

// ---------------------------------------------------------------------------
// §12.10 step 4: another start on the same data writes nothing
// ---------------------------------------------------------------------------

/** The report lines that changed a record (or failed to): every line that is not `left`. */
export function reportChanges(report: HostReconcileReportV1['report']): string[] {
  if (report === null) return ['no reconcile report'];
  return [...report.sessions, ...report.runs, ...report.queries, ...report.checks, ...report.controls]
    .filter(line => line.status !== 'left').map(line => `${line.row} ${line.status} ${line.ref}: ${line.reason}`);
}

async function autoReworkLimitOf(database: string): Promise<number> {
  const path = join(database, 'host-settings', 'host-settings.json');
  if (!existsSync(path)) return 3;
  const settings = JSON.parse(await readFile(path, 'utf8')) as { automation?: { autoReworkLimit?: number } };
  return settings.automation?.autoReworkLimit ?? 3;
}

/**
 * §12.10 step 4 on a `HostScenario`. The abandoned Hosts are drained first (draining lets an abandoned
 * Host's Kernel end a Turn it held: new Kernel data, no restart's write) and the live Host's automatic
 * capture settles (a PASS that a background driver finalized, such as the start-up re-drive, starts one
 * that `advance()` never awaited; the crash below leaves that Host running); then a crash restart on the same
 * data with the start-up re-drive off (step 5: only the reconcile runs) owns the lease, changes no record
 * (every report line `left`) and writes nothing (`counts()` equal: no model call, Kernel Turn or check
 * start). The re-drive stays off afterwards.
 */
export async function expectQuietHarnessRestart(h: HostScenario, label: string): Promise<HostReconcileReportV1> {
  await h.drainAbandoned();
  await h.settleAutoCapture();
  const before = h.counts();
  const restarted = await h.restart({ crash: true, automation: { ...h.automationPolicy(), resumeOnStartup: false } });
  expect(restarted, label).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { problems: [] } });
  expect(reportChanges(restarted.report), `${label}: another start reconciles nothing`).toEqual([]);
  expect(h.counts(), `${label}: another start writes nothing`).toEqual(before);
  return restarted;
}

/**
 * §12.10 step 4 on a moved case's own files: a Host started on them with the start-up re-drive off (the
 * case's rework limit kept) owns the lease, changes no record (every report line `left`), writes nothing
 * (`fileCounts` equal) and calls no model; then `whileOpen` runs on it and it is closed. Every Host of the
 * case must be closed first, except a crashed Host whose model call is still held (draining it lets its
 * Kernel end that Turn, which is new Kernel data), so call this before releasing such a Host.
 */
export async function expectQuietRestart(database: string, publicDir: string, root: string, options: {
  label?: string;
  start?: Omit<AG2bOverrides, 'root' | 'database'>;
  whileOpen?: (host: AG2bHost) => Promise<void>;
} = {}): Promise<HostReconcileReportV1> {
  const label = options.label ?? 'another start';
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: await autoReworkLimitOf(database), resumeOnStartup: false });
  const before = fileCounts(database);
  const host = await startAG2bHost(publicDir, { ...options.start, root, database });
  try {
    const reconcile = host.host.reconcile;
    expect(reconcile, label).toMatchObject({ lease: 'owned', report: { problems: [] } });
    expect(reportChanges(reconcile.report), `${label}: the reconcile changes nothing again`).toEqual([]);
    expect(fileCounts(database), `${label}: nothing is written`).toEqual(before);
    expect(host.scripted.calls() + host.queryScripted.calls(), `${label}: no model call`).toBe(0);
    await options.whileOpen?.(host);
    return reconcile;
  } finally {
    await host.host.close();
  }
}

// ---------------------------------------------------------------------------
// Moved cases (tests/app/A2-host-restart.test.ts, A2-host-reconcile.test.ts, A2-automation-rework.test.ts at
// 05125db): the crash of their own `startAG2bHost` setups.
// ---------------------------------------------------------------------------

export type Crashed = {
  first: AG2bHost;
  runRef: RunRef;
  /** The crashed Host's in-flight Workflow `start` step; settles once the Host is released. */
  inFlight: Promise<unknown>;
  release(): Promise<void>;
};

/**
 * Host 1 enters the work Run; the Turn completes a `read` tool group, then the
 * second model request blocks (the Kernel Turn stays open). `beforeBlock`
 * acts on Host 1 while the first request runs (a steer here is accepted by the
 * Kernel at the second model boundary); `whileBlocked` acts while the second
 * request blocks (a control here stays queued). Then the lock is rewritten as a
 * crashed Host leaves it. (`flowId`: the moved re-drive case drove its own flow.)
 */
export async function crashMidTurn(root: string, database: string, publicDir: string, actions: {
  beforeBlock?: (host: AG2bHost, runRef: RunRef) => Promise<void>;
  whileBlocked?: (host: AG2bHost, runRef: RunRef) => Promise<void>;
} = {}, flowId = 'a2-crash', inv: InvariantTarget = { database }): Promise<Crashed> {
  const reached = deferred();
  const hold = deferred();
  const firstRequest = deferred<RunRef>();
  let first: AG2bHost | undefined;
  first = await startAG2bHost(publicDir, { root, database, replies: READ_THEN_TEXT,
    beforeReply: async (_request, index) => {
      if (first === undefined) return;
      if (index === 0) {
        const runRef = (await workRow(first)).execution;
        if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
        await actions.beforeBlock?.(first, runRef);
        firstRequest.resolve(runRef);
        return;
      }
      reached.resolve();
      await hold.promise;
    } });
  await seedAG2bWorkGraph(first);
  // A.2 step 6: the steps before the start are checked one by one (§11 invariants with each receipt's step).
  const start = (await driveChecked(first, inv, selectWork(flowId), { stopBefore: 'start' })).next;
  if (start === null) throw new Error('the Workflow must reach the start');
  const inFlight = post(first, 'workflow/advance', plain(AG2B_SCOPE, start)).catch(() => undefined);
  const runRef = await firstRequest.promise;
  await reached.promise;
  await actions.whileBlocked?.(first, runRef);
  expect(first.scripted.calls(), 'the second model request is in flight on the crashed Host').toBe(2);
  await writeStaleLock(database);
  const host = first;
  return { first: host, runRef, inFlight, async release() {
    hold.reject(new Error('A2 crash: the crashed Host never answers this request'));
    await inFlight;
    await host.host.close();
  } };
}

const SKILLS_ROOT = fileURLToPath(new URL('../../../vendor/coding-agent/resources/skills', import.meta.url));

/** A model that must never be called (the Kernel refuses before any request). */
class UnusedModel implements ModelClientPort {
  readonly requests: ModelRequest[] = [];
  async *stream(request: Readonly<ModelRequest>): AsyncIterable<ModelEvent> {
    this.requests.push(structuredClone(request));
    throw new Error('restart scenario: the forced Turn must never reach the model');
  }
}

/**
 * A8-3l step 6 (反向对照): a new Turn forced on `kernelSessionId` of the frozen Kernel's own store at the
 * Session's completed boundary, as a claim that bypassed `kernel_turn_open` would start it. Answers the
 * Kernel's refusal message (the call must reject) and the model requests it made.
 */
export async function forceTurnOnKernelSession(databasePath: string, workspaceRoot: string, kernelSessionId: string,
  throughPosition: number): Promise<{ refusal: string; modelRequests: number }> {
  const model = new UnusedModel();
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: 'deepseek', model: 'restart-forced-turn', options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 20_000, maxModelRequests: 2, maxToolCalls: 2 },
    tools: { enabledNames: ['read'] },
    storage: { databasePath },
    skills: { resourceRoot: SKILLS_ROOT, enabledIds: [] },
    memory: { provider: 'empty' },
  });
  const providerRegistry = new ProviderRegistry().register({ id: 'deepseek', secretEnvironmentVariable: 'RESTART_FORCED_TURN_KEY',
    defaultBaseUrl: 'https://invalid.test', capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => model });
  try {
    await runCodingAgent({ config, workspaceRoot, sessionId: kernelSessionId, providerRegistry,
      secretSource: { get: () => 'restart-forced-turn-key' }, input: 'restart scenario: a Turn forced on the retired Session',
      executionIdentity: { runId: 'restart-forced-run', turnId: 'restart-forced-turn' },
      sessionContext: { version: 1, mode: 'session_history', throughPosition } });
  } catch (error) {
    return { refusal: error instanceof Error ? error.message : String(error), modelRequests: model.requests.length };
  }
  throw new Error('the frozen Kernel accepted a Turn on a Session whose last Turn never ended');
}
