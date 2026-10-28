/**
 * G-early pure rows (book 7a:436–:444): the proof builder, the proof-event
 * decoder, the card's two release options and the answer-derived command fields.
 * Constructed input and hand-written expectations; no store, Host, Workflow or
 * Runtime.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef, UserMessageResponseV1 } from '../../src/contracts/core/session-message.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import { decisionSourceKey, type DecisionChangeProofV1, type DecisionSelectionV1,
  type DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import {
  decodeMessageReleaseProofEvent, messageReleaseChangeProof,
} from '../../src/core/work-graph/communication/decision-change-proof.js';
import {
  messageReleaseAllowOf, messageReleaseAnswerCommand,
} from '../../src/core/work-graph/tasks/message-release-answer.js';
import { encodeSessionMessageReleaseDecidedEvent } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import {
  createSessionMessageRecord, nextSessionMessageRecord, type SessionMessageRecord,
} from '../../src/core/work-graph/state/message-machine.js';
import { s7aRecordInput } from '../helpers/S7A-message-fixtures.js';

const AT = '2026-10-27T00:00:00.000Z';
const REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'P', workspaceId: 'W', messageId: 'm-1' };
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: 'W', revision: '1' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1, source: SOURCE };
const BEFORE: VersionPin = { ref: REF, revision: 1 }; const AFTER: VersionPin = { ref: REF, revision: 2 };
const PROOF: DecisionChangeProofV1 = { acknowledgementRef: REF, capturedPins: [BEFORE], changes: [{ before: BEFORE, after: AFTER }], basisRebases: [] };

function releaseDecidedEvent(proof: DecisionChangeProofV1 | null) {
  const record = createSessionMessageRecord(s7aRecordInput({
    ref: REF, sender: { kind: 'host', actor: { kind: 'human', id: 'operator' } }, createdAt: AT, release: 'awaiting',
  }));
  const message = nextSessionMessageRecord(record, {
    kind: 'release_decided', allow: true, approvedAt: AT, approvalRevision: 2, release: 'approved', proof,
  });
  return encodeSessionMessageReleaseDecidedEvent({
    eventId: 'e-1', eventType: 'SessionMessageReleaseDecided', schemaVersion: 1, occurredAt: AT, projectId: 'P', workspaceId: 'W', requestId: 'r-1',
    actor: { kind: 'host', actor: { kind: 'human', id: 'operator' } }, message, proof,
  });
}

type ChangeProofInput = { answerRef: SessionMessageRef; capturedPins: VersionPin[]; before: VersionPin; after: VersionPin };

describe('G release proof pure rules', () => {
  it.each<[ChangeProofInput, DecisionChangeProofV1]>([[
    { answerRef: REF, capturedPins: [BEFORE], before: BEFORE, after: AFTER },
    PROOF,
  ]])('messageReleaseChangeProof builds the B-13 proof', (input, expected) => {
    expect(messageReleaseChangeProof(input)).toEqual(expected);
  });

  it.each([
    ['with a proof', PROOF], ['with proof: null', null],
  ] as ReadonlyArray<[string, DecisionChangeProofV1 | null]>)('decodeMessageReleaseProofEvent reads %s', (_label, proof) => {
    expect(decodeMessageReleaseProofEvent(releaseDecidedEvent(proof))).toEqual({
      actor: { kind: 'human', id: 'operator' }, appliedAt: AT, proof,
    });
  });

  it.each([
    [{ kind: 'option', optionId: 'approve' }, true],
    [{ kind: 'option', optionId: 'deny' }, false],
    [{ kind: 'option', optionId: 'defer' }, null],
    [{ kind: 'other' }, null],
  ] as ReadonlyArray<[DecisionSelectionV1, boolean | null]>)('messageReleaseAllowOf maps %j to %j', (selection, expected) => {
    expect(messageReleaseAllowOf(selection)).toBe(expected);
  });
});

const ANSWER_REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'P', workspaceId: 'W', messageId: 'a-1' };
const TARGET_REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'P', workspaceId: 'W', messageId: 'm-target' };
const TARGET_PIN: VersionPin = { ref: TARGET_REF, revision: 1 };
// `'answer:' + ` the SHA-256 of the answer ref's canonical JSON text, computed once with the repo's
// canonicalJson/sha256Hex outside the code under test (never derived through the production identity).
const ANSWER_COMMAND_ID = 'answer:f5b286c72cc5dbcb3f6a95f3af8ef28d90dfb2f7566212235d02ae8d45697a6f';

function releaseAnswer(selection: DecisionSelectionV1, source: DecisionSourceV1,
  actor: { kind: 'human' | 'system'; id: string } = { kind: 'human', id: 'operator' }): SessionMessageRecord {
  const record = createSessionMessageRecord(s7aRecordInput({ ref: ANSWER_REF, sender: { kind: 'host', actor }, createdAt: AT }));
  const response: UserMessageResponseV1 = {
    sender: { kind: 'host', actor }, bodyRef: BODY, sourceRef: SOURCE, respondedAt: AT,
    decision: { selection, source, annotations: [], requiresApplication: true },
  };
  return nextSessionMessageRecord(record, { kind: 'decision_answered', response });
}
function releaseSource(identity: Parameters<typeof decisionSourceKey>[0] =
  { kind: 'message_release', messageRef: TARGET_REF, revision: 1 }): DecisionSourceV1 {
  return {
    kind: identity.kind, key: decisionSourceKey(identity),
    subject: { kind: 'project', projectRef: { projectId: 'P' } }, pins: [TARGET_PIN],
  };
}

describe('G release answer command pure rules', () => {
  it.each<[string, SessionMessageRecord, ReturnType<typeof messageReleaseAnswerCommand>]>([
    ['approve', releaseAnswer({ kind: 'option', optionId: 'approve' }, releaseSource()), {
      operation: 'message.release', scope: { projectId: 'P', workspaceId: 'W' },
      principal: { kind: 'host', actor: { kind: 'human', id: 'operator' } }, commandId: ANSWER_COMMAND_ID,
      fingerprintInput: { answerRef: ANSWER_REF, messageRef: TARGET_REF, allow: true },
    }],
    ['deny', releaseAnswer({ kind: 'option', optionId: 'deny' }, releaseSource()), {
      operation: 'message.release', scope: { projectId: 'P', workspaceId: 'W' },
      principal: { kind: 'host', actor: { kind: 'human', id: 'operator' } }, commandId: ANSWER_COMMAND_ID,
      fingerprintInput: { answerRef: ANSWER_REF, messageRef: TARGET_REF, allow: false },
    }],
    ['system answerer', releaseAnswer({ kind: 'option', optionId: 'approve' }, releaseSource(),
      { kind: 'system', id: 'host' }), null],
    ['another source', releaseAnswer({ kind: 'option', optionId: 'approve' },
      releaseSource({ kind: 'note_review', note: TARGET_PIN })), null],
    ['other selection', releaseAnswer({ kind: 'other' }, releaseSource()), null],
  ])('%s answer gives the R2 fields', (_label, answer, expected) => {
    expect(messageReleaseAnswerCommand(answer)).toEqual(expected);
  });
});
