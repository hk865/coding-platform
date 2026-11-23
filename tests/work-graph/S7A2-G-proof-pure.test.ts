/**
 * G-early pure rows (book 7a:436–:444): the `action_release` proof builder, the proof-event decoder, the answer's
 * allow map and its R2 command fields. Constructed input and hand-written expectations; no store, Host, Workflow or
 * Runtime.
 */
import { describe, expect, it } from 'vitest';
import type { ActionRequestRef } from '../../src/contracts/action-request.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef, UserMessageResponseV1 } from '../../src/contracts/core/session-message.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import type { RunRef, SourceRefV1, TaskTriple } from '../../src/contracts/dispatch.js';
import { decisionSourceKey, type DecisionChangeProofV1, type DecisionSelectionV1,
  type DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { decodeActionReleaseProofEvent } from '../../src/core/work-graph/communication/decision-change-proof.js';
import {
  actionReleaseChangeProof, actionRequestAnswerCommandOf, actionRequestAnswerFacts,
} from '../../src/core/work-graph/tasks/action-request-answer.js';
import { actionRequestChangedCodec } from '../../src/core/work-graph/tasks/action-request-codecs.js';
import {
  newDispatchRequest,
} from '../../src/core/work-graph/state/action-request.js';
import {
  createSessionMessageRecord, nextSessionMessageRecord, type SessionMessageRecord,
} from '../../src/core/work-graph/state/message-machine.js';
import { s7aRecordInput } from '../helpers/S7A-message-fixtures.js';

const AT = '2026-10-27T00:00:00.000Z';
const REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'P', workspaceId: 'W', messageId: 'm-1' };
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: 'W', revision: '1' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1, source: SOURCE };
const ANSWER_REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: 'P', workspaceId: 'W', messageId: 'a-1' };
const REQUEST_REF: ActionRequestRef = { aggregateType: 'ActionRequest', projectId: 'P', goalId: 'g-1',
  taskId: 't-1', requestId: 'r-1' };
const REQUEST_PIN: VersionPin = { ref: REQUEST_REF, revision: 1 };
const TASK: TaskTriple = { projectId: 'P', goalId: 'g-1', taskId: 't-1' };
const RUN: RunRef = { aggregateType: 'Run', projectId: 'P', goalId: 'g-1', runId: 'run-1' };
const QUERY_RUN: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'P', workspaceId: 'W',
  queryJobId: 'qj-1', runId: 'qr-1' };
const BEFORE: VersionPin = { ref: REF, revision: 1 }; const AFTER: VersionPin = { ref: REF, revision: 2 };
const PROOF: DecisionChangeProofV1 = { acknowledgementRef: ANSWER_REF, capturedPins: [BEFORE],
  changes: [{ before: BEFORE, after: AFTER }], basisRebases: [] };

function actionReleaseEvent(proof: DecisionChangeProofV1 | null) {
  const pending = newDispatchRequest({
    ref: REQUEST_REF, workspaceId: 'W', task: TASK,
    requester: { kind: 'query_run', actor: { kind: 'agent', id: 'line-a', queryRunRef: QUERY_RUN },
      session: { projectId: 'P', sessionId: 's-a' }, queryRun: QUERY_RUN, duty: 'secretary' },
    reason: 'G proof dispatch', requestedAt: AT, decision: { verdict: 'needs_decision' },
    expected: { planRevision: 1, pointerRevision: 'none', dispatchSequence: 0 }, preferredLine: null,
  }, 'pending');
  // The event snapshot is the record without the commit-bound `since` cursor.
  const { since, ...snapshot } = pending;
  void since;
  const approved = { ...snapshot, state: 'open' as const, answerRef: ANSWER_REF };
  return actionRequestChangedCodec.encode({
    eventId: 'e-1', eventType: 'ActionRequestChanged', schemaVersion: 1, occurredAt: AT,
    identityKey: canonicalKey(REQUEST_REF), fingerprint: 'g-proof-fingerprint',
    change: proof === null ? 'created' : 'approved',
    request: approved,
    ...(proof === null ? {} : { actor: { kind: 'human' as const, id: 'operator' }, proof }),
  });
}

type ChangeProofInput = { answerRef: SessionMessageRef; capturedPins: VersionPin[];
  changes: { before: VersionPin; after: VersionPin }[] };

