/**
 * Wiring 1 W18 (spec §5.2 rows HO01–HO13, HM01–HM04): the ordinary-continuation
 * handover (E15, `workflow.ts` W1-HO-01…04) and the retired-line maintenance
 * branch (`session-maintenance.ts` W1-AUTO-01).
 *
 * Every given is built through `tests/helpers/WP1-handover-fixture.ts` (memory
 * owners only). The row's action is always performed here: `select_work` first,
 * then exactly the `next` the previous result returned. No
 * `transfer_responsibility` / `archive_predecessor` operation is ever
 * constructed by the test.
 *
 * Red at the missing handover step (the `create_session` receipt still returns
 * `claim_task`) or at the `not implemented: Workflow step …` stubs; HO09/HO10/
 * HO11/HM02/HM03 assert unchanged behaviour and pass in the baseline.
 *
 * Fixed clock: t0='2026-10-08T00:00:00.000Z', t1='2026-10-09T00:00:00.000Z'
 * (the fixture freezes and restores it).
 */
import { describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import { SESSION_RESPONSIBILITY_CHANGED_EVENT, sessionResponsibilityChangedEventFromEvent }
  from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import {
  bumpSessionRevision,
  createArchivedPredecessorFixture,
  createHandedOverRetiredFixture,
  createInterruptedHandoverFixture,
  createModuleOnlyRetiredFixture,
  createOccupiedPredecessorFixture,
  createOtherResponsibilityFixture,
  createReusablePredecessorFixture,
  createRoleMismatchHandoverFixture,
  createStillResponsibleRetiredFixture,
  createUnknownOccupiedRetiredFixture,
  type HandoverComposition,
} from '../helpers/WP1-handover-fixture.js';

type Workflow = HandoverComposition['workflow'];
type AdvanceResult = Awaited<ReturnType<Workflow['advanceWork']>>;
type ReadyAdvance = Extract<AdvanceResult, { status: 'ready' }>;
type PerformNext = Extract<WorkflowAdvanceInput, { kind: 'perform' }>;

/** Assert the Workflow advanced (not waiting/rejected) and narrow the result. */
function advanced(result: AdvanceResult): ReadyAdvance {
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance' } });
  if (result.status !== 'ready') throw new Error('the Workflow did not advance');
  return result;
}

/** Assert the continuation is a `perform` and narrow it. */
function asPerform(next: WorkflowAdvanceInput | null): PerformNext {
  expect(next).toMatchObject({ kind: 'perform' });
  if (next === null || next.kind !== 'perform') throw new Error('a perform continuation was expected');
  return next;
}

type Selection = { workflow: Workflow; ctx: CoreCallContext; selectInput: WorkflowAdvanceInput };

/** `select_work` answers with a read-only (null receipt) first step. */
async function select(f: Selection): Promise<PerformNext> {
  const result = advanced(await f.workflow.advanceWork(f.ctx, f.selectInput));
  expect(result.value.receipt).toBeNull();
  return asPerform(result.value.next);
}

/** Perform a `create_session` and return its receipt's successor Session. */
async function createSession(f: Selection, step: PerformNext):
Promise<{ result: ReadyAdvance; C: SessionRef; next: PerformNext }> {
  const result = advanced(await f.workflow.advanceWork(f.ctx, step));
  const receipt = result.value.receipt;
  expect(receipt).toMatchObject({ kind: 'create_session', result: { status: 'completed' } });
  if (receipt === null || receipt.kind !== 'create_session' || receipt.result.status !== 'completed') {
    throw new Error('a completed create_session receipt was expected');
  }
  const C: SessionRef = {
    projectId: receipt.result.value.ref.projectId,
    sessionId: receipt.result.value.ref.sessionId,
  };
  return { result, C, next: asPerform(result.value.next) };
}

describe('wiring 1 ordinary-continuation handover', () => {
  it('HO01 create_session of a requeued Task continues a retired predecessor and returns transfer_responsibility', async () => {
    const f = await createInterruptedHandoverFixture();
    try {
      const first = await select(f);
      expect(first.operation).toMatchObject({
        kind: 'create_session',
        taskRef: f.T,
        request: { provenance: { schemaVersion: 1, kind: 'continuation', from: f.P, reason: 'interrupted', task: f.T } },
      });
      const created = await createSession(f, first);
      const C = created.C;
      expect(created.next.operation).toMatchObject({
        kind: 'transfer_responsibility', successor: C, taskRef: f.T,
      });
      const step = created.next;
      if (step.operation.kind !== 'transfer_responsibility') throw new Error('a transfer_responsibility step was expected');
      expect(step.operation.request.input).toEqual({ from: f.P, to: C, target: { kind: 'task', ref: f.T } });
      expect(step.operation.request.meta.expected).toEqual(await f.observations.transferPins(f.P, C));
      // B1: the fourth pin is C's responsible link on T, which exists, is open
      // and is at its initial revision 1.
      const cLink = await f.observations.link(C);
      expect(cLink).not.toBeNull();
      if (cLink === null) throw new Error('C must have a responsible link on T');
      expect(cLink.until).toBeNull();
      expect(cLink.revision).toBe(1);
      expect(step.operation.request.meta.expected[3]).toEqual({ ref: cLink.ref, revision: 1 });
      expect(step.operation.request.meta.requestId).toMatch(/^wf-auto:/);
      expect(step.operation.successor).toEqual(C);
      expect(step.operation.taskRef).toEqual(f.T);
    } finally { await f.close(); }
  });

  it('HO02 the transfer closes P->T, leaves C->T open, then maintenance archives P as handoff_complete', async () => {
    const f = await createInterruptedHandoverFixture();
    try {
      const created = await createSession(f, await select(f));
      const C = created.C;
      const step = created.next;
      expect(step.operation).toMatchObject({ kind: 'transfer_responsibility', successor: C });
      if (step.operation.kind !== 'transfer_responsibility') throw new Error('a transfer_responsibility step was expected');

      const cLinkBefore = await f.observations.link(C);
      const requeuesBefore = await f.observations.requeues(f.T);
      const transferred = advanced(await f.workflow.advanceWork(f.ctx, step));
      expect(transferred.value.receipt).toMatchObject({
        kind: 'transfer_responsibility', result: { status: 'committed', replayed: false },
      });
      if (transferred.value.receipt?.kind !== 'transfer_responsibility'
        || transferred.value.receipt.result.status !== 'committed') {
        throw new Error('a committed transfer receipt was expected');
      }
      const cursor = transferred.value.receipt.result.cursor;
      expect((await f.observations.link(f.P))?.until).toBe(cursor);
      expect(await f.observations.link(C)).toEqual(cLinkBefore);
      expect(await f.observations.openResponsible(f.P)).toBeNull();
      expect(await f.observations.openResponsible(C)).not.toBeNull();

      // The same advancement's bounded maintenance page archives the handed-over retired line.
      expect(await f.observations.session(f.P)).toMatchObject({ record: { lifecycle: 'archived' } });
      const requests = f.observations.archiveRequests(f.P);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ mode: 'handoff_complete' });
      expect(await f.observations.anchors()).toEqual([]);
      expect(await f.observations.requeues(f.T)).toEqual(requeuesBefore);
      expect(transferred.value.maintenanceFailures ?? []).toEqual([]);

      const claim = asPerform(transferred.value.next);
      expect(claim.operation).toMatchObject({ kind: 'claim_task' });
      if (claim.operation.kind !== 'claim_task') throw new Error('a claim_task step was expected');
      const cRevision = (await f.observations.session(C)).record.revision;
      expect(claim.operation.request.input.sessionRef).toEqual(C);
      expect(claim.operation.request.meta.expected[2]).toEqual({
        ref: { aggregateType: 'Session', projectId: C.projectId, sessionId: C.sessionId }, revision: cRevision,
      });
    } finally { await f.close(); }
  });

  it('HO03 a role-mismatched live idle predecessor is archived in one step with the transfer', async () => {
    const f = await createRoleMismatchHandoverFixture();
    try {
      const requeuesBefore = await f.observations.requeues(f.T);
      const created = await createSession(f, await select(f));
      const C = created.C;
      const step = created.next;
      // The handover decision reads P after the Session creation, so the
      // archive pin is P's revision at that point, not before the creation.
      const pNow = await f.observations.session(f.P);
      expect(step.operation).toMatchObject({ kind: 'archive_predecessor', successor: C, taskRef: f.T });
      if (step.operation.kind !== 'archive_predecessor') throw new Error('an archive_predecessor step was expected');
      expect(step.operation.request.input).toEqual({
        sessionRef: f.P,
        reason: `continuation handover: task ${f.T.taskId} continues in Session ${C.sessionId}`,
        tasks: [{ target: { kind: 'task', ref: f.T }, disposition: { kind: 'transfer', to: C } }],
        wait: null,
        mode: 'handoff_complete',
      });
      expect(step.operation.request.meta.expected).toEqual([
        { ref: pNow.record.ref, revision: pNow.record.revision },
      ]);
      expect(step.operation.request.meta.requestId).toMatch(/^wf-auto:/);

      const archived = advanced(await f.workflow.advanceWork(f.ctx, step));
      expect(archived.value.receipt).toMatchObject({
        kind: 'archive_predecessor', result: { status: 'ready', value: { state: 'archived' } },
      });
      expect(await f.observations.session(f.P)).toMatchObject({ record: { lifecycle: 'archived', archiveRequest: null } });
      const pLink = await f.observations.link(f.P);
      expect(pLink).not.toBeNull();
      if (pLink === null) throw new Error('P must have a closed responsible link on T');
      expect(typeof pLink.until).toBe('string');
      expect(await f.observations.openResponsible(f.P)).toBeNull();
      const cLink = await f.observations.link(C);
      expect(cLink).not.toBeNull();
      if (cLink === null) throw new Error('C must have a responsible link on T');
      expect(cLink.until).toBeNull();
      expect(await f.observations.openResponsible(C)).not.toBeNull();
      expect(await f.observations.anchors()).toEqual([]);
      expect(await f.observations.requeues(f.T)).toEqual(requeuesBefore);
      const claim = asPerform(archived.value.next);
      expect(claim.operation).toMatchObject({ kind: 'claim_task' });
      if (claim.operation.kind !== 'claim_task') throw new Error('a claim_task step was expected');
      const cRevision = (await f.observations.session(C)).record.revision;
      expect(claim.operation.request.input.sessionRef).toEqual(C);
      expect(claim.operation.request.meta.expected[2]).toEqual({
        ref: { aggregateType: 'Session', projectId: C.projectId, sessionId: C.sessionId }, revision: cRevision,
      });
    } finally { await f.close(); }
  });

  it('HO04 a live predecessor with another open task transfers only and stays active', async () => {
    const f = await createOtherResponsibilityFixture();
    try {
      expect(f.T2).not.toBeNull();
      const T2 = f.T2!;
      const created = await createSession(f, await select(f));
      const C = created.C;
      const step = created.next;
      expect(step.operation).toMatchObject({ kind: 'transfer_responsibility', successor: C });
      if (step.operation.kind !== 'transfer_responsibility') throw new Error('a transfer_responsibility step was expected');
      const transferred = advanced(await f.workflow.advanceWork(f.ctx, step));
      expect(transferred.value.receipt).toMatchObject({
        kind: 'transfer_responsibility', result: { status: 'committed' },
      });
      const p = await f.observations.session(f.P);
      expect(p).toMatchObject({ record: { lifecycle: 'active' } });
      expect(p.record.archiveRequest ?? null).toBeNull();
      expect(await f.observations.openResponsible(f.P, { kind: 'task', ref: T2 })).not.toBeNull();
      const pLink = await f.observations.link(f.P, f.target);
      expect(pLink).not.toBeNull();
      if (pLink === null) throw new Error('P must have a closed responsible link on T');
      expect(typeof pLink.until).toBe('string');
      expect(asPerform(transferred.value.next).operation).toMatchObject({ kind: 'claim_task' });
    } finally { await f.close(); }
  });

  it('HO05 an occupied live predecessor transfers only and keeps everything except the closed link', async () => {
    const f = await createOccupiedPredecessorFixture();
    try {
      const created = await createSession(f, await select(f));
      const C = created.C;
      const step = created.next;
      expect(step.operation).toMatchObject({ kind: 'transfer_responsibility', successor: C });
      if (step.operation.kind !== 'transfer_responsibility') throw new Error('a transfer_responsibility step was expected');
      const pBefore = await f.observations.session(f.P);
      // B3: everything except the T responsibility link stays byte-identical.
      const otherLinks = (links: SessionWorkLink[]): SessionWorkLink[] => [...links]
        .filter(link => !(link.ref.relation === 'responsible' && link.ref.target.kind === 'task'
          && link.ref.target.ref.projectId === f.T.projectId && link.ref.target.ref.taskId === f.T.taskId))
        .sort((a, b) => JSON.stringify(a.ref).localeCompare(JSON.stringify(b.ref)));
      const otherLinksBefore = otherLinks(pBefore.links);
      const transferred = advanced(await f.workflow.advanceWork(f.ctx, step));
      expect(transferred.value.receipt).toMatchObject({
        kind: 'transfer_responsibility', result: { status: 'committed' },
      });
      const pAfter = await f.observations.session(f.P);
      expect({ ...pAfter.record, revision: pBefore.record.revision }).toEqual(pBefore.record);
      expect(pAfter.record.revision).toBe(pBefore.record.revision + 1);
      expect(otherLinks(pAfter.links)).toEqual(otherLinksBefore);
      const pLink = await f.observations.link(f.P, f.target);
      expect(pLink).not.toBeNull();
      if (pLink === null) throw new Error('P must have a closed responsible link on T');
      expect(typeof pLink.until).toBe('string');
      expect(asPerform(transferred.value.next).operation).toMatchObject({ kind: 'claim_task' });
    } finally { await f.close(); }
  });

  it('HO06 without performing the create_session next, re-selection still returns the transfer', async () => {
    const f = await createInterruptedHandoverFixture();
    try {
      const created = await createSession(f, await select(f));
      const C = created.C;
      expect(created.next.operation).toMatchObject({ kind: 'transfer_responsibility', successor: C, taskRef: f.T });
      // Crash simulation: the returned next is deliberately not performed.
      const reselected = advanced(await f.workflow.advanceWork(f.ctx, f.selectInput));
      const step = asPerform(reselected.value.next);
      expect(step.operation).toMatchObject({ kind: 'transfer_responsibility', successor: C, taskRef: f.T });
      if (step.operation.kind !== 'transfer_responsibility') throw new Error('a transfer_responsibility step was expected');
      expect(step.operation.request.meta.expected).toEqual(await f.observations.transferPins(f.P, C));
    } finally { await f.close(); }
  });

  it('HO07 without performing the create_session next, re-selection still returns archive_predecessor', async () => {
    const f = await createRoleMismatchHandoverFixture();
    try {
      const created = await createSession(f, await select(f));
      const C = created.C;
      expect(created.next.operation).toMatchObject({ kind: 'archive_predecessor', successor: C, taskRef: f.T });
      const reselected = advanced(await f.workflow.advanceWork(f.ctx, f.selectInput));
      const step = asPerform(reselected.value.next);
      expect(step.operation).toMatchObject({ kind: 'archive_predecessor', successor: C, taskRef: f.T });
      if (step.operation.kind !== 'archive_predecessor') throw new Error('an archive_predecessor step was expected');
      expect(step.operation.request.input).toEqual({
        sessionRef: f.P,
        reason: `continuation handover: task ${f.T.taskId} continues in Session ${C.sessionId}`,
        tasks: [{ target: { kind: 'task', ref: f.T }, disposition: { kind: 'transfer', to: C } }],
        wait: null,
        mode: 'handoff_complete',
      });
      const pNow = await f.observations.session(f.P);
      expect(step.operation.request.meta.expected).toEqual([
        { ref: pNow.record.ref, revision: pNow.record.revision },
      ]);
      const archived = advanced(await f.workflow.advanceWork(f.ctx, step));
      expect(archived.value.receipt).toMatchObject({
        kind: 'archive_predecessor', result: { status: 'ready', value: { state: 'archived' } },
      });
      expect(await f.observations.session(f.P)).toMatchObject({ record: { lifecycle: 'archived' } });
    } finally { await f.close(); }
  });

  it('HO08 a concurrent C write makes the stale transfer conflict, then re-selection pins the new version', async () => {
    const f = await createInterruptedHandoverFixture();
    try {
      const created = await createSession(f, await select(f));
      const C = created.C;
      const step = created.next;
      expect(step.operation).toMatchObject({ kind: 'transfer_responsibility', successor: C });
      if (step.operation.kind !== 'transfer_responsibility') throw new Error('a transfer_responsibility step was expected');

      await bumpSessionRevision(f, C);
      const totalsBefore = f.observations.totals();
      const conflicted = advanced(await f.workflow.advanceWork(f.ctx, step));
      expect(conflicted.value.receipt).toMatchObject({
        kind: 'transfer_responsibility', result: { status: 'rejected', code: 'revision_conflict' },
      });
      expect(conflicted.value.next).toMatchObject({ kind: 'select_work' });
      // The refused step's owner wrote nothing.
      expect(f.observations.totals()).toEqual(totalsBefore);

      const selectAgain = conflicted.value.next;
      if (selectAgain === null) throw new Error('a select_work continuation was expected');
      const again = advanced(await f.workflow.advanceWork(f.ctx, selectAgain));
      const retry = asPerform(again.value.next);
      expect(retry.operation).toMatchObject({ kind: 'transfer_responsibility', successor: C, taskRef: f.T });
      if (retry.operation.kind !== 'transfer_responsibility') throw new Error('a transfer_responsibility step was expected');
      expect(retry.operation.request.meta.expected).toEqual(await f.observations.transferPins(f.P, C));
    } finally { await f.close(); }
  });

  it('HO09 an archived predecessor creates an ordinary Session with no provenance and no handover step', async () => {
    const f = await createArchivedPredecessorFixture();
    try {
      const first = await select(f);
      expect(first.operation).toMatchObject({ kind: 'create_session', taskRef: f.T });
      expect(first.operation.request).not.toHaveProperty('provenance');
      const created = await createSession(f, first);
      expect(created.next.operation).toMatchObject({ kind: 'claim_task' });
    } finally { await f.close(); }
  });

  it('HO10 a narrow Workflow without the responsibilities seam keeps the original claim_task', async () => {
    const f = await createInterruptedHandoverFixture({ responsibilities: false });
    try {
      expect(f.composition.deps.responsibilities).toBeUndefined();
      const created = await createSession(f, await select(f));
      expect(created.next.operation).toMatchObject({ kind: 'claim_task' });
    } finally { await f.close(); }
  });

  it('HO11 a reusable non-continuation afterRun Session claims directly with no handover step', async () => {
    const f = await createReusablePredecessorFixture();
    try {
      const step = await select(f);
      expect(step.operation).toMatchObject({ kind: 'claim_task' });
      if (step.operation.kind !== 'claim_task') throw new Error('a claim_task step was expected');
      expect(step.operation.request.input.sessionRef).toEqual(f.P);
    } finally { await f.close(); }
  });

  it('HO12 resending the identical transfer replays the receipt, keeps the next and skips maintenance', async () => {
    const f = await createInterruptedHandoverFixture();
    try {
      const created = await createSession(f, await select(f));
      const step = created.next;
      expect(step.operation).toMatchObject({ kind: 'transfer_responsibility' });
      if (step.operation.kind !== 'transfer_responsibility') throw new Error('a transfer_responsibility step was expected');

      // B4: a maintenance page is observable through its workspace listing, a
      // real-port findSessions call with neither a role nor a target filter.
      // The spy calls through, so it only observes.
      const spy = vi.spyOn(f.composition.deps.sessions, 'findSessions');
      try {
        const maintenanceListings = () => spy.mock.calls
          .filter(([, input]) => input.role === undefined && input.target === undefined).length;

        const firstRun = advanced(await f.workflow.advanceWork(f.ctx, step));
        expect(firstRun.value.receipt).toMatchObject({
          kind: 'transfer_responsibility', result: { status: 'committed', replayed: false },
        });
        if (firstRun.value.receipt?.kind !== 'transfer_responsibility'
          || firstRun.value.receipt.result.status !== 'committed') {
          throw new Error('a committed transfer receipt was expected');
        }
        const cursor = firstRun.value.receipt.result.cursor;
        const next = firstRun.value.next;
        const totalsAfterFirst = f.observations.totals();
        const requestsAfterFirst = f.observations.archiveRequests(f.P).length;
        // Control: the ordinary transfer's advancement ran its maintenance page.
        expect(maintenanceListings()).toBeGreaterThan(0);

        const listingsBeforeReplay = maintenanceListings();
        const secondRun = advanced(await f.workflow.advanceWork(f.ctx, step));
        expect(secondRun.value.receipt).toMatchObject({
          kind: 'transfer_responsibility', result: { status: 'committed', replayed: true, cursor },
        });
        expect(secondRun.value.next).toEqual(next);
        // The replayed step runs no maintenance page and writes nothing.
        expect(maintenanceListings() - listingsBeforeReplay).toBe(0);
        expect(f.observations.totals()).toEqual(totalsAfterFirst);
        expect(f.observations.archiveRequests(f.P)).toHaveLength(requestsAfterFirst);
      } finally {
        spy.mockRestore();
      }
    } finally { await f.close(); }
  });

  it('HO13 an injected final-archive conflict leaves the transfer done, partial receipt, and maintenance finishes it', async () => {
    const f = await createRoleMismatchHandoverFixture({ failFinalArchive: true });
    try {
      const created = await createSession(f, await select(f));
      const C = created.C;
      const step = created.next;
      expect(step.operation).toMatchObject({ kind: 'archive_predecessor', successor: C, taskRef: f.T });
      if (step.operation.kind !== 'archive_predecessor') throw new Error('an archive_predecessor step was expected');
      const archived = advanced(await f.workflow.advanceWork(f.ctx, step));
      expect(f.composition.finalArchiveConflicts()).toBe(1);
      expect(archived.value.receipt).toMatchObject({
        kind: 'archive_predecessor', result: { status: 'ready', value: { state: 'partial' } },
      });
      if (archived.value.receipt?.kind !== 'archive_predecessor'
        || archived.value.receipt.result.status !== 'ready') {
        throw new Error('a readable archive_predecessor receipt was expected');
      }
      // The partial receipt's Session snapshot still carries the registered archive request.
      const partialRequest = archived.value.receipt.result.value.session.archiveRequest;
      if (partialRequest == null) throw new Error('the partial receipt must carry its archive request');
      expect(partialRequest).toMatchObject({ mode: 'handoff_complete' });
      expect(await f.observations.openResponsible(f.P)).toBeNull();
      expect(await f.observations.openResponsible(C)).not.toBeNull();
      expect(asPerform(archived.value.next).operation).toMatchObject({ kind: 'claim_task' });

      // B5: exactly one responsibility transfer was written for this advance.
      // P's T link closes at the cursor of its single SessionResponsibilityChanged
      // event; the maintenance replay does not write a second one.
      const pLink = await f.observations.link(f.P);
      expect(pLink).not.toBeNull();
      if (pLink === null) throw new Error('P must have a closed responsible link on T');
      expect(typeof pLink.until).toBe('string');
      const closingEvents = f.observations.events().flatMap(({ cursor, event }) => {
        if (event.eventType !== SESSION_RESPONSIBILITY_CHANGED_EVENT) return [];
        const decoded = sessionResponsibilityChangedEventFromEvent(event);
        if (decoded.status !== 'decoded') throw new Error(decoded.reason);
        const closed = decoded.value.closed;
        if (closed.ref.relation !== 'responsible') return [];
        if (closed.ref.projectId !== f.P.projectId || closed.ref.sessionId !== f.P.sessionId) return [];
        if (closed.ref.target.kind !== 'task') return [];
        if (closed.ref.target.ref.projectId !== f.T.projectId
          || closed.ref.target.ref.taskId !== f.T.taskId) return [];
        return [cursor];
      });
      expect(closingEvents).toHaveLength(1);
      expect(closingEvents[0]).toBe(pLink.until);
      // The same advancement's maintenance page continued and finished the archive.
      expect(await f.observations.session(f.P)).toMatchObject({ record: { lifecycle: 'archived' } });
      expect(await f.observations.anchors()).toEqual([]);
    } finally { await f.close(); }
  });
});

