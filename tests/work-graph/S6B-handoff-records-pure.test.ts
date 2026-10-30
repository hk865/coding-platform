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
import { archiveSavedInputProblem, handoffReachedInputProblem, upgradeSessionOperationActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
import { consumeHandoffBrief } from '../../src/core/work-graph/state/session-handoff.js';
import {
  advanceWriteKeys, handoffContextOf, savedHostPrincipal,
} from '../../src/core/work-graph/sessions/session-handoff-service.js';

const P = 's6b-p';
const W = 's6b-w';
const at = '2026-10-25T01:00:00.000Z';
const op = (operationId: string) => ({ aggregateType: 'CoreOperation' as const, projectId: P, operationId });
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
    assignments: [{ successor: null, createOperation: null, createInput: null, transfers: [transfer('a'), transfer('b')] },
      { successor: null, createOperation: null, createInput: null, transfers: [] }],
    coverage: null, understanding: [], brief: null, routing: null, archiveRequest: null, noticeItemKey: null,
    lastRefusal: null } } };
const item = (queryJobId: string) => ({ requestRoot: root(queryJobId), input: null, outcome: null, routingRound: null,
  reason: null, cursor: null });
const archive = { ...shell, ref: op('a1'), action: { kind: 'secretary_archive',
  input: { source: session('s1'), choices: [{ requestRoot: root('r1'), to: session('s2') }, { requestRoot: root('r2'), to: null }],
    actor: null, commandId: 'c2', fingerprint: 'b'.repeat(64) },
  progress: { stage: 'accepted', advanceGeneration: 1, items: [item('r1'), item('r2')], archiveRequest: null, lastRefusal: null } } };
const create = { ...shell, ref: op('c1'), action: { kind: 'create', plannedSessionRef: session('s3'), parentOperation: op('h1'),
  workspace: { projectId: P, workspaceId: W }, kernelStore: { adapterId: 'k', storeKey: 'ks' },
  role: { kind: 'legacy_template', templateId: 't', templateRevision: '1' }, recommendedRefs: [], initialLinks: [],
  provenance: { schemaVersion: 1, kind: 'handoff', from: session('s1') }, creation: null, consultation: null } };

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


