/**
 * The CoreOperation record's three arms through its one hand-written codec (pure, A5): the `handoff` and
 * `secretary_archive` field tables behind the `action.kind` dispatch, the create arm's `parentOperation`, the shell's
 * own rules, the first problem, the round trip, and the two arm events with their registrations. Every value is
 * built here; the expected texts follow the field-table wording (`<name>.<path> is …`) and the rules' own reasons.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeSessionOperationRecord, encodeSessionCreationAdmittedEvent, encodeSessionOperationRecord, SESSION_RECORD_SCHEMAS,
  secretaryArchiveRecordedCodec, sessionHandoffRecordedCodec,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';

const P = 's6b-p';
const W = 's6b-w';
const at = '2026-10-25T01:00:00.000Z';
const op = (operationId: string) => ({ aggregateType: 'CoreOperation', projectId: P, operationId });
const session = (sessionId: string, projectId = P) => ({ projectId, sessionId });
const task = (taskId: string, projectId = P) => ({ projectId, goalId: 'g1', taskId });
const root = (queryJobId: string) => ({ aggregateType: 'QueryJob', projectId: P, workspaceId: W, queryJobId });
const transfer = (taskId: string) => ({ task: task(taskId), input: null, receipt: null });
const shell = { revision: 1, workspaceId: W, phase: 'accepted', requestedAt: at, updatedAt: at, observation: null, failure: null };

const handoff = { ...shell, ref: op('h1'), action: { kind: 'handoff',
  input: { workspace: { projectId: P, workspaceId: W }, source: session('s1'), trigger: 'manual',
    actor: { kind: 'human', id: 'operator' }, commandId: 'c1', fingerprint: 'a'.repeat(64),
    assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: [task('a'), task('b')] },
      { target: { kind: 'existing', session: session('s2') }, tasks: [] }] },
  progress: { stage: 'accepted', advanceGeneration: 1, fence: null, stoppedWriter: null,
    assignments: [{ successor: null, createOperation: null, transfers: [transfer('a'), transfer('b')] },
      { successor: null, createOperation: null, transfers: [] }],
    coverage: null, understanding: [], brief: null, routing: null, archiveRequest: null, noticeItemKey: null,
    lastRefusal: null } } };
const item = (queryJobId: string) => ({ requestRoot: root(queryJobId), input: null, outcome: null, routingRound: null,
  reason: null, cursor: null });
const archive = { ...shell, ref: op('a1'), action: { kind: 'secretary_archive',
  input: { source: session('s1'), choices: [{ requestRoot: root('r1'), to: session('s2') }, { requestRoot: root('r2'), to: null }],
    commandId: 'c2', fingerprint: 'b'.repeat(64) },
  progress: { stage: 'accepted', advanceGeneration: 1, items: [item('r1'), item('r2')], archiveRequest: null, lastRefusal: null } } };
const create = { ...shell, ref: op('c1'), action: { kind: 'create', plannedSessionRef: session('s3'), parentOperation: op('h1'),
  workspace: { projectId: P, workspaceId: W }, kernelStore: { adapterId: 'k', storeKey: 'ks' },
  role: { kind: 'legacy_template', templateId: 't', templateRevision: '1' }, recommendedRefs: [], initialLinks: [],
  provenance: { schemaVersion: 1, kind: 'handoff', from: session('s1') }, creation: null } };

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const edit = (record: object, change: (body: Body) => void): Body => {
  const body = structuredClone(record) as Body;
  change(body);
  return body;
};
const stored = (body: object) => encodeSessionOperationRecord(body as never);
const registration = SESSION_RECORD_SCHEMAS.records.find(entry => entry.aggregateType === 'CoreOperation')!;
const eventRegistration = (eventType: string) => SESSION_RECORD_SCHEMAS.events.find(entry => entry.eventType === eventType)!;

describe('S6B CoreOperation arms: the codec round trip', () => {
  it.each([['create', create], ['handoff', handoff], ['secretary_archive', archive]])('stores and reads back a %s arm', (_kind, body) => {
    expect(registration.validate(stored(body))).toEqual({ status: 'decoded', value: stored(body) });
    expect(decodeSessionOperationRecord(stored(body))).toEqual({ status: 'decoded', value: body });
  });
});

describe('rejects: a damaged CoreOperation record, first problem first', () => {
  it.each<[string, Body, string]>([
    ['an unknown action kind', edit(handoff, b => { b.action.kind = 'retire'; }), 'action.kind is not recognized'],
    ['no top-level workspace', edit(handoff, b => { delete b.workspaceId; }), 'operation workspaceId must be a non-empty string'],
    ['an unknown stage', edit(handoff, b => { b.action.progress.stage = 'fenced'; }), 'HandoffAction.progress.stage is not recognized'],
    ['two problems: the input one first', edit(handoff, b => { b.action.progress.stage = 'fenced'; b.action.input.trigger = 'auto'; }),
      'HandoffAction.input.trigger is not recognized'],
    ['no assignment', edit(handoff, b => { b.action.input.assignments = []; b.action.progress.assignments = []; }),
      'HandoffAction.input.assignments is invalid'],
    ['a task in two assignments', edit(handoff, b => { b.action.input.assignments[1].tasks = [task('a')];
      b.action.progress.assignments[1].transfers = [transfer('a')]; }), 'HandoffAction.input.assignments[1].tasks[0] repeats a task of the handoff'],
    ['the source as an existing target', edit(handoff, b => { b.action.input.assignments[1].target.session = session('s1'); }),
      'HandoffAction.input.assignments[1].target is the source Session'],
    ['an existing target of another project', edit(handoff, b => { b.action.input.assignments[1].target.session = session('s2', 'q'); }),
      'HandoffAction.input.assignments[1].target belongs to another project'],
    ['a progress assignment missing', edit(handoff, b => { b.action.progress.assignments.pop(); }),
      'HandoffAction.progress.assignments does not match input.assignments'],
    ['transfers out of task order', edit(handoff, b => { b.action.progress.assignments[0].transfers.reverse(); }),
      "HandoffAction.progress.assignments[0].transfers does not match the assignment's tasks"],
    ['a transfer missing', edit(handoff, b => { b.action.progress.assignments[0].transfers.pop(); }),
      "HandoffAction.progress.assignments[0].transfers does not match the assignment's tasks"],
    ['a receipt before its input', edit(handoff, b => { b.action.progress.assignments[0].transfers[1].receipt = { cursor: 'c0000000007' }; }),
      'HandoffAction.progress.assignments[0].transfers[1].receipt has no saved input'],
    ['a routing receipt before its input', edit(handoff, b => { b.action.progress.routing = { closed: false, horizon: null,
      roots: [{ requestRoot: root('r1'), input: null, receipt: { routingRound: root('r2'), cursor: 'c0000000007' }, skipped: null }] }; }),
      'HandoffAction.progress.routing.roots[0].receipt has no saved input'],
    ['another workspace on top', edit(handoff, b => { b.workspaceId = 'other'; }), 'operation workspaceId disagrees with the action workspace'],
    ['a ref of another project', edit(handoff, b => { b.action.input.assignments[0].tasks[1] = task('b', 'q');
      b.action.progress.assignments[0].transfers[1].task = task('b', 'q'); }),
      'operation action.input.assignments[0].tasks[1] belongs to another project'],
    ['an observation on a handoff', edit(handoff, b => { b.observation = { observedAt: at, adapterId: 'k',
      kernelSessionId: 'x', beforeCursor: null, afterCursor: null, resultRef: null }; }),
      'operation observation must be null on a handoff action'],
    ['an unknown target kind', edit(handoff, b => { b.action.input.assignments[0].target.kind = 'retire'; }),
      'HandoffAction.input.assignments[0].target.kind is not recognized'],
    ['no archive choice', edit(archive, b => { b.action.input.choices = []; b.action.progress.items = []; }),
      'SecretaryArchiveAction.input.choices is invalid'],
    ['a repeated request root', edit(archive, b => { b.action.input.choices[1].requestRoot = root('r1');
      b.action.progress.items[1].requestRoot = root('r1'); }), 'SecretaryArchiveAction.input.choices[1].requestRoot repeats a request'],
    ['a choice routed to the source', edit(archive, b => { b.action.input.choices[0].to = session('s1'); }),
      'SecretaryArchiveAction.input.choices[0].to is the source Session'],
    ['items in another order', edit(archive, b => { b.action.progress.items.reverse(); }),
      'SecretaryArchiveAction.progress.items does not match input.choices'],
    ['an item missing', edit(archive, b => { b.action.progress.items.pop(); }),
      'SecretaryArchiveAction.progress.items does not match input.choices'],
    ['an outcome before its input', edit(archive, b => { b.action.progress.items[0].outcome = 'dropped'; }),
      'SecretaryArchiveAction.progress.items[0].outcome has no saved input'],
    ['a create arm without its parent', edit(create, b => { delete b.action.parentOperation; }),
      'operation parentOperation must be null or a CoreOperation ref'],
  ])('%s', (_case, body, problem) => {
    expect(registration.validate(stored(body))).toEqual({ status: 'invalid', reason: `CoreOperation record payload is invalid: ${problem}` });
  });

  it('refuses a SessionCreationAdmitted event that carries a non-create arm', () => {
    const event = encodeSessionCreationAdmittedEvent({ eventId: 'e0', eventType: 'SessionCreationAdmitted', schemaVersion: 1,
      occurredAt: at, projectId: P, workspaceId: W, operationRef: op('h1') as never, operation: handoff as never });
    expect(eventRegistration('SessionCreationAdmitted').validate(event)).toEqual({ status: 'invalid',
      reason: 'SessionCreationAdmitted event payload is invalid: admitted operation must be a create action' });
  });
});

describe('S6B the two arm events', () => {
  const header = { schemaVersion: 1, occurredAt: at, projectId: P, workspaceId: W, revision: 1, phase: 'accepted' } as const;
  it.each([
    ['SessionHandoffRecorded', sessionHandoffRecordedCodec, { ...header, eventId: 'e1', eventType: 'SessionHandoffRecorded',
      operationRef: handoff.ref, action: handoff.action }],
    ['SecretaryArchiveRecorded', secretaryArchiveRecordedCodec, { ...header, eventId: 'e2', eventType: 'SecretaryArchiveRecorded',
      operationRef: archive.ref, action: archive.action }],
  ] as const)('registers %s and round-trips it', (eventType, codec, event) => {
    const encoded = (codec.encode as (value: unknown) => ReturnType<typeof codec.encode>)(event);
    expect(eventRegistration(eventType).validate(encoded)).toEqual({ status: 'decoded', value: encoded });
    expect(codec.decode(encoded)).toEqual({ status: 'decoded', value: event });
  });

  it('refuses an event whose arm breaks its own rule', () => {
    const action = edit(handoff, b => { b.action.input.assignments[1].target.session = session('s1'); }).action;
    expect(sessionHandoffRecordedCodec.check({ ...header, eventId: 'e3', eventType: 'SessionHandoffRecorded',
      operationRef: handoff.ref, action })).toBe('HandoffAction.input.assignments[1].target is the source Session');
  });
});
