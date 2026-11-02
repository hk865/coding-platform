/**
 * PL-40: an idle adviser line receives N's `overlap-note:` convention request.
 *
 * Proven here on the real F4 Host: the second same-module Task opens the gate,
 * the gate sends one Host system `action_request` whose body is the note
 * request, the Host's consume loop offers it to the idle adviser line, the
 * adviser's planning Query freezes the text shape and its tool table carries
 * `record_note` (no submit/mail/member tools), the real scripted model writes
 * the new current module convention, the gate rechecks satisfied and the
 * second Task claims its Run. The system request is an `action_request`, not a
 * `notify` that opens no turn.
 *
 * No hand-made ctx and no direct handler. The separate secretary-request-round
 * control runs the unchanged `resolveSecretaryQueryRun` through the real note owner.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { compareCursors } from '../../src/contracts/ledger.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { heartbeatUntil, readBody, sessionQueries } from '../helpers/IV-host-fixture.js';
import {
  currentVersions, gatesOf, notesOnModule, openPLOverlapWorld, select, type PLOverlapWorld,
} from '../helpers/PL-forms-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ensureProjectPointers, openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { holdS6BRequestRound, createS6BLine } from '../helpers/S6B1-fixture.js';
import { S7C1_CREATE_ROLE } from '../helpers/S7C-member-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { captureQueryContexts } from '../helpers/query-context-capture.js';

const MODULE = 's6a-core';
const ADVISER_CONCLUSION = 'the module interface agreed through the overlap request';
const SECRETARY_CONCLUSION = 'the secretary request round writes the module convention';

let opened: PLOverlapWorld | undefined;
afterEach(async () => { await opened?.close(); opened = undefined; });

describe('PL-40: the idle adviser receives the overlap-note request', () => {
  it('offers the Host system action_request to the adviser, writes the note and starts the second Task', async () => {
    opened = await openPLOverlapWorld({ firstRun: 'held' });
    const target = opened;
    // B is the second same-module Task; A (m1) is already running and held.
    await createS6BLine(target.world.main, {
      label: 'pl-overlap-b', role: S7C1_CREATE_ROLE, tasks: [target.world.tasks[1]!],
    });
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(target.world.world.ag2b, select(target, 'pl-overlap-b-dispatch', target.world.tasks[1]!.taskId),
      { receipts });
    // `overlap.open` records and sends the one note request; the retry step is only for a null noteRequest.
    const gateReceipt = receipts.find(receipt => receipt.kind === 'open_overlap_gate');
    expect(gateReceipt).toMatchObject({ kind: 'open_overlap_gate', result: { status: 'opened', noteRequest: 'sent' } });
    if (gateReceipt === undefined || gateReceipt.kind !== 'open_overlap_gate'
      || gateReceipt.result.status !== 'opened') throw new Error('PL-40: the B gate did not open');
    const gate = gateReceipt.result.gate;
    const startCursor = gate.running[0]?.startCursor;
    if (startCursor === null || startCursor === undefined) throw new Error('PL-40: A has no start cursor');

    // No note is newer than the conflicting Run: the gate is not satisfied yet.
    const before = await target.world.world.platform.overlapGates.checkOverlapGate(
      target.world.world.systemContext(), { gate: gate.ref });
    expect(before).toEqual({ status: 'ready', value: { status: 'not_satisfied' } });
    expect(await notesOnModule(target)).toHaveLength(0);

    // The real consume loop offers the one action_request to the idle adviser line.
    const inbox = await listed(target.world.world, 'inbox', target.adviser);
    const request = inbox.find(message => message.intent === 'action_request' && message.sender.kind === 'host');
    expect(request).toBeDefined();
    if (request === undefined) return;
    expect(request.intent, 'the system request is an action_request, not a notify').toBe('action_request');
    expect(request.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'workflow:auto-rework' } });
    expect(await readBody(target.world.world, request.ref, 'message'))
      .toBe('模块被占用，请为这个模块写一条接口注记：s6a-core');

    // The adviser's real text round writes the module convention through the scripted model.
    await target.script(target.adviser, [
      { kind: 'calls', calls: [{ callId: 'pl40-note', name: 'record_note', args: {
        op: 'write', kind: 'convention', topic: 'pl40-interface', conclusion: ADVISER_CONCLUSION,
        anchor: { kind: 'module', moduleId: MODULE }, extraAnchors: [], facts: [], basisFiles: [],
        replaces: [], contradicts: [], coexistWith: [], structural: false, body: 'PL-40 interface note',
      } }] },
      { kind: 'text', text: 'PL-40 interface note written' },
    ]);
    const queries: QueryRunSnapshot[] = await heartbeatUntil(target.world.world,
      () => sessionQueries(target.world.world, target.adviser), seen => seen.length > 0, 16);
    expect(queries, 'the Host offers no host-system action_request to the adviser, so the '
      + 'adviser has no planning Query and cannot write the overlap note. Stop point: '
      + 'src/core/work-graph/views/consumable-sessions.ts:81 offerKindOf has no host/system action_request '
      + 'branch and src/business/workflow/intervention.ts:44 handleIntervention has no overlap-note text route. '
      + 'Missing owner: P2.').toHaveLength(1);
    const runRef = queries[0]!.ref;

    // The frozen round is a text round: manifest answerShape null (the `text` default), no request.
    const jobRead = async () => (await target.world.world.post('queries/read', plain(S6A_SCOPE, {
      aggregateType: 'QueryJob', projectId: runRef.projectId, workspaceId: runRef.workspaceId,
      queryJobId: runRef.queryJobId,
    }))).body as { status: string; value?: QueryJobRecord };
    const jobBody = await heartbeatUntil(target.world.world, jobRead,
      read => read.status === 'ready' && read.value?.job.job.status === 'answered', 16);
    expect(jobBody.status).toBe('ready');
    if (jobBody.status !== 'ready' || jobBody.value === undefined) throw new Error('PL-40: no Query job');
    const execution = jobBody.value.job.job.intent.execution;
    expect(execution).toMatchObject({ kind: 'intervention_planning' });
    const answerShape = 'answerShape' in execution ? execution.answerShape : undefined;
    expect(['plan_round', 'plan_review']).not.toContain(answerShape);
    const prepared = jobBody.value.run.run.executionState?.prepared;
    expect(prepared).not.toBeNull();
    if (prepared === null || prepared === undefined) throw new Error('PL-40: the Query has no frozen manifest');
    const manifestBody = (await target.world.world.post('materials/open', plain(S6A_SCOPE, {
      ref: prepared.bundleRef, usage: 'historical_explanation',
    }))).body as { status: string; value?: { body: string } };
    expect(manifestBody.status).toBe('ready');
    if (manifestBody.status !== 'ready' || manifestBody.value === undefined) {
      throw new Error('PL-40: the frozen manifest is not readable');
    }
    const manifest = JSON.parse(manifestBody.value.body) as PreparedQueryManifestV1;
    expect(manifest.answerShape).toBeNull();
    expect(manifest.request).toBeNull();

    // The tool table is the planning text table: record_note, no submit/mail/member tools.
    const turns = await target.world.world.scripted.requests(target.adviser);
    const tools = turns[0]?.tools.map(tool => tool.name) ?? [];
    expect(tools).toContain('record_note');
    expect(tools).not.toContain('submit_plan_round');
    expect(tools).not.toContain('submit_plan_review');
    expect(tools).not.toContain('send_session_message');
    expect(tools).not.toContain('respond_session_message');
    expect(tools).not.toContain('create_member');

    // The note owner dispatched by the frozen shape, the Host-system source and the adviser duty.
    const notes = await notesOnModule(target);
    const written = notes.find(item => item.conclusion === ADVISER_CONCLUSION);
    expect(written, 'the adviser Query is a text round with record_note, but the note owner '
      + 'cannot resolve it because the composition root passes `secretaryQueryRun` while '
      + 'NoteServiceDependencies.queryRun is required. Stop point: create-platform.ts:2419 / note-service.ts:98. '
      + 'Missing owner: L.').toBeDefined();
    if (written === undefined) throw new Error('PL-40: the adviser note is not listed');
    expect(written).toMatchObject({ kind: 'convention', anchor: { kind: 'module', moduleId: MODULE },
      storedState: 'accepted', currentEligible: true,
      source: { kind: 'agent', duty: 'adviser', queryRunRef: runRef } });
    const currents = await currentVersions(target);
    const current = currents.find(version => version.noteId === written.noteId);
    expect(current).toBeDefined();
    if (current === undefined) throw new Error('PL-40: the new note has no current version');
    expect(compareCursors(current.since as CommitCursor, startCursor)).toBe(1);

    // Recheck satisfied by the note; the second Task then claims and starts its own Run.
    const after = await target.world.world.platform.overlapGates.checkOverlapGate(
      target.world.world.systemContext(), { gate: gate.ref });
    expect(after).toEqual({ status: 'ready', value: { status: 'satisfied', by: 'note' } });
    const runReceipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(target.world.world.ag2b,
      select(target, 'pl-overlap-b-start', target.world.tasks[1]!.taskId),
      { stopBefore: 'open_checks', receipts: runReceipts });
    const claim = runReceipts.find(receipt => receipt.kind === 'claim_task');
    expect(claim).toMatchObject({ kind: 'claim_task', result: { status: 'committed' } });
    // The claim alone does not prove B started: read the claimed Run and require its start cursor.
    if (claim === undefined || claim.kind !== 'claim_task' || claim.result.status !== 'committed') {
      throw new Error('PL-40: B was not claimed');
    }
    const startedB = await readExecution(target.world.world.ag2b, claim.result.value.runRef);
    expect(startedB.run.startedSince).not.toBeNull();

    const finalGates = await gatesOf(target);
    const finalGate = finalGates.find(candidate => candidate.ref.taskId === target.world.tasks[1]!.taskId);
    expect(finalGate?.release).toBeNull();
  });

  it('control: the secretary request round still writes the same kind of note', async () => {
    // The F4 fixture's secretary binding has no graph tool, so the unchanged secretary resolver is exercised on a
    // real S6A Host whose secretary selects `look_graph`; the note owner itself still dispatches the round.
    const controlWorld = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'look_graph'] });
    const capture = captureQueryContexts();
    try {
      await ensureProjectPointers(controlWorld);
      const result = await holdS6BRequestRound(controlWorld, {
        label: 'pl40-secretary', goalId: controlWorld.goals.first.goalId,
      }, async held => {
        return {
          round: held,
          write: await controlWorld.platform.notes.writeNote(capture.latest(), {
            commandId: 'pl40-secretary-note', expectedPointerRevision: null, goalId: null,
            note: { kind: 'convention', topic: 'pl40-secretary-control', conclusion: SECRETARY_CONCLUSION,
              anchor: { kind: 'module', moduleId: MODULE }, extraAnchors: [], facts: [], basisFiles: [],
              structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'PL-40 secretary note' },
          }),
        };
      }).catch((error: unknown) => {
        throw new Error('the secretary request round cannot write its note because the '
          + 'composition root passes `secretaryQueryRun` while the note owner reads '
          + 'NoteServiceDependencies.queryRun. Stop point: src/composition/create-platform.ts:2419 '
          + '(the note owner requires it at src/core/work-graph/notes/note-service.ts:98). '
          + 'Missing owner: L (the queryRun composition-root wiring; book-pl-frozen.md:624). Cause: '
          + String(error));
      });
      expect(result.value.round.manifest.answerShape).toBe('secretary');
      expect(result.value.round.manifest.request).not.toBeNull();
      expect(result.value.write.status).toBe('accepted');
      if (result.value.write.status !== 'accepted') throw new Error('PL-40: the secretary note was refused');
      const listed = (await controlWorld.post('notes/list', plain(S6A_SCOPE, {
        anchor: { kind: 'module', moduleId: MODULE }, limit: 100, cursor: null,
      }))).body as { status: string; value?: { items: NoteItemV1[] } };
      expect(listed.status).toBe('ready');
      const control = listed.value?.items.find(item => item.conclusion === SECRETARY_CONCLUSION);
      expect(control).toBeDefined();
      if (control === undefined) throw new Error('PL-40: the secretary note is not listed');
      expect(control).toMatchObject({ kind: 'convention', anchor: { kind: 'module', moduleId: MODULE },
        storedState: 'accepted', currentEligible: true,
        source: { kind: 'agent', duty: 'secretary', queryRunRef: result.value.round.query.run.ref } });
    } finally {
      capture.restore();
      await controlWorld.close();
    }
  });
});
