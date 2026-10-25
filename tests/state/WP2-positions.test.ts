/**
 * Wiring package 2 §5.2 P01 (entry E5): the pure Session/message constructors
 * that mark the two undelivered-reply positions and the state-only binding
 * functions the RecordStore's mechanical commit tail calls. No RecordStore, no
 * Kernel: this is the one entry where the constructors' records are inspected
 * directly (spec §5.3 rule 2).
 *
 * Expected values are the literals of spec §2.3 (the P01 row).
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { RoleConfigurationRef, SessionAggregateRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { RunRef, SourceRefV1 } from '../../src/contracts/dispatch.js';
import type { UserMessageResponseV1 } from '../../src/contracts/core/session-message.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import {
  bindSessionUnavailableCursor, observeSessionHealthRecord, releaseSessionRecord,
} from '../../src/core/work-graph/state/session-availability.js';
import {
  bindMessageResponseCursor, createSessionMessageRecord, nextSessionMessageRecord,
  type MessageQueryAnswerSenderRecord, type MessageResponseRecord, type MessageWorkRunSenderRecord,
} from '../../src/core/work-graph/state/message-machine.js';

const PROJECT = 'p-pos';
const WORKSPACE = 'w-pos';
const REVISION = 9;
const GENERATION = 7;
const SESSION_REF: SessionAggregateRef = { aggregateType: 'Session', projectId: PROJECT, sessionId: 's-1' };
const R1 = makeCommitCursor(1);
const R2 = makeCommitCursor(2);
const R3 = makeCommitCursor(3);
const P1 = makeCommitCursor(4);
const P2 = makeCommitCursor(5);
const P3 = makeCommitCursor(6);
const RUN_A: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: 'g-1', runId: 'run-a' };
const ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'tpl-1', templateRevision: 'r1' };
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '3' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'sha256:body', sizeBytes: 4, source: SOURCE };
const REPLY_BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'sha256:reply', sizeBytes: 5, source: SOURCE };
const MESSAGE_REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm-1' };
const RECIPIENT = { projectId: PROJECT, sessionId: 's-recipient' };
const SENDER_SESSION = { projectId: PROJECT, sessionId: 's-sender' };
const WORK_RUN_SENDER: MessageWorkRunSenderRecord = {
  kind: 'work_run', sessionRef: SENDER_SESSION,
  runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'g-1', runId: 'run-sender' },
  roleBinding: { schemaVersion: 1, bindingId: 'b-1', templateId: 'tpl-1', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'p-1' },
  generation: 2,
};
const HOST_SENDER = { kind: 'host', actor: { kind: 'human', id: 'operator' } } as const;

function sessionRecordOf(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: SESSION_REF, revision: REVISION, kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-1' },
    lifecycle: 'active', health: 'available', role: ROLE, workspaceId: WORKSPACE, lastExecutionRef: null,
    occupancy: null, historyCursor: 'cursor-old', createdAt: '2026-10-01T00:00:00.000Z', archivedAt: null,
    provenance: { schemaVersion: 1, kind: 'new' },
    ...overrides,
  };
}

function heldRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return sessionRecordOf({
    lastExecutionRef: RUN_A,
    occupancy: { kind: 'execution', executionRef: RUN_A, generation: GENERATION },
    ...overrides,
  });
}

function messageInput(overrides: Partial<Parameters<typeof createSessionMessageRecord>[0]> = {}) {
  return {
    ref: MESSAGE_REF, sender: WORK_RUN_SENDER, recipient: RECIPIENT, bodyRef: BODY, sourceRef: SOURCE,
    createdAt: '2026-10-01T00:00:00.000Z', intent: null, needsReply: true, waitAfterSend: false,
    ...overrides,
  };
}

function textReply(respondedAt: string, sender: MessageWorkRunSenderRecord = WORK_RUN_SENDER): MessageResponseRecord {
  return { sender, bodyRef: REPLY_BODY, sourceRef: SOURCE, respondedAt };
}

const ANSWER_SENDER: MessageQueryAnswerSenderRecord = {
  kind: 'query_run', sessionRef: SENDER_SESSION,
  queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'qj-1', runId: 'qr-1' },
  answerRef: { aggregateType: 'QueryJobAnswer', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'qj-1', answerId: 'a-1' },
  generation: 2,
};

/** The original work_run message's response slot filled by a derived Query Answer. */
function queryAnswer(respondedAt: string): MessageResponseRecord {
  return { sender: ANSWER_SENDER, bodyRef: REPLY_BODY, sourceRef: SOURCE, respondedAt };
}

const DECISION_SOURCE: DecisionSourceV1 = {
  kind: 'message', key: 'decision:card-1',
  subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g-1' } }, pins: [],
};

/** The user's answer to a decision card (spec §2.3: a Host-sent response). */
function userAnswer(respondedAt: string): UserMessageResponseV1 {
  return {
    sender: HOST_SENDER,
    bodyRef: REPLY_BODY, sourceRef: SOURCE, respondedAt,
    decision: { selection: { kind: 'option', optionId: 'continue' }, source: DECISION_SOURCE,
      annotations: [], requiresApplication: false },
  };
}

