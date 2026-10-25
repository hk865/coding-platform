/**
 * The Session activity record (`src/contracts/session-activity.ts`) and the
 * rule that builds it (`state/session-activity.ts`): the shape and its two
 * rules through the one value check, and `nextSessionActivity` called with
 * hand-built facts. A5: pure input → output, every expected value a literal.
 */
import { describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionActivityRef, SessionActivityV1 } from '../../src/contracts/session-activity.js';
import { SessionActivityFormat } from '../../src/contracts/session-activity.js';
import { checkShape } from '../../src/contracts/validation/data-format.js';
import { nextSessionActivity } from '../../src/core/work-graph/state/session-activity.js';
import {
  SESSION_ACTIVITY_SCHEMAS, activityGuardOf, sessionActivityCodec, sessionActivityRefOf,
} from '../../src/core/work-graph/sessions/session-activity.js';

const PROJECT = 'p-activity';
const WORKSPACE = 'w-activity';
const SESSION_ID = 'sess-activity';
const SESSION: SessionRef = { projectId: PROJECT, sessionId: SESSION_ID };
const REF: SessionActivityRef = { aggregateType: 'SessionActivity', projectId: PROJECT, sessionId: SESSION_ID };
const CREATED_AT = '2026-10-25T00:00:00.000Z';

const jobSource = (queryJobId: string): SessionActivityV1['source'] =>
  ({ aggregateType: 'QueryJob', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId });
const runSource = (runId: string): SessionActivityV1['source'] =>
  ({ aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'qj-1', runId });
const messageSource = (messageId: string): SessionActivityV1['source'] =>
  ({ aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId });

/** An activity candidate as a caller could hand it to the check; `over` replaces declared fields. */
function activityCandidate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: REF, revision: 1, session: SESSION, lastActivityAt: '2026-10-25T03:00:00.000Z',
    kind: 'input', source: jobSource('qj-1'), ...over,
  };
}

/** A record already stored, as `nextSessionActivity` receives it. */
function stored(over: Partial<SessionActivityV1> = {}): SessionActivityV1 {
  return {
    ref: REF, revision: 1, session: SESSION, lastActivityAt: '2026-10-25T03:00:00.000Z',
    kind: 'input', source: jobSource('qj-1'), ...over,
  };
}

// ------------------------------------------------------------------------ //
// Shape, fields, tagged ref and revision (stored phase)                    //
// ------------------------------------------------------------------------ //
describe('SessionActivity shape, fields, tagged ref and revision', () => {
  it('declares exactly the six fields', () => {
    expect(Object.keys(SessionActivityFormat.fields))
      .toEqual(['ref', 'revision', 'session', 'lastActivityAt', 'kind', 'source']);
  });

  it.each([
    ['admits a complete stored record', activityCandidate(), null],
    ['refuses a record without kind', Object.fromEntries(Object.entries(activityCandidate()).filter(([key]) => key !== 'kind')),
      'SessionActivity.kind is missing'],
    ['refuses revision 0', activityCandidate({ revision: 0 }), 'SessionActivity.revision is invalid'],
    ['admits a round_ended record whose source is its QueryRun',
      activityCandidate({ kind: 'round_ended', source: runSource('run-1') }), null],
    ['admits a stored revision of 1', activityCandidate({ revision: 1 }), null],
    ['refuses a plain project/session pair as the ref', activityCandidate({ ref: { projectId: PROJECT, sessionId: SESSION_ID } }),
      'SessionActivity.ref.aggregateType is missing'],
  ] as const)('%s', (_name, value, reason) => {
    expect(checkShape(SessionActivityFormat, value, 'stored')).toBe(reason);
  });
});

// ------------------------------------------------------------------------ //
// Rules                                                                    //
// ------------------------------------------------------------------------ //
describe('SessionActivity rules', () => {
  it.each([
    ['a session from another project', { session: { projectId: 'p-other', sessionId: SESSION_ID } },
      'SessionActivity.session is not the Session its ref names'],
    ['a session naming another session id', { session: { projectId: PROJECT, sessionId: 'sess-other' } },
      'SessionActivity.session is not the Session its ref names'],
    ['a source from another project',
      { source: { aggregateType: 'QueryJob', projectId: 'p-other', workspaceId: WORKSPACE, queryJobId: 'qj-1' } },
      'SessionActivity.source belongs to another project'],
  ] as const)('refuses %s', (_name, over, reason) => {
    expect(checkShape(SessionActivityFormat, activityCandidate(over), 'stored')).toBe(reason);
  });
});

