/** Slice 1 §5.3 archive owner and durable control-pin recovery. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SubmitControlInput, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { createSessionArchiveService } from '../../src/business/workflow/session-archive.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY } from '../../src/business/workflow/ports.js';
import { commitBarrier } from '../helpers/graph-session-fixture.js';
import { createArchiveServiceFixture, committed, ready, t1, type ArchiveServiceFixture } from '../helpers/S1-archive-service-fixture.js';

const opened: ArchiveServiceFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
async function open(kind: 'memory' | 'sqlite') {
  const f = await createArchiveServiceFixture(kind); opened.push(f); return f;
}
function archive(f: ArchiveServiceFixture, controls: RunControlPort) {
  return createSessionArchiveService({ controls, sessionLifecycle: f.lifecycle, sessionFacts: f.sessionFacts,
    responsibilities: f.responsibilities, sessionAnomalies: f.anomalies, archivePolicy: DEFAULT_SESSION_ARCHIVE_POLICY });
}
function controlTrace(inner: RunControlPort, loseFirst = false) {
  const requests: GraphWrite<SubmitControlInput>[] = [];
  const results: WriteResult<SubmittedControl>[] = [];
  const port: RunControlPort = {
    async submitControl(ctx, request) {
      requests.push(structuredClone(request));
      const result = await inner.submitControl(ctx, request);
      results.push(structuredClone(result));
      if (loseFirst && result.status === 'committed') {
        loseFirst = false;
        return { status: 'rejected', code: 'unavailable', reason: 'fx1 lost the committed control response' };
      }
      return result;
    },
    readControl: (ctx, ref) => inner.readControl(ctx, ref),
  };
  return { port, requests, results };
}
const intentCommits = (f: ArchiveServiceFixture) => f.batches.filter(({ batch }) =>
  batch.events.some(event => event.eventType === 'ControlIntentSubmitted'));

describe.each(['memory', 'sqlite'] as const)('Session archive owner (%s)', kind => {
  it('SV21 registers R on busy S and releases the original generation while preserving R until final', async () => {
    const f = await open(kind); await f.enter();
    const before = (await f.session()).record;
    expect(before.occupancy?.generation).toBe(f.b2.claim.generation);
    const request = await f.register();
    const registered = (await f.session()).record;
    expect({ revision: registered.revision, occupancy: registered.occupancy }).toEqual({
      revision: before.revision + 1, occupancy: before.occupancy });
    await f.end();
    const released = (await f.session()).record;
    expect(released.occupancy).toBeNull();
    expect(released.archiveRequest).toEqual(request);
    const result = committed(await f.lifecycle.finishSessionArchive(f.ctx, f.step(request, 'archive')));
    expect({ lifecycle: result.value.lifecycle, archiveRequest: result.value.archiveRequest }).toEqual({ lifecycle: 'archived', archiveRequest: null });
  });

  it('SV22 a legal write on S after the final read conflicts without undoing its disposed responsibility', async () => {
    const f = await open(kind); await f.link(); await f.enter(); await f.end();
    const request = await f.register({ tasks: [{ target: f.taskTarget, disposition: { kind: 'transfer', to: f.D } }] });
    const disposal = committed(await f.responsibilities.disposeArchiveResponsibility(f.ctx, f.step(request, 'responsibility', f.taskTarget)));
    expect(disposal.value.closed.until).toEqual(disposal.cursor);
    const sourceBefore = (await f.session()).links;
    const targetBefore = (await f.session(f.D)).links;
    // An actual new yield is impossible here: S has no occupancy, R excludes new
    // claims, and its stopped writer cannot yield again. Race an allowed health
    // observation on S instead; the row's literal yield is reported UNDETERMINED.
    let releaseHealth!: () => void;
    const healthDone = new Promise<void>(resolve => { releaseHealth = resolve; });
    const barrier = commitBarrier({ ...f.records, async commit(batch) {
      if (batch.events.some(event => event.eventType === 'SessionArchived')) await healthDone;
      return f.records.commit(batch);
    } });
    const finish = barrier.run(() => f.lifecycleOn(barrier.records).finishSessionArchive(f.ctx, f.step(request, 'archive')));
    const change = barrier.run(async () => {
      try {
        const result = await f.healthOn(barrier.records).recordSessionHealth(f.ctx,
          { sessionRef: f.S, probe: { verdict: 'missing', activeRunId: null } });
        expect(result).toMatchObject({ status: 'observed' });
        return result;
      } finally { releaseHealth(); }
    });
    const [result] = await Promise.all([finish, change]);
    expect(barrier.arrivals).toBe(2);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error(JSON.stringify(result));
    expect(result.code).toBe('revision_conflict');
    expect(result.current).toEqual([await f.sessionPin()]);
    expect((await f.session()).record.lifecycle).toBe('active');
    expect((await f.session()).links).toEqual(sourceBefore);
    expect((await f.session(f.D)).links).toEqual(targetBefore);
    expect((await f.session()).links.find(link => link.ref.relation === 'responsible')?.until).toEqual(disposal.cursor);
    await f.invariants();
  });

  it('SV23 final archive of a retired, disposed wait and responsibility leaves the encoded message unchanged', async () => {
    const f = await open(kind); await f.link(); await f.enter();
    const message = await f.send(); await f.yieldWait(message); await f.retire();
    const request = await f.register({ mode: 'retired',
      tasks: [{ target: f.taskTarget, disposition: { kind: 'drop' } }],
      wait: { kind: 'cancel', runRef: f.b2.claim.runRef, messageRef: message.ref } });
    committed(await f.mailbox.disposeArchiveWait(f.archiveCtx(request), f.step(request, 'wait_cancel', f.b2.claim.runRef)));
    await f.cancel(request);
    committed(await f.responsibilities.disposeArchiveResponsibility(f.archiveCtx(request), f.step(request, 'responsibility', f.taskTarget)));
    const before = await f.encoded(message.ref);
    expect(before).not.toBeNull();
    const result = committed(await f.lifecycle.finishSessionArchive(f.archiveCtx(request), f.step(request, 'archive')));
    expect(result.value.lifecycle).toBe('archived');
    expect(await f.encoded(message.ref)).toEqual(before); // Excludes readThrough, the global watermark.
  });

  it('SV24 the same archive id with changed target and confirmation retains the original choices', async () => {
    const f = await open(kind); await f.link(); await f.enter();
    const write = await f.archiveWrite({ tasks: [{ target: f.taskTarget, disposition: { kind: 'drop' } }] });
    const first = committed(await f.lifecycle.requestSessionArchive(f.ctx, write));
    const before = f.snapshot();
    const result = await f.lifecycle.requestSessionArchive(f.ctx, { ...write,
      input: { ...write.input, confirmUnknownStopped: true,
        tasks: [{ target: f.taskTarget, disposition: { kind: 'transfer', to: f.D } }] } });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error(JSON.stringify(result));
    expect(result.code).toBe('idempotency_conflict');
    expect(result.reason.startsWith('identity ')).toBe(true);
    expect(result.reason.endsWith(' was committed with a different fingerprint')).toBe(true);
    expect((await f.session()).record).toEqual(first.value);
    expect(f.snapshot()).toEqual(before);
    await f.invariants();
  });

  it('SV25 final replay after reactivation returns the original archived value and cursor', async () => {
    const f = await open(kind); await f.enter();
    const request = await f.register(); await f.end();
    const step = f.step(request, 'archive');
    const first = committed(await f.lifecycle.finishSessionArchive(f.ctx, step));
    committed(await f.lifecycle.reactivateSession(f.ctx, { input: { sessionRef: f.S, reason: 'New work' },
      meta: { requestId: 'reactivate', expected: [await f.sessionPin()] } }));
    const before = f.snapshot();
    expect(await f.lifecycle.finishSessionArchive(f.ctx, step)).toEqual({ ...first, replayed: true });
    expect((await f.session()).record.lifecycle).toBe('active');
    expect(f.snapshot()).toEqual(before);
    await f.invariants();
  });

  it('SV56 final replay works after R was cleared and adds no write', async () => {
    const f = await open(kind); await f.enter();
    const request = await f.register(); await f.end();
    const step = f.step(request, 'archive');
    const first = committed(await f.lifecycle.finishSessionArchive(f.ctx, step));
    expect({ lifecycle: first.value.lifecycle, archiveRequest: first.value.archiveRequest }).toEqual({ lifecycle: 'archived', archiveRequest: null });
    expect((await f.session()).record.archiveRequest).toBeNull();
    const before = f.snapshot();
    expect(await f.lifecycle.finishSessionArchive(f.ctx, step)).toEqual({ ...first, replayed: true });
    expect(f.snapshot()).toEqual(before);
    await f.invariants();
  });

  it('SV60 lost cancel response recovers the original request, pin, intent and receipt', async () => {
    const f = await open(kind); await f.enter();
    const originalPin = await f.pin(f.b2.claim.runRef);
    const trace = controlTrace(f.controls, true);
    const write = await f.archiveWrite(); // r0 is running, so there is no yielded wait choice.
    const first = ready(await archive(f, trace.port).archiveLine(f.ctx, write));
    expect(first.state).toBe('partial');
    expect(first.rejection?.code).toBe('unavailable');
    const original = committed(trace.results[0] ?? (() => { throw new Error('no control submitted'); })());
    const registered = (await f.session()).record.archiveRequest;
    if (!registered) throw new Error('R was lost');
    expect(registered.executionPins).toEqual([originalPin]);
    expect(trace.requests).toEqual([f.cancelRequest(registered, f.b2.claim.runRef)]);
    expect(await f.pin(f.b2.claim.runRef)).toEqual({ ...originalPin, revision: originalPin.revision + 1 });
    expect(intentCommits(f)).toHaveLength(1);
    const storedIntent = await f.encoded(original.value.intent.ref);
    f.setNow(t1); await f.reopen();
    const recovery = controlTrace(f.controlsOn());
    const before = f.snapshot();
    const result = ready(await archive(f, recovery.port).continueArchiveLine(f.ctx, { sessionRef: f.S, archiveRequestId: registered.requestId }));
    expect(result.state).toBe('pending');
    expect(result.rejection).toBeNull();
    expect(recovery.requests).toEqual(trace.requests);
    expect(recovery.results).toEqual([{ ...original, replayed: true }]);
    expect((await f.session()).record.archiveRequest).toEqual(registered);
    expect(await f.encoded(original.value.intent.ref)).toEqual(storedIntent);
    expect(intentCommits(f)).toHaveLength(1);
    expect(f.snapshot()).toEqual(before);
    // The declared SessionArchiveDependencies has no Runtime delivery port.
    // Deliver this original intent through the real Runtime coordinator, then
    // observe its stop through the trusted B2 result/CTL path;
    // automatic deliverControl by the composition remains an explicit spec gap.
    await f.observeCancel(original.value.intent);
    expect(ready(await f.controls.readControl(f.ctx, original.value.intent.ref)).status).toBe('applied');
  });

  it('SV61 a different control wins r0@k and recovery remains partial with R and its original pin', async () => {
    const f = await open(kind); await f.enter();
    const originalPin = await f.pin(f.b2.claim.runRef);
    let failed = false;
    const controls = f.controlsOn({ ...f.records, async commit(batch) {
      if (!failed && batch.events.some(event => event.eventType === 'ControlIntentSubmitted')) {
        failed = true;
        return { status: 'rejected', code: 'unavailable', reason: 'fx1 cancel commit failed' };
      }
      return f.records.commit(batch);
    } });
    const first = ready(await archive(f, controls).archiveLine(f.ctx, await f.archiveWrite()));
    expect({ state: first.state, code: first.rejection?.code }).toEqual({ state: 'partial', code: 'unavailable' });
    const registered = (await f.session()).record.archiveRequest;
    if (!registered) throw new Error('R was not retained');
    expect(registered.executionPins).toEqual([originalPin]);
    expect(intentCommits(f)).toHaveLength(0);
    committed(await f.controls.submitControl(f.ctx, { input: { runRef: f.b2.claim.runRef, kind: 'pause', reason: 'Other control' },
      meta: { requestId: 'other-pause', expected: [originalPin] } }));
    expect({ revision: (await f.execution()).run.revision, status: (await f.execution()).run.status })
      .toEqual({ revision: originalPin.revision + 1, status: 'running' });
    const trace = controlTrace(f.controlsOn());
    f.setNow(t1);
    const before = f.snapshot();
    const result = ready(await archive(f, trace.port).continueArchiveLine(f.ctx, { sessionRef: f.S, archiveRequestId: registered.requestId }));
    expect({ state: result.state, code: result.rejection?.code }).toEqual({ state: 'partial', code: 'revision_conflict' });
    expect(result.rejection?.reason.startsWith('the Run changed since the caller read it')).toBe(true);
    expect(trace.requests).toEqual([f.cancelRequest(registered, f.b2.claim.runRef)]);
    expect((await f.session()).record.archiveRequest).toEqual(registered);
    expect(intentCommits(f)).toHaveLength(1); // Only the unrelated pause.
    expect(f.snapshot()).toEqual(before);
    await f.invariants();
  });
});