describe('WP2 positions', () => {
  it('P01 an available Session entering unavailable marks the pending entry position', () => {
    const held = heldRecord();
    const released = releaseSessionRecord(held, {
      holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: true,
    });
    expect(released).toEqual({ ...held, revision: REVISION + 1, occupancy: null, lastExecutionRef: RUN_A,
      historyCursor: 'cursor-old', health: 'unavailable', healthConclusion: 'kernel_turn_open', unavailableSince: null });

    const available = sessionRecordOf();
    expect(observeSessionHealthRecord(available, { health: 'unavailable', conclusion: 'missing' }))
      .toEqual({ ...available, revision: REVISION + 1, health: 'unavailable', healthConclusion: 'missing',
        unavailableSince: null });
  });

  it('P01 an already-unavailable Session keeps its bound entry position on a later release', () => {
    const held = heldRecord({ health: 'unavailable', healthConclusion: 'missing', unavailableSince: R1 });
    const released = releaseSessionRecord(held, {
      holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: true,
    });
    expect(released.unavailableSince).toBe(R1);
    expect(released.healthConclusion).toBe('kernel_turn_open');
  });

  it('P01 SES-13 recovery removes the entry position and a later re-entry marks a new pending one', () => {
    const unavailable = sessionRecordOf({ health: 'unavailable', healthConclusion: 'missing', unavailableSince: R1 });
    const recovered = observeSessionHealthRecord(unavailable, { health: 'available', conclusion: null });
    expect('unavailableSince' in recovered).toBe(false);
    expect(recovered).toEqual({ ...sessionRecordOf(), revision: REVISION + 1, health: 'available', healthConclusion: null });

    const reentered = observeSessionHealthRecord(recovered, { health: 'unavailable', conclusion: 'damaged' });
    expect(reentered).toEqual({ ...recovered, revision: REVISION + 2, health: 'unavailable', healthConclusion: 'damaged',
      unavailableSince: null });
  });

  it('P01 the first work_run reply marks a pending response position for a text reply and a Query Answer', () => {
    const sent = createSessionMessageRecord(messageInput());
    const text = nextSessionMessageRecord(sent, { kind: 'responded', response: textReply('T-text') });
    expect(text.responseSince).toBeNull();

    // A derived Query Answer fills the original work_run message's response slot
    // and marks the same reply position (spec §2.3, "覆盖 Work/Query Answer").
    const answer = nextSessionMessageRecord(sent, { kind: 'responded', response: queryAnswer('T-answer') });
    expect(answer.responseSince).toBeNull();

    const hostSent = createSessionMessageRecord(messageInput({ sender: HOST_SENDER, needsReply: false }));
    const hostResponded = nextSessionMessageRecord(hostSent, { kind: 'responded', response: textReply('T-host') });
    expect('responseSince' in hostResponded).toBe(false);
  });

  it('P01 a user decision answer on a work_run decision card marks a pending response position; a host-sent card gains none', () => {
    const card = createSessionMessageRecord(messageInput());
    const response = userAnswer('T-user-answer');
    const answered = nextSessionMessageRecord(card, { kind: 'decision_answered', response });
    expect(answered).toEqual({ ...card, revision: card.revision + 1, status: 'responded',
      readAt: response.respondedAt, response, application: null, responseSince: null });
    // The state-only binder fills exactly that pending null with the commit cursor.
    expect(bindMessageResponseCursor(answered, P1).responseSince).toBe(P1);

    const hostCard = createSessionMessageRecord(messageInput({ sender: HOST_SENDER, needsReply: false }));
    const hostAnswer = userAnswer('T-host-answer');
    const hostAnswered = nextSessionMessageRecord(hostCard, { kind: 'decision_answered', response: hostAnswer });
    expect(hostAnswered).toEqual({ ...hostCard, revision: hostCard.revision + 1, status: 'responded',
      readAt: hostAnswer.respondedAt, response: hostAnswer, application: null });
    expect('responseSince' in hostAnswered).toBe(false);
    expect(bindMessageResponseCursor(hostAnswered, P2)).toEqual(hostAnswered);
  });

  it('P01 binding replaces only the explicit pending null, never an absent or bound position', () => {
    const sent = createSessionMessageRecord(messageInput());
    const responded = nextSessionMessageRecord(sent, { kind: 'responded', response: textReply('T-text') });
    expect(bindMessageResponseCursor(responded, P1).responseSince).toBe(P1);
    expect(bindMessageResponseCursor({ ...responded, responseSince: P1 }, P2).responseSince).toBe(P1);
    const hostResponded = nextSessionMessageRecord(
      createSessionMessageRecord(messageInput({ sender: HOST_SENDER, needsReply: false })),
      { kind: 'responded', response: textReply('T-host') });
    expect('responseSince' in bindMessageResponseCursor(hostResponded, P3)).toBe(false);
    expect(bindMessageResponseCursor(hostResponded, P3)).toEqual(hostResponded);

    const entered = observeSessionHealthRecord(sessionRecordOf(), { health: 'unavailable', conclusion: 'missing' });
    const bound: CommitCursor = R2;
    expect(bindSessionUnavailableCursor(entered, bound).unavailableSince).toBe(R2);
    expect(bindSessionUnavailableCursor({ ...entered, unavailableSince: R3 }, bound).unavailableSince).toBe(R3);
    const available: SessionRecord = sessionRecordOf();
    expect('unavailableSince' in bindSessionUnavailableCursor(available, bound)).toBe(false);
  });
});