describe('S6B2 the one compatible read (upgradeSessionOperationActionV1)', () => {
  it('reads an old accepted handoff without createInput as null on every assignment', () => {
    const old = edit(handoff, b => { for (const assignment of b.action.progress.assignments) delete assignment.createInput; });
    expect(upgradeSessionOperationActionV1((old as Body).action)).toEqual(handoff.action);
  });
  it('leaves an old empty understanding and a null archiveRequest as they are', () => {
    const old = edit(handoff, b => { for (const assignment of b.action.progress.assignments) delete assignment.createInput; });
    const upgraded = upgradeSessionOperationActionV1((old as Body).action) as Body;
    expect(upgraded.progress.understanding).toEqual([]);
    expect(upgraded.progress.archiveRequest).toBeNull();
    expect(upgradeSessionOperationActionV1(structuredClone(handoff.action))).toEqual(handoff.action);
  });
  it('reads an old archive operation without actor as null', () => {
    const old = edit(archive, b => { delete b.action.input.actor; });
    expect(upgradeSessionOperationActionV1((old as Body).action)).toEqual(archive.action);
  });
  it('lets the upgraded old handoff record and event pass the field table', () => {
    const old = edit(handoff, b => { for (const assignment of b.action.progress.assignments) delete assignment.createInput; });
    const upgraded = upgradeSessionOperationActionV1((old as Body).action) as Body;
    const record = { ...handoff, action: upgraded };
    expect(registration.validate(stored(record))).toEqual({ status: 'decoded', value: stored(record) });
    expect(decodeSessionOperationRecord(stored(record))).toEqual({ status: 'decoded', value: record });
    // The schema id is checked before the body is parsed or upgraded: a bad envelope wins over a bad body.
    expect(decodeSessionOperationRecord({ ...stored(old), schemaId: 'Other@1', json: 'not json' }))
      .toEqual({ status: 'invalid', reason: 'expected schemaId CoreOperation@1, got Other@1' });
    const header = { schemaVersion: 1, occurredAt: at, projectId: P, workspaceId: W, revision: 1, phase: 'accepted' } as const;
    expect(sessionHandoffRecordedCodec.check({ ...header, eventId: 'e4', eventType: 'SessionHandoffRecorded',
      operationRef: handoff.ref, action: upgraded })).toBeNull();
  });

  it('lets the upgraded old archive record and event pass the field table', () => {
    const old = edit(archive, b => { delete b.action.input.actor; });
    const upgraded = upgradeSessionOperationActionV1((old as Body).action) as Body;
    const record = { ...archive, action: upgraded };
    expect(registration.validate(stored(record))).toEqual({ status: 'decoded', value: stored(record) });
    const header = { schemaVersion: 1, occurredAt: at, projectId: P, workspaceId: W, revision: 1, phase: 'accepted' } as const;
    expect(secretaryArchiveRecordedCodec.check({ ...header, eventId: 'e5', eventType: 'SecretaryArchiveRecorded',
      operationRef: archive.ref, action: upgraded })).toBeNull();
  });
  it('accepts the saved child inputs the advance stores', () => {
    const saved = edit(handoff, b => {
      b.action.progress.assignments[0].createInput = {
        commandId: 'h1:create:0', duty: 'secretary', scope: { kind: 'project' }, reason: 'handoff',
        provenance: { schemaVersion: 1, kind: 'handoff', from: session('s1') },
        roleConfiguration: { kind: 'legacy_template', templateId: 't', templateRevision: '1' },
        replaces: session('s1'), parentOperation: op('h1') };
      b.action.progress.understanding = [{ generation: 1, requestRoot: root('r1'), round: null, command: {
        kind: 'request_understanding', commandId: 'h1:understanding:1', operation: op('h1'), generation: 1,
        requestRoot: root('r1'), goals: [{ goalRef: { aggregateType: 'Goal', projectId: P, goalId: 'g1' },
          pointer: { aggregateType: 'CurrentPointer', projectId: P, anchorKey: 'a1' }, pointerRevision: 3 }],
        checkedRound: null, state: 'live' } }];
      b.action.progress.archiveRequest = { requestId: 'rq1', savedInput: {
        input: { sessionRef: session('s1'), reason: 'secretary_handoff', tasks: [], wait: null,
          confirmUnknownStopped: false, mode: 'secretary_handoff',
          condition: { kind: 'secretary_handoff', operation: op('h1') } },
        meta: { requestId: 'rq1', expected: [{ ref: { aggregateType: 'Session', projectId: P, sessionId: 's1' },
          revision: 11 }] } }, receipt: null };
    });
    expect(registration.validate(stored(saved))).toEqual({ status: 'decoded', value: stored(saved) });
  });
  it('upgrades an old archiveRequest without savedInput and an old understanding entry without command', () => {
    const old = edit(handoff, b => {
      b.action.progress.archiveRequest = { requestId: 'rq1', receipt: null };
      b.action.progress.understanding = [{ generation: 1, requestRoot: root('r1'), round: null }];
    });
    const upgraded = upgradeSessionOperationActionV1((old as Body).action) as Body;
    expect(upgraded.progress.archiveRequest).toEqual({ requestId: 'rq1', savedInput: null, receipt: null });
    expect(upgraded.progress.understanding).toEqual([{ generation: 1, requestRoot: root('r1'), round: null,
      command: null }]);
  });
});


describe('S6B2 AH-13: a reached step whose saved input reads null refuses recovery', () => {
  /** The problem of the one handoff with the named change applied; an `existing` assignment saves no create input. */
  const problem = (change: (body: Body) => void): string | null =>
    handoffReachedInputProblem(edit(handoff, change).action as never);
  const command = (round: unknown) => ({ generation: 1, requestRoot: root('r1'), round, command: null });
  const archiveProblem = (): string | null => {
    // The archive command saves the exact GraphWrite too: the same rule over the record codec's real JSON boundary.
    const decoded = decodeSessionOperationRecord(stored(edit(archive, b => {
      b.action.progress.archiveRequest = { requestId: 'rq1', receipt: null }; })));
    return decoded.status === 'decoded' && decoded.value.action.kind === 'secretary_archive'
      ? archiveSavedInputProblem('SecretaryArchiveAction', decoded.value.action.progress.archiveRequest) : null;
  };
  it.each<[string, () => string | null, string | null]>([
    ['a reached assignment', () => problem(body => { body['action'].progress.assignments[0]!.successor = session('s9'); }),
      'HandoffAction.progress.assignments[0] is reached but has no saved create input'],
    ['a reached existing assignment', () => problem(body => { body['action'].progress.assignments[1]!.successor = session('s2'); }),
      null],
    ['a reached understanding entry', () => problem(b => { b['action'].progress.understanding = [command(null)]; }),
      'HandoffAction.progress.understanding[0] has no saved command'],
    ['a reached handoff archive request', () => problem(b => {
      b['action'].progress.archiveRequest = { requestId: 'a1', savedInput: null, receipt: null }; }),
    'HandoffAction.progress.archiveRequest has no saved input'],
    ['a reached archive command', archiveProblem, 'SecretaryArchiveAction.progress.archiveRequest has no saved input'],
  ])('%s', (_name, problemOf, expected) => {
    expect(problemOf()).toBe(expected);
  });
});

