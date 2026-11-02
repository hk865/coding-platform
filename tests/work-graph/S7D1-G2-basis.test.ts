/**
 * 7D1 G2-basis: `SessionResponsibilityChanged`'s one `basis` field over the four target arms.
 *
 * The 15 values are frozen in `S7D1-pure-tables.ts` (04c); this file only executes them. Each case encodes through
 * the event codec and decodes through the replay codec: the four arms must round-trip unchanged. The task arm also
 * compares the whole encoded and decoded payload literal, so its field names and values stay as frozen.
 */
import { describe, expect, it } from 'vitest';
import {
  encodeSessionResponsibilityChangedEvent, SESSION_RESPONSIBILITY_CHANGED_EVENT,
  sessionResponsibilityChangedEventFromEvent, type SessionResponsibilityChangedEventV1,
} from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import type { ResponsibilityBasisV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { sessionRecord } from '../helpers/S2C-line-facts-samples.js';
import { BASIS_CASES } from '../helpers/S7D1-pure-tables.js';

const AT = '2026-11-01T00:00:00.000Z';
const PROJECT = 'p1';
const WORKSPACE = 'w1';
const SOURCE = sessionRecord({
  ref: { aggregateType: 'Session', projectId: PROJECT, sessionId: 's1' }, workspaceId: WORKSPACE,
  health: 'unavailable', healthConclusion: 'missing',
});
const CLOSED = {
  ref: { aggregateType: 'SessionWorkLink', projectId: PROJECT, sessionId: 's1', relation: 'responsible',
    target: { kind: 'project', ref: { projectId: PROJECT } } },
  revision: 1, since: null, until: null,
} as const;

function changed(basis: ResponsibilityBasisV1): SessionResponsibilityChangedEventV1 {
  return {
    eventId: 'event-1', eventType: SESSION_RESPONSIBILITY_CHANGED_EVENT, schemaVersion: 1, occurredAt: AT,
    projectId: PROJECT, workspaceId: WORKSPACE, mode: 'drop', source: SOURCE, destination: null,
    closed: CLOSED, opened: null, openedBound: null, archiveStep: null, basis,
  };
}

describe('G2-basis: the responsibility basis of the four target arms', () => {
  it.each(BASIS_CASES)('$name', ({ basis }) => {
    const event = changed(basis);
    const encoded = encodeSessionResponsibilityChangedEvent(event);
    expect(JSON.parse(encoded.json).basis).toEqual(basis);
    const decoded = sessionResponsibilityChangedEventFromEvent(encoded);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value.basis).toEqual(basis);
    if (basis.kind === 'task') {
      expect(JSON.parse(encoded.json)).toEqual(event);
      expect(decoded.value).toEqual(event);
    }
  });
});