// ------------------------------------------------------------------------ //
// Every kind × source cell of the table                                    //
// ------------------------------------------------------------------------ //
describe('kind × source: the cells of the union', () => {
  it.each([
    ['admits input from a QueryJob', 'input', jobSource('qj-1'), null],
    ['admits input from a SessionMessage', 'input', messageSource('msg-1'), null],
    ['admits round_ended from a QueryRun', 'round_ended', runSource('run-1'), null],
    ['refuses input from a QueryRun', 'input', runSource('run-1'), 'SessionActivity.source QueryRun is not a source of input'],
    ['refuses round_ended from a QueryJob', 'round_ended', jobSource('qj-1'),
      'SessionActivity.source QueryJob is not a source of round_ended'],
    ['refuses round_ended from a SessionMessage', 'round_ended', messageSource('msg-1'),
      'SessionActivity.source SessionMessage is not a source of round_ended'],
  ] as const)('%s', (_name, kind, source, reason) => {
    expect(checkShape(SessionActivityFormat, activityCandidate({ kind, source }), 'stored')).toBe(reason);
  });
});

describe('kind × source: sources outside the union', () => {
  it.each([
    ['Goal', 'SessionActivity.source.aggregateType is not recognized'],
    ['PlanProposal', 'SessionActivity.source.aggregateType is not recognized'],
    ['NoteHead', 'SessionActivity.source.aggregateType is not recognized'],
    ['Run', 'SessionActivity.source.aggregateType is not recognized'],
    ['CoreOperation', 'SessionActivity.source.aggregateType is not recognized'],
  ] as const)('refuses input with a %s source', (aggregateType, reason) => {
    expect(checkShape(SessionActivityFormat,
      activityCandidate({ kind: 'input', source: { aggregateType, projectId: PROJECT } }), 'stored')).toBe(reason);
  });
});

// ------------------------------------------------------------------------ //
// nextSessionActivity: one advance (no record yet; an earlier or equal at) //
// ------------------------------------------------------------------------ //
describe('nextSessionActivity: one advance', () => {
  const later = stored({
    revision: 4, lastActivityAt: '2026-10-25T05:00:00.000Z', kind: 'round_ended', source: runSource('run-9'),
  });

  // [name, current, at, kind, source, then the expected revision, lastActivityAt, kind, source]
  it.each([
    ['no record yet: starts at revision 1 at the activity instant', null, '2026-10-25T01:00:00.000Z', 'input',
      jobSource('qj-1'), 1, '2026-10-25T01:00:00.000Z', 'input', jobSource('qj-1')],
    ['no record yet: keeps the creation time when the activity is older, at revision 1', null, '2026-10-24T23:00:00.000Z',
      'round_ended', runSource('run-1'), 1, CREATED_AT, 'round_ended', runSource('run-1')],
    ['an earlier instant: keeps the later record kind, source and instant', later, '2026-10-25T04:00:00.000Z', 'input',
      jobSource('qj-7'), 5, '2026-10-25T05:00:00.000Z', 'round_ended', runSource('run-9')],
    ['an earlier instant: takes the new fact at an equal instant', later, '2026-10-25T05:00:00.000Z', 'input',
      jobSource('qj-7'), 5, '2026-10-25T05:00:00.000Z', 'input', jobSource('qj-7')],
  ] as const)('%s', (_name, current, at, kind, source, revision, lastActivityAt, nextKind, nextSource) => {
    expect(nextSessionActivity({ current, ref: REF, session: SESSION, sessionCreatedAt: CREATED_AT, at, kind, source }))
      .toEqual({ ref: REF, revision, session: SESSION, lastActivityAt, kind: nextKind, source: nextSource });
  });
});