describe('S6B2 the brief consumption transition', () => {
  const run = { aggregateType: 'QueryRun' as const, projectId: P, workspaceId: W, queryJobId: 'rq1', runId: 'run1' };
  const withBrief = edit(handoff, b => {
    b.revision = 23;
    b.action.progress.brief = { requests: [], goals: [], ready: true, consumedBy: null };
  });
  it('sets consumedBy, advances the revision and pins the revision it was read at', () => {
    const transition = consumeHandoffBrief(
      withBrief as unknown as Parameters<typeof consumeHandoffBrief>[0], run, at);
    expect(transition.record.action.progress.brief).toEqual({ requests: [], goals: [], ready: true, consumedBy: run });
    expect(transition.record.revision).toBe(24);
    expect(transition.record.updatedAt).toBe(at);
    expect(transition.guard).toEqual({
      refKey: '{"aggregateType":"CoreOperation","operationId":"h1","projectId":"s6b-p"}', expectedRevision: 23,
    });
  });
  it('refuses a brief that is absent, not ready or already consumed', () => {
    expect(() => consumeHandoffBrief({ ...withBrief, action: { ...withBrief.action,
      progress: { ...withBrief.action.progress, brief: null } } } as unknown as Parameters<typeof consumeHandoffBrief>[0], run, at))
      .toThrow('consumeHandoffBrief: the operation has no ready unconsumed brief');
  });
});


describe('S6B2 the one advance identity builder and the saved principal', () => {
  const principal = { kind: 'host' as const, actor: { kind: 'human' as const, id: 'u-1' } };
  const keys = (over: Partial<Parameters<typeof advanceWriteKeys>[0]> = {}) => advanceWriteKeys({
    principal, scope: { projectId: P, workspaceId: W }, kind: 'handoff.advance', operation: op('h1'),
    stage: 'fence', item: '-', phase: 'after', generation: 1, fingerprintInput: { kind: 'fence', basis: 'held' },
    ...over });
  it('builds the frozen commandId and the same pair for the same principal value', () => {
    expect(keys().commandId).toBe('h1:fence:-:after:1');
    expect(keys().keys).toEqual(keys().keys);
    expect(keys({ principal: { kind: 'host', actor: { kind: 'system', id: 'u-1' } } }).keys.identityKey)
      .not.toBe(keys().keys.identityKey);
    expect(keys({ fingerprintInput: { kind: 'fence', basis: 'released' } }).keys.identityKey).toBe(keys().keys.identityKey);
    expect(keys({ fingerprintInput: { kind: 'fence', basis: 'released' } }).keys.fingerprint)
      .not.toBe(keys().keys.fingerprint);
  });
  it('matches the frozen notice identity literal', () => {
    const notice = advanceWriteKeys({ principal, scope: { projectId: 'p1', workspaceId: 'w1' },
      kind: 'handoff.advance', operation: { aggregateType: 'CoreOperation', projectId: 'p1',
        operationId: 'session-handoff-a1b2c3d4' }, stage: 'notice', item: '-', phase: 'after', generation: 1,
      fingerprintInput: { kind: 'notice', basis: 'handoff:session-handoff-a1b2c3d4' } });
    expect(notice.commandId).toBe('session-handoff-a1b2c3d4:notice:-:after:1');
    expect(notice.keys.identityKey)
      .toBe('handoff.advance:203cc2bea591d0a01fe36b7c0c9679585810cd1e6fc6f743999d19ab3330a597');
    expect(notice.keys.fingerprint).toBe('713fcbf8a90bcac9b82389e88d38eafb7acb6537a408ece7d6be0401d34be7a8');
  });
  it('reads a saved actor as a Host principal only for a human or system actor', () => {
    expect(savedHostPrincipal({ kind: 'human', id: 'u-1' })).toEqual(principal);
    expect(savedHostPrincipal({ kind: 'system', id: 's-1' }))
      .toEqual({ kind: 'host', actor: { kind: 'system', id: 's-1' } });
    expect(savedHostPrincipal({ kind: 'agent', id: 'a-1', runRef: {} })).toBeNull();
    expect(savedHostPrincipal({ kind: 'human', id: '' })).toBeNull();
    expect(savedHostPrincipal(null)).toBeNull();
  });
  it('keeps the scope and signal and puts the saved principal in both slots', () => {
    const signal = new AbortController().signal;
    const ctx = handoffContextOf({ projectId: P, workspaceId: W, principal: { kind: 'host',
      actor: { kind: 'system', id: 'caller' } }, materialReader: { kind: 'host', projectId: P, workspaceId: W,
      actor: { kind: 'system', id: 'caller' } }, signal }, principal);
    expect(ctx.principal).toEqual(principal);
    expect(ctx.materialReader).toEqual({ kind: 'host', projectId: P, workspaceId: W, actor: { kind: 'human', id: 'u-1' } });
    expect(ctx.signal).toBe(signal);
  });
});