describe('G release proof pure rules', () => {
  it.each<[ChangeProofInput, DecisionChangeProofV1]>([[
    { answerRef: ANSWER_REF, capturedPins: [BEFORE], changes: [{ before: BEFORE, after: AFTER }] },
    PROOF,
  ]])('actionReleaseChangeProof builds the B-13 proof', (input, expected) => {
    expect(actionReleaseChangeProof(input)).toEqual(expected);
  });

  it.each([
    ['with a proof', PROOF],
  ] as ReadonlyArray<[string, DecisionChangeProofV1]>)('decodeActionReleaseProofEvent reads %s', (_label, proof) => {
    expect(decodeActionReleaseProofEvent(actionReleaseEvent(proof))).toEqual({
      actor: { kind: 'human', id: 'operator' }, appliedAt: AT, proof,
    });
  });

  it('an answered change without a proof is incomplete', () => {
    expect(decodeActionReleaseProofEvent(actionReleaseEvent(null))).toMatchObject({
      status: 'rejected', code: 'incomplete',
    });
  });

  it.each([
    [{ kind: 'option', optionId: 'approve' }, true],
    [{ kind: 'option', optionId: 'deny' }, false],
    [{ kind: 'option', optionId: 'defer' }, null],
    [{ kind: 'other' }, null],
  ] as ReadonlyArray<[DecisionSelectionV1, boolean | null]>)('actionRequestAnswerFacts maps %j to allow %j', (selection, expected) => {
    const facts = actionRequestAnswerFacts(releaseAnswer(selection, releaseSource()));
    if (expected === null) {
      expect(facts).toBeNull();
    } else {
      expect(facts?.allow).toBe(expected);
    }
  });
});

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
  { kind: 'action_release', requestRef: REQUEST_REF, revision: 1 }): DecisionSourceV1 {
  const actionRelease = identity.kind === 'action_release';
  return {
    kind: identity.kind, key: decisionSourceKey(identity),
    subject: { kind: 'project', projectRef: { projectId: 'P' } },
    pins: [actionRelease ? REQUEST_PIN : TARGET_PIN],
  };
}

describe('G release answer command pure rules', () => {
  it.each<[string, SessionMessageRecord, ReturnType<typeof actionRequestAnswerCommandOf> | null]>([
    ['approve', releaseAnswer({ kind: 'option', optionId: 'approve' }, releaseSource()), {
      operation: 'action_request.approve', scope: { projectId: 'P', workspaceId: 'W' },
      principal: { kind: 'host', actor: { kind: 'human', id: 'operator' } }, commandId: ANSWER_COMMAND_ID,
      fingerprintInput: { request: REQUEST_REF, revision: 1, answerRef: ANSWER_REF },
    }],
    ['deny', releaseAnswer({ kind: 'option', optionId: 'deny' }, releaseSource()), {
      operation: 'action_request.deny', scope: { projectId: 'P', workspaceId: 'W' },
      principal: { kind: 'host', actor: { kind: 'human', id: 'operator' } }, commandId: ANSWER_COMMAND_ID,
      fingerprintInput: { request: REQUEST_REF, revision: 1, answerRef: ANSWER_REF },
    }],
    ['system answerer', releaseAnswer({ kind: 'option', optionId: 'approve' }, releaseSource(),
      { kind: 'system', id: 'host' }), {
      operation: 'action_request.approve', scope: { projectId: 'P', workspaceId: 'W' },
      principal: { kind: 'host', actor: { kind: 'system', id: 'host' } }, commandId: ANSWER_COMMAND_ID,
      fingerprintInput: { request: REQUEST_REF, revision: 1, answerRef: ANSWER_REF },
    }],
    ['another source', releaseAnswer({ kind: 'option', optionId: 'approve' },
      releaseSource({ kind: 'note_review', note: TARGET_PIN })), null],
    ['other selection', releaseAnswer({ kind: 'other' }, releaseSource()), null],
  ])('%s answer gives the R2 fields', (_label, answer, expected) => {
    const facts = actionRequestAnswerFacts(answer);
    expect(facts === null ? null : actionRequestAnswerCommandOf(facts)).toEqual(expected);
  });
});
