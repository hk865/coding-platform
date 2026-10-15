/**
 * Slice 2C row 2C-21 (LE4): retired lines.
 *
 * Case (1): a Query (consultant) line whose Turn the Host restart interrupted
 *   leaves `kernel_turn_open`; it has no open responsibility and no continuation,
 *   reads `retired` (standby) and the start-up maintenance skips it — K does not
 *   close a Query line. The Query mid-Turn crash needs the raw KE3 host fixture
 *   because the `openHostScenario` script has no hook for a Query model call
 *   (only Work `duringReply`); the same raw fixture is used by
 *   `tests/scenarios/S2C-K2-controls.test.ts`.
 * Case (3): a Work line cleanly interrupted by the Host (RUN-19) with an open
 *   responsibility is closed by the start-up maintenance (K KA1 does not look at
 *   responsibility): the Session returns available and the line is no longer
 *   retired (two variants: with and without an open responsibility).
 *
 * Entry LE4: `openHostScenario` / `restart({ crash: true })`, `lines/list` and
 * `sessions/read`; case (1) uses `startAG2bHost` + `writeStaleLock` (the same
 * `tests/scenarios/harness.ts` base) and reads `lines/list` through the real
 * route. Cases (2) and (4) are reported in the comments at the bottom.
 */
import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import {
  AG2B_SCOPE, claimBusyQuery, createAG2bSession, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost,
  startBusyQuery, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  deferred, moveKernelAside, post, publicDirectory, readExecution, tempDir, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import {
  archivedLineContaining, lineArchived, lineConversation, lineList, ready, requireControl, requireLine, runMaintenance,
  sessionCard,
} from '../helpers/S2C-K-scenario-support.js';
import { NO_REDRIVE } from './support/common.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { ArchivedLinePageV1, WorkLineListV1 } from '../../src/contracts/work-line.js';

afterEach(cleanupScenarios);

/** `lines/list` on a raw KE3 host (no `HostScenario` wrapper). */
function rawLineList(host: AG2bHost): Promise<WorkLineListV1> {
  return post<ReadResult<WorkLineListV1>>(host, 'lines/list', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE }))
    .then(result => ready(result, 'lines/list on the raw host'));
}

/** `lines/archived` on a raw KE3 host. */
function rawArchived(host: AG2bHost): Promise<ArchivedLinePageV1> {
  return post<ReadResult<ArchivedLinePageV1>>(host, 'lines/archived',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, page: { limit: 100 } }))
    .then(result => ready(result, 'lines/archived on the raw host'));
}

/** The public Session card on a raw KE3 host. */
async function rawSessionCard(host: AG2bHost, ref: SessionRef): Promise<TaskExecutionRecord['session']> {
  const card = await post<ReadResult<{ record: TaskExecutionRecord['session'] }>>(host, 'sessions/read', plain(AG2B_SCOPE, ref));
  return ready(card, `sessions/read ${ref.sessionId}`).record;
}

it('2C-21 (1) a Query line interrupted mid-Turn leaves kernel_turn_open, reads retired and the start-up maintenance skips it', async () => {
  const root = await tempDir('s2c21q-ws-');
  const database = await tempDir('s2c21q-db-');
  const publicDir = await publicDirectory();
  const reached = deferred();
  const hold = deferred();
  const first = await startAG2bHost(publicDir, { root, database,
    queryReplies: [{ kind: 'text', text: '2C-21: the consultation is never answered' }],
    queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
  let inFlight: Promise<unknown> = Promise.resolve();
  let session: Awaited<ReturnType<typeof createAG2bSession>> | undefined;
  let refs: Awaited<ReturnType<typeof claimBusyQuery>> | undefined;
  try {
    await seedAG2bWorkGraph(first);
    session = await createAG2bSession(first, 's2c21q-session');
    refs = await claimBusyQuery(first, session, 's2c21q');
    inFlight = startBusyQuery(first, refs, 's2c21q').catch(() => undefined);
    await reached.promise;
    await writeStaleLock(database);
  } catch (error) {
    hold.reject(new Error('2C-21 (1) setup failed'));
    await inFlight;
    await first.host.close().catch(() => undefined);
    throw error;
  }
  // The restart with the Kernel registered reconciles the in-flight QueryRun by
  // its Kernel facts: the open Turn retires the Session (K SES-09 / KA-16).
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    if (session === undefined || refs === undefined) throw new Error('the Query setup must have run');
    expect(await rawSessionCard(second, session.sessionRef)).toMatchObject({
      lifecycle: 'active', occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });

    const list = await rawLineList(second);
    const row = requireLine(list, session.sessionRef.sessionId, 'the retired Query line');
    expect(row.status.own).toBe('retired');
    expect(row.status.ownReason.code).toBe('retired_turn_open');
    expect(row.status.bucket).toBe('standby');
    expect(row.status.archivedTag).toBeNull();

    // The start-up maintenance ran on this start and skipped the Query line
    // (K does not close Query lines): it is not on the archived page.
    const archived = await rawArchived(second);
    expect(archivedLineContaining(archived, session.sessionRef.sessionId),
      'the retired Query line is not archived').toBeUndefined();
  } finally {
    await second.host.close();
    hold.reject(new Error('2C-21 (1) cleanup'));
    await inFlight;
    await first.host.close().catch(() => undefined);
  }
}, 240_000);

type CardWithLinks = { record: { ref: unknown; revision: number };
  links: { ref: { target: WorkLinkTarget; relation: string }; revision: number; until: unknown }[] };

it('2C-21 (3) a RUN-19 clean interruption with an open responsibility is closed by the start-up maintenance and stops being retired', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ automation: NO_REDRIVE, script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c21-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c21: the interrupted Turn is never answered' },
  ] } });
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('s2c21-run1', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;

  await h.restart({ crash: true });
  const reconciled = await readExecution(h.host, runRef);
  expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'interrupted_clean', pausedIntentRef: null } } });
  // K KA1: the dangling Turn is closed although the Task responsibility is still open.
  expect(await sessionCard(h, { projectId: runRef.projectId, sessionId: head }))
    .toMatchObject({ lifecycle: 'active', health: 'available', healthConclusion: null });

  const list = ready(await lineList(h), 'lines/list after the closure');
  const row = requireLine(list, head, 'the closed RUN-19 line');
  expect(row.status.own).not.toBe('retired');
  expect(row.status.bucket).not.toBe('archived');
}, 240_000);