describe('wiring 1 retired-line maintenance handover', () => {
  it('HM01 a handed-over retired line archives with mode handoff_complete and its exact request id', async () => {
    const f = await createHandedOverRetiredFixture();
    try {
      const before = await f.observations.session(f.P);
      const cBefore = await f.observations.session(f.C);
      const requeuesBefore = await f.observations.requeues(f.T);
      const result = await f.workflow.maintainSessions(f.ctx, f.maintenanceInput);
      expect(result).toMatchObject({ status: 'ready', value: { archived: [f.P], pending: [], failures: [] } });
      const requests = f.observations.archiveRequests(f.P);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        mode: 'handoff_complete',
        requestId: `s1-maintenance-archive:${f.P.projectId}:${f.P.sessionId}:handoff_complete:${before.record.revision}`,
      });
      expect(await f.observations.session(f.P)).toMatchObject({ record: { lifecycle: 'archived' } });
      expect(await f.observations.anchors()).toEqual([]);
      expect(await f.observations.session(f.C)).toEqual(cBefore);
      expect(await f.observations.requeues(f.T)).toEqual(requeuesBefore);
    } finally { await f.close(); }
  });

  it('HM02 a retired line still responsible for an unfinished task makes no commit', async () => {
    const f = await createStillResponsibleRetiredFixture();
    try {
      const pBefore = await f.observations.session(f.P);
      const totalsBefore = f.observations.totals();
      const result = await f.workflow.maintainSessions(f.ctx, f.maintenanceInput);
      expect(result).toMatchObject({ status: 'ready', value: { archived: [], pending: [], failures: [] } });
      expect(f.observations.totals()).toEqual(totalsBefore);
      expect(await f.observations.session(f.P)).toEqual(pBefore);
    } finally { await f.close(); }
  });

  it('HM03 a retired line occupied by an unknown-outcome Run stays busy with zero commits', async () => {
    const f = await createUnknownOccupiedRetiredFixture();
    try {
      const totalsBefore = f.observations.totals();
      const result = await f.workflow.maintainSessions(f.ctx, f.maintenanceInput);
      expect(result).toMatchObject({
        status: 'ready',
        value: { failures: [{ sessionRef: f.P, rejection: { status: 'rejected', code: 'busy' } }] },
      });
      if (result.status !== 'ready') throw new Error('maintenance did not return a readable result');
      expect(result.value.failures).toHaveLength(1);
      expect(result.value.failures[0]!.rejection.reason.startsWith('archive_unknown_confirmation_required:')).toBe(true);
      expect(f.observations.totals()).toEqual(totalsBefore);
    } finally { await f.close(); }
  });

  it('HM04 a retired line whose only open responsibility is a module still archives as handoff_complete', async () => {
    const f = await createModuleOnlyRetiredFixture();
    try {
      const before = await f.observations.session(f.P);
      const result = await f.workflow.maintainSessions(f.ctx, f.maintenanceInput);
      expect(result).toMatchObject({ status: 'ready', value: { archived: [f.P] } });
      const requests = f.observations.archiveRequests(f.P);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        mode: 'handoff_complete',
        requestId: `s1-maintenance-archive:${f.P.projectId}:${f.P.sessionId}:handoff_complete:${before.record.revision}`,
      });
      expect(await f.observations.session(f.P)).toMatchObject({ record: { lifecycle: 'archived' } });
      expect(await f.observations.anchors()).toEqual([]);
    } finally { await f.close(); }
  });
});
