/**
 * 7D1 G1-1's three pure rows: the five link targets, the SessionWorkLink pin arm and the six R1 formats.
 *
 * The target and pin rows read the frozen tables' hand-computed refusal texts. The format row encodes a lawful value
 * through its codec and decodes it back, or feeds a stored damaged value (a null cursor / a missing field) to the
 * decoder; the `invalid` marker in a row's name is the expectation, never the codec's own output.
 */
import { describe, expect, it } from 'vitest';
import { aggregateRefProblem } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { encodeEventEnvelope } from '../../src/core/work-graph/persistence/event-envelope.js';
import {
  projectNoticeCodec, projectNoticeCreatedCodec, projectRoleLimitsChangedCodec, projectRoleLimitsCodec,
  roleLineAllocationCodec, sessionRoleFactsCodec,
} from '../../src/core/work-graph/sessions/role-line-record-codecs.js';
import { checkWorkLinkRef } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { encodedRecord } from '../helpers/record-envelope.js';
import {
  FORMAT_ROUND_TRIPS, PIN_SCHEMA_CASES, TARGET_SET_CASES,
} from '../helpers/S7D1-pure-tables.js';

const CODECS = {
  SessionRoleFacts: sessionRoleFactsCodec,
  RoleLineAllocation: roleLineAllocationCodec,
  ProjectRoleLimits: projectRoleLimitsCodec,
  ProjectNotice: projectNoticeCodec,
  ProjectRoleLimitsChanged: projectRoleLimitsChangedCodec,
  ProjectNoticeCreated: projectNoticeCreatedCodec,
} as const;

describe('G1-target-set: checkWorkLinkRef over the five target kinds and its refusals', () => {
  it.each(TARGET_SET_CASES)('$name', ({ value, problem }) => {
    expect(checkWorkLinkRef(value)).toBe(problem);
  });
});

describe('G1-pin-schema: aggregateRefProblem over the SessionWorkLink pin arm', () => {
  it.each(PIN_SCHEMA_CASES)('$name', ({ value, problem }) => {
    expect(aggregateRefProblem(value)).toBe(problem);
    expect(checkWorkLinkRef(value)).toBe(problem);
  });
});

describe('G1-formats: the six R1 formats round-trip or refuse a damaged stored value', () => {
  it.each(FORMAT_ROUND_TRIPS)('$name', (c) => {
    const codec = CODECS[c.format];
    if (c.name.includes('invalid')) {
      const stored = 'lookups' in codec
        ? encodedRecord(codec.registration.schemaId, c.value as Record<string, unknown>)
        : encodeEventEnvelope(c.value as { eventId: string; eventType: string; schemaVersion: number; occurredAt: string });
      expect(codec.decode(stored as never).status).toBe('invalid');
      return;
    }
    const encoded = codec.encode(c.value as never);
    const decoded = codec.decode(encoded as never);
    expect(decoded.status).toBe('decoded');
    if (decoded.status === 'decoded') expect(decoded.value).toEqual(c.value);
  });
});