it('2C-21 (3b) a RUN-19 clean interruption with no open responsibility is also closed by the start-up maintenance and stops being retired', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ automation: NO_REDRIVE, script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c21b-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c21b: the interrupted Turn is never answered' },
  ] } });
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('s2c21b-run1', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const session = (await readExecution(h.host, runRef)).session;
  const sessionRef = { projectId: session.ref.projectId, sessionId: session.ref.sessionId };

  // The person closes the only open responsible link before the crash, so this
  // RUN-19 line has no open responsibility when the maintenance runs (K KA1
  // looks at neither responsibility nor the link).
  const card = ready(await h.post<ReadResult<CardWithLinks>>('sessions/read', plain(AG2B_SCOPE, sessionRef)),
    'sessions/read before the crash');
  const link = card.links.find(candidate => candidate.ref.relation === 'responsible' && candidate.until === null);
  expect(link, 'the work Run holds one open responsible link').toBeDefined();
  const unlinked = await h.answer('sessions/link', graphWrite(AG2B_SCOPE,
    { sessionRef, target: link!.ref.target, relation: 'responsible', active: false }, 's2c21b-unlink',
    [{ ref: card.record.ref, revision: card.record.revision }, { ref: link!.ref, revision: link!.revision }]));
  expect(unlinked.status, JSON.stringify(unlinked)).toBe('committed');

  await h.restart({ crash: true });
  const reconciled = await readExecution(h.host, runRef);
  expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'interrupted_clean', pausedIntentRef: null } } });
  expect(await sessionCard(h, sessionRef))
    .toMatchObject({ lifecycle: 'active', health: 'available', healthConclusion: null });

  const row = requireLine(ready(await lineList(h), 'lines/list after the closure'), sessionRef.sessionId,
    'the closed no-responsibility RUN-19 line');
  expect(row.status.own).not.toBe('retired');
  expect(row.status.bucket).not.toBe('archived');
}, 240_000);

/**
 * Corrupt the mapped Kernel rows (valid SQLite, unreadable records) so the
 * start-up probe reads `damaged` rather than `transient`/`missing`.
 */
async function damageKernel(database: string): Promise<void> {
  const kernel = new DatabaseSync(join(database, 'kernel.sqlite'));
  try {
    kernel.exec("UPDATE session_records SET record_json = '{'");
  } finally {
    kernel.close();
  }
}

/**
 * One crash mid-Turn after the Kernel store was moved aside (`missing`) or its
 * rows corrupted (`damaged`): the Run ends `outcome_unknown` and the Session
 * retires with the unreadable conclusion.
 */
