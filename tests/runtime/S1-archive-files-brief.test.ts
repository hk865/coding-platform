/** Slice 1 §2.6–2.7, §5.4: real Runtime histories, archive facts and saved inputs. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { ArchiveStepRefV1 } from '../../src/contracts/core/session-archive.js';
import type { ArchiveRequeueOriginV1, SessionAnomalyAnchorV1 } from '../../src/contracts/session-anomaly.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { continuationBriefDigest, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { createArchiveChangedFilesReader } from '../../src/core/agent-runtime/session-anomaly-facts.js';
import { loadPreparedManifest } from '../../src/core/agent-runtime/execution-preparation.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { reconcileRunAtStartup } from '../../src/core/agent-runtime/run-reconcile.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { committed, installS1DateClock, ledgerCounts, openS1RuntimeFixture, ready, S1_T0 as t0 } from '../helpers/S1-runtime-scenario-fixture.js';

const WARNING = '工作区里还没提交的改动，可能混有别的执行的改动，不一定是这次执行改的';
const LAST_SENTENCE = '这些改动在工作区里，没撤销，也没核对；先看清它们再接着做。';
const key = (value: object) => canonicalJson(value as JsonValue);
type Fixture = Awaited<ReturnType<typeof openS1RuntimeFixture>>;
const opened: Fixture[] = [];
let restoreClock: (() => void) | undefined;
beforeEach(() => { restoreClock = installS1DateClock(); });
afterEach(async () => {
  try { for (const f of opened.splice(0)) await f.close(); } finally { restoreClock?.(); }
});
async function open(options: Parameters<typeof openS1RuntimeFixture>[0] = {}) {
  const f = await openS1RuntimeFixture(options);
  opened.push(f);
  return f;
}
async function missingKernelReader(f: Fixture) {
  // The adapter is registered and readable, but its store has no source Session.
  // This is Kernel missing, not an unregistered-adapter/Host configuration error.
  return createArchiveChangedFilesReader({ ...f.deps, kernelStores: await createKernelStoreRegistry({ entries: [{
    adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store', workspace: f.base.scope,
    databasePath: join(f.base.directory, 'missing-kernel.sqlite'),
  }] }) });
}

async function briefRow(count: number) {
  const f = await open({ replies: Array.from({ length: count }, () => ({ kind: 'text' as const, text: 'unreturned answer' })),
    beforeReply: async () => { throw new Error('S1 scripted provider failure'); } });
  const target = { kind: 'task' as const, ref: { projectId: f.base.scope.projectId, goalId: f.base.goalRef.goalId,
    taskId: f.base.tasks.first.taskId } };
  await f.linkResponsible(f.base.sessions.first, target);
  let current = await f.claim();
  const stopped: TaskClaim[] = [];
  // No anchors yet: earlier preparations cannot pick any up. Each execution
  // uses a distinct Session and its own real failed Kernel Turn.
  for (let i = 0; i < count; i++) {
    await f.run(current);
    expect((await f.read(current)).run).toMatchObject({ status: 'ended', outcome: 'crashed' });
    stopped.push(current);
    expect(await f.health.recordSessionHealth(f.base.ctx, { sessionRef: current.sessionRef,
      probe: { verdict: 'missing', activeRunId: null } })).toMatchObject({ status: 'observed', session: { health: 'unavailable' } });
    if (i + 1 < count) {
      const next = await f.requeue(current);
      const successorSession = await f.createSession();
      await f.linkResponsible(successorSession, target);
      current = await f.claim(successorSession, current.task.taskId, next.ref);
    }
  }
  const anchors: SessionAnomalyAnchorV1[] = [];
  let origin: ArchiveRequeueOriginV1 | undefined;
  for (const claim of stopped) {
    const session = committed(await f.lifecycle.requestSessionArchive(f.base.ctx, { input: {
      sessionRef: claim.sessionRef, reason: 'archive this retired stopped execution', tasks: [{ target, disposition: { kind: 'drop' } }], wait: null },
      meta: { requestId: f.newId(), expected: [await f.base.sessionPin(claim.sessionRef)] } }));
    const request = session.archiveRequest;
    if (!request) throw new Error('the real archive request is missing');
    const step = (kind: ArchiveStepRefV1['step'], subject: object): ArchiveStepRefV1 => ({ sessionRef: claim.sessionRef,
      archiveRequestId: request.requestId, requestReceipt: request.receipt, step: kind, subjectKey: key(subject) });
    f.setFiles([`changed-${anchors.length}`]);
    const files = ready(await (await missingKernelReader(f)).readArchiveChangedFiles(f.base.ctx, { runRef: claim.runRef }));
    expect(files.source).toBe('worktree');
    expect(files.reason).toContain(WARNING);
    const anchor = committed(await f.anomalies.recordSessionAnomaly(f.base.ctx, { step: step('anchor', claim.runRef), files }));
    anchors.push(anchor);
    const disposed = committed(await f.responsibilities.disposeArchiveResponsibility(f.base.ctx, step('responsibility', target)));
    expect(disposed.opened).toBeNull();
    expect(disposed.closed.until).not.toBeNull();
    expect(committed(await f.lifecycle.finishSessionArchive(f.base.ctx, step('archive', claim.sessionRef))))
      .toMatchObject({ lifecycle: 'archived', archiveRequest: null, occupancy: null });
    if (claim.runRef.runId === current.runRef.runId) origin = { kind: 'execution', anchorRef: anchor.ref,
      archiveSessionRef: claim.sessionRef, archiveRequestId: request.requestId };
  }
  const next = await f.requeue(current, origin);
  const successor = await f.claim(await f.createSession(), current.task.taskId, next.ref);
  expect(stopped.map(claim => claim.sessionRef.sessionId)).not.toContain(successor.sessionRef.sessionId);
  f.captures.length = 0; // Count preparation captures after all setup captures.
  const prepared = await f.prepare(successor);
  committed(await f.entry.authorizeRuntimeEntry(f.base.ctx, { input: { prepared, consumerId: 's1-runtime' },
    meta: { requestId: f.newId(), expected: [await f.pin(successor)] } }));
  anchors.sort((a, b) => a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : key(a.ref) < key(b.ref) ? -1 : 1);
  return { f, prepared, successor, anchors };
}

describe('S1 archive changed files and brief anomaly section', () => {
  it('IT01 confirmed edit a and an unobserved edit b produce kernel/partial', async () => {
    const f = await open({ replies: [
      { kind: 'calls', calls: [{ callId: 's1-edit-a', name: 'edit', args: { mode: 'create', path: 'a', newText: 'a\n' } }] },
      { kind: 'calls', calls: [{ callId: 's1-edit-b', name: 'edit', args: { mode: 'create', path: 'b', newText: 'changed b\n' } }] },
    ] });
    const claim = await f.claim();
    // Fail the durable Kernel sink after b has STARTED. A known edit rejection
    // is not an unknown effect. Keep the genuine prefix, including a's result.
    const db = new DatabaseSync(join(f.base.directory, 'kernel.sqlite'));
    db.exec(`CREATE TRIGGER s1_lost_result BEFORE INSERT ON session_records
      WHEN EXISTS (SELECT 1 FROM session_records WHERE json_extract(record_json, '$.payload.event.type') = 'tool.started'
        AND json_extract(record_json, '$.payload.event.payload.call.callId') = 's1-edit-b')
      BEGIN SELECT RAISE(ABORT, 'S1 lost tool result'); END;`);
    db.close();
    try { await f.run(claim); }
    finally {
      const drop = new DatabaseSync(join(f.base.directory, 'kernel.sqlite'));
      try { drop.exec('DROP TRIGGER s1_lost_result'); } finally { drop.close(); }
    }
    const history = new DatabaseSync(join(f.base.directory, 'kernel.sqlite'), { readOnly: true });
    try {
      const toolEvents = history.prepare(`SELECT json_extract(record_json, '$.payload.event.type') AS type,
        COALESCE(json_extract(record_json, '$.payload.event.payload.call.callId'),
          json_extract(record_json, '$.payload.event.payload.callId')) AS callId,
        json_extract(record_json, '$.payload.event.payload.result.status') AS status
        FROM session_records WHERE json_extract(record_json, '$.payload.event.type') LIKE 'tool.%' ORDER BY position`)
        .all() as Array<{ type: string; callId: string; status: string | null }>;
      expect(toolEvents).toEqual([
        { type: 'tool.started', callId: 's1-edit-a', status: null },
        { type: 'tool.completed', callId: 's1-edit-a', status: 'success' },
        { type: 'tool.started', callId: 's1-edit-b', status: null },
      ]);
    } finally { history.close(); }
    expect(await readFile(join(f.base.directory, 'a'), 'utf8')).toBe('a\n');
    expect(await readFile(join(f.base.directory, 'b'), 'utf8')).toBe('changed b\n');
    const owner = createSessionHistoryCursorOwner({ kernelStores: f.deps.kernelStores });
    const record = await f.read(claim);
    const reconcile = createRunReconcileService({ records: f.records, reads: f.reads,
      hostInstance: { hostInstanceId: 's1-after-crash', lease: 'owned' }, now: () => t0, eventId: f.newId });
    const report = await reconcileRunAtStartup({ owner, controls: f.controls, entry: f.entry, reconcile,
      now: () => t0, newId: f.newId }, f.base.ctx, { record, hostInstanceId: 's1-after-crash',
      probe: await owner.probe({ session: record.session, signal: f.base.ctx.signal }) });
    expect(report.status).toBe('reconciled');
    expect((await f.read(claim)).run.outcome).toBe('outcome_unknown');
    const value = ready(await createArchiveChangedFilesReader(f.deps).readArchiveChangedFiles(f.base.ctx, { runRef: claim.runRef }));
    expect({ source: value.source, confirmed: value.confirmed, possible: value.possible, status: value.status })
      .toEqual({ source: 'kernel', confirmed: ['a'], possible: ['b'], status: 'partial' });
    expect(f.captures).toEqual([]);
  });

  it('IT02 missing Kernel falls back to current HEAD a/b with a mixed-ownership warning', async () => {
    const f = await open();
    const claim = await f.claim();
    await f.run(claim);
    await writeFile(join(f.base.directory, 'a'), 'uncommitted a\n');
    await writeFile(join(f.base.directory, 'b'), 'uncommitted b\n');
    f.setFiles(['a', 'b']);
    const value = ready(await (await missingKernelReader(f)).readArchiveChangedFiles(f.base.ctx, { runRef: claim.runRef }));
    expect({ source: value.source, confirmed: value.confirmed, possible: value.possible, runBaselineKnown: value.runBaselineKnown })
      .toEqual({ source: 'worktree', confirmed: [], possible: ['a', 'b'], runBaselineKnown: false });
    expect(value.reason).toContain(WARNING);
    expect(f.captures).toEqual([f.base.directory]);
  });

  it('IT32 formally not-entered Run ignores other worktree changes without capture', async () => {
    const f = await open({ replies: [
      { kind: 'calls', calls: [{ callId: 'other-work-a', name: 'edit', args: { mode: 'create', path: 'a', newText: 'other work\n' } }] },
      { kind: 'text', text: 'other work done' },
    ] });
    const other = await f.claim(f.base.sessions.second, f.base.tasks.second.taskId);
    await f.run(other);
    expect((await f.read(other)).run.outcome).toBe('completed');
    expect(await readFile(join(f.base.directory, 'a'), 'utf8')).toBe('other work\n');
    const claim = await f.claim();
    f.setFiles(['a']);
    committed(await f.controls.submitControl(f.base.ctx, { input: { runRef: claim.runRef, kind: 'cancel', reason: 'cancel before entry' },
      meta: { requestId: f.newId(), expected: [await f.pin(claim)] } }));
    expect((await f.read(claim)).run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
    const value = ready(await createArchiveChangedFilesReader(f.deps).readArchiveChangedFiles(f.base.ctx, { runRef: claim.runRef }));
    expect({ source: value.source, status: value.status, confirmed: value.confirmed, possible: value.possible,
      omitted: value.omitted, runBaselineKnown: value.runBaselineKnown })
      .toEqual({ source: 'kernel', status: 'not_entered', confirmed: [], possible: [], omitted: 0, runBaselineKnown: false });
    expect(f.captures).toEqual([]);
  });

  it('IT03 repeated prepare keeps r0 anchor refs and the saved digest with one capture', async () => {
    const { f, prepared, successor, anchors } = await briefRow(1);
    const original = ready(await loadPreparedManifest(f.bodies, prepared)).manifest;
    expect(original.continuationBrief?.anomalies?.anchors.map(anchor => anchor.ref)).toEqual([anchors[0]!.ref]);
    expect(prepared.inputBinding.anomalyAnchorRefs).toEqual([anchors[0]!.ref]);
    expect(prepared.inputBinding.continuationBriefDigest).toBe(continuationBriefDigest(original.continuationBrief!));
    expect(f.captures).toEqual([f.base.directory]);
    const counts = { ledger: ledgerCounts(f.base.directory), models: f.scripted.calls() };
    const repeated = await f.prepare(successor);
    expect({ ledger: ledgerCounts(f.base.directory), models: f.scripted.calls() }).toEqual(counts);
    expect(repeated).toEqual(prepared);
    expect(ready(await loadPreparedManifest(f.bodies, repeated)).manifest).toEqual(original);
    expect(f.captures).toEqual([f.base.directory]);
  });

  it('IT05 nine distinct stopped Runs assemble the earliest eight anchors and leave the ninth unpicked', async () => {
    const { f, prepared, successor, anchors } = await briefRow(9);
    expect(new Set(anchors.map(anchor => key(anchor.runRef))).size).toBe(9);
    const brief = ready(await loadPreparedManifest(f.bodies, prepared)).manifest.continuationBrief!;
    expect(brief.anomalies).toEqual({ anchors: anchors.slice(0, 8), omitted: 1, instructionVersion: 1 });
    expect(prepared.inputBinding.anomalyAnchorRefs).toEqual(anchors.slice(0, 8).map(anchor => anchor.ref));
    await f.run(successor); // Actual entry picks only the eight bound refs.
    const views = ready(await f.anomalies.listSessionAnomalies(f.base.ctx, { goalRef: f.base.goalRef, page: { limit: 100 } }));
    expect(views.items.filter(view => anchors.slice(0, 8).some(anchor => key(anchor.ref) === key(view.anchor.ref)))
      .map(view => view.pickedUpBy)).toEqual(Array.from({ length: 8 }, () => successor.runRef));
    expect(views.items.filter(view => key(view.anchor.ref) === key(anchors[8]!.ref)))
      .toEqual([{ anchor: anchors[8], pickedUpBy: null }]);
    const text = renderContinuationBriefZh(brief, continuationBriefDigest(brief));
    expect(text).toContain(WARNING);
    expect(text).toContain(LAST_SENTENCE);
  }, 120_000);
});
