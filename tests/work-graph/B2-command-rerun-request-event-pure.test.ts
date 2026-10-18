/**
 * B2-08/B2-09 / L19a / rework 9 F-024: the `CommandRerunRequestChanged@1`
 * event codec as a PURE input->output function.
 *
 * The service rows keep only public state assertions; this file owns the
 * event-shape obligation that used to be read back from the event store. The
 * event and its whole post-change request are built here; the proof, the
 * `usedBy` pair and the refusal sentences are hand-written literals.
 */
import { describe, expect, it } from 'vitest';
import {
  commandRerunRequestChangedEventFromEvent, encodeCommandRerunRequestChangedEvent,
  type CommandRerunRequestChangedEventV1,
} from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { DecisionChangeProofV1 } from '../../src/contracts/goal-decisions.js';

const projectId = 'P';
const workspaceId = 'W';
const goalId = 'g1';
const taskId = 't1';
const at = '2026-10-20T00:00:00.000Z';
const requestRef = {
  aggregateType: 'CommandRerunRequest' as const, projectId, goalId, taskId, requestId: 'crr-1',
};
const reviewRef = { aggregateType: 'UnknownCallReview' as const, projectId, goalId, runId: 'run-review-1' };
const runRef = { aggregateType: 'Run' as const, projectId, goalId, runId: 'run-crr-1' };

const pending: CommandRerunRequestV1 = {
  ref: requestRef, schemaVersion: 1, revision: 1, workspaceId,
  task: { projectId, goalId, taskId }, reviewRef, runRef,
  alias: 1, command: 'npm run migrate', commandSha256: 'a'.repeat(64),
  declared: false, declaredForms: [],
  match: { kind: 'exact', action: { text: 'npm run migrate', sha256: 'b'.repeat(64) } },
  reason: 'the migration must really run',
  state: 'pending', answerMessageRef: null, allowedAt: null, usedAt: null, usedBy: null,
  createdAt: at, updatedAt: at,
};

const answerRef = {
  aggregateType: 'SessionMessage' as const, projectId, workspaceId, messageId: 'm-answer-1',
};

function answered(state: 'allowed' | 'denied' | 'denied_final'): CommandRerunRequestV1 {
  return {
    ...pending, revision: 2, state, answerMessageRef: answerRef,
    allowedAt: state === 'allowed' ? at : null, updatedAt: at,
  };
}

const used: CommandRerunRequestV1 = {
  ...answered('allowed'), revision: 3, state: 'used',
  usedAt: at, usedBy: { runId: 'run-crr-1', callId: 'call-7' },
};

const proof: DecisionChangeProofV1 = {
  acknowledgementRef: answerRef,
  capturedPins: [{ ref: requestRef, revision: 1 }],
  changes: [],
  basisRebases: [],
};

function eventOf(
  change: 'allowed' | 'denied' | 'denied_final' | 'used',
  request: CommandRerunRequestV1,
  proofOrNone?: DecisionChangeProofV1,
): CommandRerunRequestChangedEventV1 {
  return {
    eventId: `e-${change}-${String(request.revision)}`,
    eventType: 'CommandRerunRequestChanged', schemaVersion: 1, occurredAt: at,
    identityKey: `identity-${change}`, fingerprint: 'c'.repeat(64),
    actor: { kind: 'human', id: 'operator' }, requestId: requestRef.requestId,
    change, request,
    ...(proofOrNone === undefined ? {} : { proof: proofOrNone }),
  };
}

describe('B2-08/F-024 pure: the changed event keeps proof and usedBy', () => {
  it.each(['allowed', 'denied', 'denied_final'] as const)(
    'B2-08: %s carries the formal proof through encode and decode', (change) => {
      const event = eventOf(change, answered(change), proof);
      const encoded = encodeCommandRerunRequestChangedEvent(event);
      expect(encoded).toEqual({
        eventId: `e-${change}-2`, eventType: 'CommandRerunRequestChanged', schemaVersion: 1,
        occurredAt: at, json: JSON.stringify(event),
      });
      const decoded = commandRerunRequestChangedEventFromEvent(encoded);
      expect(decoded.status).toBe('decoded');
      if (decoded.status !== 'decoded') throw new Error(JSON.stringify(decoded));
      expect(decoded.value.change).toBe(change);
      expect(decoded.value.request.state).toBe(change);
      expect(decoded.value.proof).toEqual({
        acknowledgementRef: {
          aggregateType: 'SessionMessage', projectId, workspaceId, messageId: 'm-answer-1',
        },
        capturedPins: [{ ref: requestRef, revision: 1 }],
        changes: [],
        basisRebases: [],
      });
    },
  );

  it('B2-09: a used event keeps the usedBy pair and carries no proof', () => {
    const event = eventOf('used', used);
    const decoded = commandRerunRequestChangedEventFromEvent(encodeCommandRerunRequestChangedEvent(event));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') throw new Error(JSON.stringify(decoded));
    expect(decoded.value.change).toBe('used');
    expect(decoded.value.request.state).toBe('used');
    expect(decoded.value.request.usedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(decoded.value.request.usedBy).toEqual({ runId: 'run-crr-1', callId: 'call-7' });
    expect(decoded.value.proof).toBeUndefined();
  });
});

describe('rejects: the changed event proof rule', () => {
  it('B2-08/F-024: a used event carrying a proof is refused', () => {
    const encoded = encodeCommandRerunRequestChangedEvent(eventOf('used', used, proof));
    expect(commandRerunRequestChangedEventFromEvent(encoded)).toEqual({
      status: 'invalid',
      reason: 'CommandRerunRequestChanged carries a proof only for allowed/denied/denied_final',
    });
  });

  it('B2-08/F-024: a card application without its proof is refused', () => {
    const encoded = encodeCommandRerunRequestChangedEvent(eventOf('allowed', answered('allowed')));
    expect(commandRerunRequestChangedEventFromEvent(encoded)).toEqual({
      status: 'invalid',
      reason: 'CommandRerunRequestChanged carries a proof only for allowed/denied/denied_final',
    });
  });
});