async function crashedUnknownKernel(h: HostScenario, flowId: string, kernel: 'missing' | 'damaged'):
Promise<{ runRef: NonNullable<Awaited<ReturnType<HostScenario['taskRow']>>['execution']>; head: string }> {
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select(flowId, 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;
  if (kernel === 'missing') await moveKernelAside(h.database);
  else await damageKernel(h.database);
  await h.restart({ crash: true });
  const unknown = await readExecution(h.host, runRef);
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  expect(unknown.session).toMatchObject({ health: 'unavailable', healthConclusion: kernel });
  return { runRef, head };
}

/**
 * 2C-21 (2), two examples: a Work line whose Kernel store is `missing`/`damaged`
 * and which the Host restart left retired with the unreadable conclusion; its
 * original history is unreadable.
 *
 * Expected (2C-21 (2) row, lead 2026-10-15): the only route that clears the
 * unknown holder is a person's attestation, and it writes `kernel_turn_open`
 * (K SES-07/SES-10, decision 51). The next maintenance's KA1 closure then stays
 * `unreadable` (the store is still gone), the Runtime records the fresh
 * `missing`/`damaged` probe as the Turn closure (SES-19a), and the following
 * pass reads the unreadable conclusion and archives the line as "已归档 ·
 * 已退役" with `reactivate` refused. It never returns to available.
 *
 * The row's remaining details (it was waiting for a reply before it retired, the
 * two later undelivered replies, and the legacy overlay) are not built here.
 */
function retiredUnknownCase(name: string, kernel: 'missing' | 'damaged'): void {
  it(`2C-21 (2) a ${name} Kernel leaves the line retired with an unreadable history; the probe then retires it and maintenance archives it (SES-19a)`, async () => {
    const h = await openHostScenario({ script: { replies: [
      { kind: 'calls', calls: [{ callId: `s2c21${kernel}-g1`, name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: `2C-21 (2): the ${name}-Kernel Turn is never answered` },
    ] } });
    const { runRef, head } = await crashedUnknownKernel(h, `s2c21${kernel}-run1`, kernel);

    // Before the attestation: retired with the unreadable conclusion + attention unknown.
    const retired = requireLine(ready(await lineList(h), 'lines/list after the crash'), head, 'the retired line');
    expect(retired.status.own).toBe('retired');
    expect(retired.status.ownReason.code).toBe(`retired_${kernel}`);
    expect(retired.retired).toMatchObject({ conclusion: kernel });
    expect(retired.status.attention?.code).toBe('unknown');

    // §3.9: the original history is unreadable.
    const conversation = ready(await lineConversation(h, { projectId: runRef.projectId, sessionId: head }, { limit: 5 }),
      'the retired line conversation');
    const segment = conversation.items.find(item => item.kind === 'segment');
    expect(segment?.kind).toBe('segment');
    if (segment?.kind !== 'segment') throw new Error('the conversation must start with its segment header');
    expect(segment.segment.history).toBe('not_readable');

    const unknown = await readExecution(h.host, runRef);
    const attested = await h.post<ReadResult<unknown>>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason: `2C-21 (2): checked by hand, the ${name} Kernel wrote nothing` }, `s2c21${kernel}-attest`,
      [{ ref: runRef, revision: unknown.run.revision }]));
    expect(attested).toMatchObject({ status: 'committed' });
    expect((await readExecution(h.host, runRef)).session)
      .toMatchObject({ health: 'unavailable', healthConclusion: 'kernel_turn_open' });

    // Pass 1 must run on the Host: only its Runtime can close the dangling Turn
    // and reach the health owner (SES-19a); `runMaintenance` uses the
    // Runtime-less composition root.
    await h.advance(h.select(`s2c21${kernel}-1`, 'ag2b-work'), { maxSteps: 16, invariants: false }).catch(() => undefined);
    expect((await readExecution(h.host, runRef)).session)
      .toMatchObject({ health: 'unavailable', healthConclusion: kernel });

    // Pass 2: no kernel_turn_open exemption remains, so the line is archived as retired.
    await runMaintenance(h, `s2c21${kernel}-2`);
    const page = ready(await lineArchived(h), 'lines/archived after the maintenance');
    const archived = archivedLineContaining(page, head);
    expect(archived, 'the retired line is archived').toBeDefined();
    expect(archived?.status.bucket).toBe('archived');
    expect(archived?.status.archivedTag).toBe('retired');
    expect(archived?.status.own).toBe('retired');
    expect(archived?.retired).toMatchObject({ conclusion: kernel });
    const reactivate = requireControl(archived!, 'reactivate', 'the archived retired reactivate control');
    expect(reactivate).toMatchObject({ availability: 'unavailable', reasonCode: 'reactivate_refused_retired' });
    // The retired line never returns to available or re-enables.
    expect(await sessionCard(h, { projectId: runRef.projectId, sessionId: head }))
      .toMatchObject({ lifecycle: 'archived', health: 'unavailable', healthConclusion: kernel });
  }, 240_000);
}

retiredUnknownCase('missing', 'missing');
retiredUnknownCase('damaged', 'damaged');

// ---------------------------------------------------------------------------
// 2C-21 (4): the legacy-pending variant is not built here.
//
// The row wants a pre-slice-1 archived provenance-null Session in the workspace
// (`legacyPending` always true) next to a RUN-19 Work line: KA1 does not close
// it (the provenance is unresolved), the maintenance reports `incomplete` and
// leaves the line retired + provenance-unchecked.
//
// Today's writers always write `provenance`, so such a Session can only be
// injected at the storage boundary. The LE4 Host scenario has no public or
// documented-boundary way to submit a valid old Session record over the live
// ledger: the existing legacy fixture (`tests/scenarios/S2C-K-legacy-provenance.test.ts`)
// opens its own non-Host `TaskClaimFixture` with `commitRaw`/`overwriteSession`,
// and no `tests/scenarios/*` Host test injects a provenance-null Session. It is
// therefore reported, not faked here. The K-time behavior it would pin is
// already covered through the maintenance unit
// (`session-maintenance.ts:620` `facts.legacyPending` → `incomplete`).
// ---------------------------------------------------------------------------