// ------------------------------------------------------------------------ //
// nextSessionActivity: two advances                                        //
// ------------------------------------------------------------------------ //
describe('nextSessionActivity: same-millisecond advances', () => {
  const at = '2026-10-25T01:00:00.000Z';
  const base = { ref: REF, session: SESSION, sessionCreatedAt: CREATED_AT, at };

  it('advances the revision and keeps the last-activity instant', () => {
    const first = nextSessionActivity({
      ...base, current: null, kind: 'input', source: jobSource('qj-1'),
    });
    const second = nextSessionActivity({
      ...base, current: first, kind: 'input', source: jobSource('qj-2'),
    });
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(second.lastActivityAt).toBe(at);
    expect(second.kind).toBe('input');
    expect(second.source).toEqual(jobSource('qj-2'));
  });
});

// ------------------------------------------------------------------------ //
// Codec: ref, encode and decode                                            //
// ------------------------------------------------------------------------ //
describe('sessionActivityRefOf', () => {
  it('names the full tagged SessionActivity ref', () => {
    expect(sessionActivityRefOf(SESSION)).toEqual({
      aggregateType: 'SessionActivity', projectId: 'p-activity', sessionId: 'sess-activity',
    });
  });
});

describe('sessionActivityCodec: encode', () => {
  it('keys the record by its full tagged ref and keeps the body', () => {
    const encoded = sessionActivityCodec.encode(stored());
    expect(encoded.refKey).toBe('{"aggregateType":"SessionActivity","projectId":"p-activity","sessionId":"sess-activity"}');
    expect(encoded.schemaId).toBe('SessionActivity@1');
    expect(encoded.revision).toBe(1);
    expect(JSON.parse(encoded.json)).toEqual({
      ref: { aggregateType: 'SessionActivity', projectId: 'p-activity', sessionId: 'sess-activity' },
      revision: 1,
      session: { projectId: 'p-activity', sessionId: 'sess-activity' },
      lastActivityAt: '2026-10-25T03:00:00.000Z',
      kind: 'input',
      source: { aggregateType: 'QueryJob', projectId: 'p-activity', workspaceId: 'w-activity', queryJobId: 'qj-1' },
    });
  });
});

describe('sessionActivityCodec: decode', () => {
  it('round-trips an encoded record', () => {
    expect(sessionActivityCodec.decode(sessionActivityCodec.encode(stored()))).toEqual({
      status: 'decoded',
      value: {
        ref: { aggregateType: 'SessionActivity', projectId: 'p-activity', sessionId: 'sess-activity' },
        revision: 1,
        session: { projectId: 'p-activity', sessionId: 'sess-activity' },
        lastActivityAt: '2026-10-25T03:00:00.000Z',
        kind: 'input',
        source: { aggregateType: 'QueryJob', projectId: 'p-activity', workspaceId: 'w-activity', queryJobId: 'qj-1' },
      },
    });
  });

  it('refuses a stored body whose ref is the plain project/session pair', () => {
    const body = { ...stored(), ref: { projectId: 'p-activity', sessionId: 'sess-activity' } };
    const encoded = sessionActivityCodec.encode(stored());
    const decoded = sessionActivityCodec.decode({ ...encoded, json: JSON.stringify(body) });
    expect(decoded).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/ref/) });
    expect(sessionActivityCodec.check(body, 'stored')).toBe('SessionActivity.ref.aggregateType is missing');
  });
});

describe('SESSION_ACTIVITY_SCHEMAS', () => {
  it('registers exactly the one record schema and no events', () => {
    expect(SESSION_ACTIVITY_SCHEMAS.records).toHaveLength(1);
    expect(SESSION_ACTIVITY_SCHEMAS.records[0]).toMatchObject({
      schemaId: 'SessionActivity@1', aggregateType: 'SessionActivity',
    });
    expect(SESSION_ACTIVITY_SCHEMAS.events).toEqual([]);
    expect(SESSION_ACTIVITY_SCHEMAS.records[0]!.validate(sessionActivityCodec.encode(stored())).status).toBe('decoded');
  });
});

// ------------------------------------------------------------------------ //
// Guard: revision 0 is the absent default                                  //
// ------------------------------------------------------------------------ //
describe('activityGuardOf', () => {
  it.each([
    ['spells revision 0 as the store CAS absent revision', 0, null],
    ['keeps a stored revision', 3, 3],
  ] as const)('%s', (_name, revision, expectedRevision) => {
    expect(activityGuardOf({ ref: REF, revision })).toEqual({
      refKey: '{"aggregateType":"SessionActivity","projectId":"p-activity","sessionId":"sess-activity"}',
      expectedRevision,
    });
  });
});
