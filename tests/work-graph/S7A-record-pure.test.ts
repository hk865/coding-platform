/**
 * R-record-shape (the record's new fields): a fresh record carries the
 * nineteen new persisted fields and the now-required `goalRef` with their
 * initial values; the historical status triple is untouched;
 * `messageMachineStateOf` projects the eight new state facts; and
 * `applicationProof` is a key of its own, independent of `application`.
 *
 * Pure input -> output (A5): no store, clock, Host or fixture. Every expected
 * value is the initial value listed for the new fields, never a value printed
 * by the code.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import type {
  ApplicationProofV1, DecisionApplicationV1, DecisionMessageMetadataV1, MessageRecipient,
  SessionMessageRef, UserMessageResponseV1,
} from '../../src/contracts/core/session-message.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import {
  createSessionMessageRecord,
  createSyntheticDecisionAnswerRecord,
  messageMachineStateOf,
  nextSessionMessageRecord,
} from '../../src/core/work-graph/state/message-machine.js';
import { s7aRecordInput } from '../helpers/S7A-message-fixtures.js';

const PROJECT = 'P';
const WORKSPACE = 'W';
const AT = '2026-10-25T00:00:00.000Z';
const MESSAGE_REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm-1' };
const RECIPIENT: MessageRecipient = { projectId: PROJECT, sessionId: 'S' };
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '1' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1, source: SOURCE };
const HOST = { kind: 'host', actor: { kind: 'human', id: 'operator' } } as const;
const GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'g' };

const NEW_FIELDS: ReadonlyArray<[string, unknown]> = [
  ['taskRef', null], ['requestRoot', null], ['followupOf', null], ['deadline', null],
  ['deadlineMs', null], ['release', null], ['delivery', 'queued'], ['deliveryEvidence', null],
  ['expiredAt', null], ['withdrawnAt', null], ['waitCancelledAt', null], ['transferredTo', null],
  ['originalRef', null], ['appliedAt', null], ['rejectedAt', null], ['approvedAt', null],
  ['approvalRevision', null], ['applicationProof', null], ['pins', null], ['goalRef', null],
];

const DECISION_SOURCE = {
  kind: 'message' as const, key: 'message:m-1' as const,
  subject: { kind: 'goal' as const, goalRef: GOAL }, pins: [],
};
const METADATA: DecisionMessageMetadataV1 = {
  schemaVersion: 1, source: DECISION_SOURCE, objects: [], options: [], syntheticAnswer: false, forwardedFrom: null,
};
const ANSWER: UserMessageResponseV1 = {
  sender: HOST, bodyRef: BODY, sourceRef: SOURCE, respondedAt: AT,
  decision: { selection: { kind: 'other' }, source: DECISION_SOURCE, annotations: [], requiresApplication: false },
};

describe('R-record-shape', () => {
  it.each(NEW_FIELDS)('createSessionMessageRecord writes %s with its initial value', (field, value) => {
    expect(createSessionMessageRecord(s7aRecordInput())).toHaveProperty(field, value);
  });

  it('writes goalRef: null when omitted and keeps an explicit Goal', () => {
    expect(createSessionMessageRecord(s7aRecordInput())).toHaveProperty('goalRef', null);
    expect(createSessionMessageRecord(s7aRecordInput({ goalRef: GOAL })).goalRef).toEqual(GOAL);
  });

  it('keeps approvalRevision null before approval and applicationProof apart from application', () => {
    const application: DecisionApplicationV1 = {
      schemaVersion: 1, actor: { kind: 'human', id: 'operator' }, appliedAt: AT,
      receipt: { identityKey: 'app', fingerprint: 'app-f', cursor: makeCommitCursor(1) }, changes: [],
    };
    const proof: ApplicationProofV1 = {
      receipt: { identityKey: 'proof', fingerprint: 'proof-f', cursor: makeCommitCursor(2) },
      effect: { kind: 'requeue', ref: GOAL },
    };
    const before = { ...createSessionMessageRecord(s7aRecordInput()), application };
    const after = nextSessionMessageRecord(before, { kind: 'applied', appliedAt: AT, proof });
    expect(before.approvalRevision).toBeNull();
    expect(after.application).toEqual(application);
    expect(after.applicationProof).toEqual(proof);
    expect(after.applicationProof).not.toBe(after.application);
  });

  it('leaves the historical status triple alone and projects the eight new state fields', () => {
    const record = createSessionMessageRecord(s7aRecordInput());
    const state = messageMachineStateOf(record);
    expect({ status: record.status, readAt: record.readAt, response: record.response })
      .toEqual({ status: 'pending', readAt: null, response: null });
    if (state.status === 'absent') throw new Error('a fresh record is not absent');
    expect({
      release: state.release, delivery: state.delivery, withdrawnAt: state.withdrawnAt,
      appliedAt: state.appliedAt, rejectedAt: state.rejectedAt, approvedAt: state.approvedAt,
      approvalRevision: state.approvalRevision, pins: state.pins,
    }).toEqual({
      release: null, delivery: 'queued', withdrawnAt: null, appliedAt: null,
      rejectedAt: null, approvedAt: null, approvalRevision: null, pins: null,
    });
  });

  const pending = createSessionMessageRecord(s7aRecordInput());
  const accepted = nextSessionMessageRecord(pending, { kind: 'input_accepted', input: {
    inputId: 'i-1', part: 'message',
    executionRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'g', runId: 'r' },
    kernel: { adapterId: 'a', kernelSessionId: 'k', runId: 'r', turnId: 't', position: 1 }, acceptedAt: AT,
    evidence: 'input_accepted', consumesWait: false } });
  it.each([
    ['an accepted message part', accepted, /an accepted message part cannot be withdrawn/],
    ['a denied release', createSessionMessageRecord(s7aRecordInput({ release: 'denied' })),
      /a denied message cannot be withdrawn/],
    ['an applied message', createSessionMessageRecord(s7aRecordInput({ appliedAt: AT })),
      /an applied message cannot be withdrawn/],
  ] as const)('refuses to withdraw %s', (label, record, message) => {
    expect(() => nextSessionMessageRecord(record, { kind: 'withdrawn', withdrawnAt: AT })).toThrow(message);
  });

  it('createSyntheticDecisionAnswerRecord writes the same nineteen defaults', () => {
    const synthetic = createSyntheticDecisionAnswerRecord({
      ref: MESSAGE_REF, sender: HOST, recipient: RECIPIENT, bodyRef: BODY, sourceRef: SOURCE,
      createdAt: AT, goalRef: null, decision: METADATA, response: ANSWER,
    });
    for (const [field, value] of NEW_FIELDS) expect(synthetic).toHaveProperty(field, value);
  });
});
