/**
 * Slice 5 unit rows MD01..MD14
 * (docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md §5.2).
 *
 * `transitionMessage` on the new user-decision events plus the
 * `SessionMessageRecord` mirror (`nextSessionMessageRecord`,
 * `createSessionMessageRecord`). Pure: no RecordStore, no clock. The part-1
 * decision branches are stubs, so every case currently fails with the stub's
 * `not implemented`.
 */
import { describe, expect, it } from 'vitest';
import { artifactBodyDigest, type ArtifactRef } from '../../src/contracts/artifact.js';
import type {
  DecisionApplicationV1,
  DecisionMessageMetadataV1,
  UserMessageResponseV1,
} from '../../src/contracts/core/session-message.js';
import {
  decisionSourceKey,
  type DecisionAnnotationV1,
  type DecisionObjectV1,
  type DecisionOptionV1,
  type DecisionSelectionV1,
  type DecisionSourceV1,
  type UserDecisionBodyV1,
} from '../../src/contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { canSendUserMessage } from '../../src/core/work-graph/state/decision-policy.js';
import {
  decodeStoredUserDecisionBody, encodeUserDecisionBody, type StoredMessageBody,
} from '../../src/core/work-graph/sessions/message-body-envelope.js';
import {
  decodeSessionMessageRecord, encodeSessionMessageRecord, SESSION_MESSAGE_CONTENT_TYPE,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import {
  createSessionMessageRecord,
  createSyntheticDecisionAnswerRecord,
  messageMachineStateOf,
  nextSessionMessageRecord,
  transitionMessage,
  type MessageDecisionAnswerFacts,
  type MessageDecisionApplicationFacts,
  type MessageGuardContext,
  type MessageEffect,
  type MessageWorkRunSenderRecord,
  type MessageTransition,
  type MessageMachineState,
  type SessionMessageRecord,
} from '../../src/core/work-graph/state/message-machine.js';

// -------------------------------------------------------------------------- //
// §5.1 fixed fixture                                                        //
// -------------------------------------------------------------------------- //

const PROJECT = 'P';
const WORKSPACE = 'W';
const MESSAGE_REF = { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm-1' } as const;
const USER_RECIPIENT = { kind: 'user', projectId: PROJECT, workspaceId: WORKSPACE } as const;
const GOAL_B: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'B' };
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '3' };
const HOST_SENDER = { kind: 'host', actor: { kind: 'human', id: 'operator' } } as const;
const WORK_SENDER: MessageWorkRunSenderRecord = {
  kind: 'work_run', sessionRef: { projectId: PROJECT, sessionId: 'S' },
  runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'B', runId: 'RA' },
  roleBinding: { schemaVersion: 1, bindingId: 'adviser-binding', templateId: 'adviser',
    templateRevision: '1', bindingVersion: 1, policyRevision: '1' }, generation: 1,
};
const T = '2026-10-08T00:00:00.000Z';
const READ_AT = '2026-10-08T00:00:01.000Z';
const ANSWER_AT = '2026-10-08T00:00:02.000Z';
const FM = 'src/m/a.ts';

const ACCEPT_OPTION: DecisionOptionV1 = { id: 'accept', label: '接受', effect: 'apply' };
const DEFER_OPTION: DecisionOptionV1 = { id: 'defer', label: '暂缓', effect: 'defer' };

function decisionSource(): DecisionSourceV1 {
  return {
    kind: 'message',
    key: decisionSourceKey({ kind: 'message', messageRef: MESSAGE_REF }),
    goalRef: GOAL_B,
    pins: [{ ref: GOAL_B, revision: 7 }],
    goalBases: [{ goalRef: GOAL_B,
      workspaceRef: { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE },
      objective: 'objective of B', activePlanRef: { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'PB1' },
      settings: { schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 1, waitForGoalRef: null, parallelRisks: [] } }],
  };
}

function decisionMeta(overrides: Partial<DecisionMessageMetadataV1> = {}): DecisionMessageMetadataV1 {
  return {
    schemaVersion: 1,
    source: decisionSource(),
    objects: [],
    options: [ACCEPT_OPTION, DEFER_OPTION],
    syntheticAnswer: false,
    forwardedFrom: null,
    ...overrides,
  };
}

/** The pending@1 decision card, with the record mirror fields slice 5 adds. */
function pendingRecord(metadata: DecisionMessageMetadataV1 = decisionMeta()): SessionMessageRecord {
  expect(transitionMessage({ status: 'absent' }, { type: 'message_sent' }, sendContext(true)))
    .toEqual({ ok: true, next: PENDING_STATE, effects: SENT_EFFECTS });
  const base = createSessionMessageRecord({
    ref: MESSAGE_REF,
    sender: WORK_SENDER,
    recipient: USER_RECIPIENT,
    bodyRef: BODY,
    sourceRef: SOURCE,
    createdAt: T,
    intent: 'decision_request',
    needsReply: true,
    waitAfterSend: false,
  });
  // Pure precondition: current NewSessionMessageInput has no goalRef/decision fields.
  // Use the real codec for the saved card shape; MD01 reports this constructor gap.
  const decoded = decodeSessionMessageRecord(encodeSessionMessageRecord({ ...base, goalRef: GOAL_B, decision: metadata, application: null }));
  // Rebase onto slice 1 (lead): a decoded Message carries the slice-1 §2.9 read defaults.
  expect(decoded).toEqual({ status: 'decoded', value: { ...base, goalRef: GOAL_B, decision: metadata, application: null, replyHandler: null, archiveWaitDisposition: null } });
  if (decoded.status !== 'decoded') throw new Error('the pending decision-card precondition must decode');
  return decoded.value;
}

function respondedRecord(requiresApplication: boolean): SessionMessageRecord {
  const record = pendingRecord();
  const response = userResponse({
    selection: { kind: 'option', optionId: requiresApplication ? 'accept' : 'defer' }, requiresApplication,
  });
  return answer(record, response);
}

function storedBody(part: 'message' | 'response', sender: SessionMessageRecord['sender'], text: string): StoredMessageBody {
  const body = canonicalJson({ schemaVersion: 1, projectId: PROJECT, workspaceId: WORKSPACE,
    messageId: MESSAGE_REF.messageId, part, sender, text } as JsonValue);
  const ref: ArtifactRef = { kind: 'artifact', contentType: SESSION_MESSAGE_CONTENT_TYPE,
    digest: artifactBodyDigest(body), sizeBytes: Buffer.byteLength(body, 'utf8'), source: SOURCE };
  return { body, ref, sourceRefs: [SOURCE] };
}

const BODY = storedBody('message', WORK_SENDER, '请选择下一步').ref;

function userResponse(overrides: {
  selection?: DecisionSelectionV1;
  text?: string;
  annotations?: DecisionAnnotationV1[];
  requiresApplication?: boolean;
  source?: DecisionSourceV1;
  respondedAt?: string;
} = {}): UserMessageResponseV1 {
  // The answer's free text lives in the stored response body, never in the
  // `decision` metadata; the body ref is content-addressed so a test can prove
  // the exact payload (text included) is the one the record names.
  const body: UserDecisionBodyV1 = {
    schemaVersion: 1,
    kind: 'user_decision_response',
    selection: overrides.selection ?? { kind: 'option', optionId: 'accept' },
    text: overrides.text ?? '',
    annotations: overrides.annotations ?? [],
  };
  const encoded = encodeUserDecisionBody(body);
  return {
    sender: { kind: 'host', actor: { kind: 'human', id: 'operator' } },
    bodyRef: storedBody('response', HOST_SENDER, encoded).ref,
    sourceRef: SOURCE,
    respondedAt: overrides.respondedAt ?? T,
    decision: {
      selection: body.selection,
      source: overrides.source ?? decisionSource(),
      annotations: body.annotations,
      requiresApplication: overrides.requiresApplication ?? true,
    },
  };
}

function answerFacts(overrides: Partial<MessageDecisionAnswerFacts> = {}): MessageDecisionAnswerFacts {
  return {
    operatorMatches: true,
    messagePinMatches: true,
    goalNotCancelled: true,
    selectionValid: true,
    annotationsFromObjects: true,
    sourceFactsMatch: true,
    sourceNotUiOnly: true,
    answerSlotEmpty: true,
    ...overrides,
  };
}

function applicationFacts(overrides: Partial<MessageDecisionApplicationFacts> = {}): MessageDecisionApplicationFacts {
  return {
    receiptReadable: true,
    changedBeforeMatchesReceipt: true,
    receiptAfterMatches: true,
    answerAssociationExists: true,
    modifierOrOperator: true,
    requiresApplication: true,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<MessageGuardContext> = {}): MessageGuardContext {
  return {
    principal: 'host',
    workRunAuthorization: null,
    callerIsRecipient: null,
    recipientScope: null,
    sendFlags: null,
    pins: { count: 0, matchesMessage: false, revision: null },
    bodyBounded: null,
    queryAnswer: null,
    inputAccepted: null,
    consumedWait: null,
    ...overrides,
  };
}

const PENDING_STATE: MessageMachineState = {
  status: 'pending', hasReadAt: false, hasResponse: false, acceptedInputIds: [], hasDerivation: false, revision: 1,
};
const SENT_EFFECTS: readonly MessageEffect[] = [
  { kind: 'store_body', part: 'message', source: 'workspace' },
  { kind: 'write_message', change: 'created' },
  { kind: 'append_event', eventType: 'SessionMessageSent' },
  { kind: 'guard_message', expectedRevision: null },
  { kind: 'guard_work_run_facts' },
];

function sendContext(dutiesAllowSend: boolean): MessageGuardContext {
  return baseCtx({ principal: 'work_run', workRunAuthorization: 'ok', recipientScope: 'same_workspace',
    sendFlags: { needsReply: true, waitAfterSend: false, pinCount: 0 },
    userSend: { goalScopeMatches: true, dutiesAllowSend, decisionParamsValid: true } });
}

function answeredEffects(revision: number): readonly MessageEffect[] {
  return [
    { kind: 'store_body', part: 'response', source: 'workspace' },
    { kind: 'write_message', change: 'decision_answered' },
    { kind: 'append_event', eventType: 'SessionMessageResponded' },
    { kind: 'guard_message', expectedRevision: revision },
  ];
}

/** Exercise both production stages: admission/effects and the state-owned record writer. */
function answer(record: SessionMessageRecord, response: UserMessageResponseV1,
  facts: MessageDecisionAnswerFacts = answerFacts()): SessionMessageRecord {
  const before = structuredClone(record);
  const originalResponse = structuredClone(response);
  const result = transitionMessage(messageMachineStateOf(record), { type: 'user_decision_answered' }, baseCtx({
    pins: { count: 1, matchesMessage: true, revision: record.revision }, decisionAnswer: facts,
  }));
  expect(result).toEqual({ ok: true,
    next: { status: 'responded', hasReadAt: true, hasResponse: true, acceptedInputIds: [], hasDerivation: false,
      revision: record.revision + 1 }, effects: answeredEffects(record.revision) });
  if (!result.ok) throw new Error('the user answer must be admitted');
  const next = nextSessionMessageRecord(record, { kind: 'decision_answered', response });
  // Wiring 2 §2.3 P02 (L10/L11, §8.9): every caller passes pendingRecord(), whose sender is the work_run
  // WORK_SENDER, so the first answer also writes the pending reply position (spec literal null).
  expect(next).toEqual({ ...before, revision: before.revision + 1, status: 'responded',
    readAt: before.readAt ?? originalResponse.respondedAt, response: originalResponse, application: null,
    responseSince: null });
  expect(messageMachineStateOf(next)).toEqual(result.next);
  expect(record).toEqual(before);
  expect(response).toEqual(originalResponse);
  return next;
}

function expectRefused(result: MessageTransition, code: 'invalid' | 'forbidden' | 'revision_conflict') {
  expect(result).toMatchObject({ ok: false, code });
  expect(result).not.toHaveProperty('next');
  expect(result).not.toHaveProperty('effects');
}

// -------------------------------------------------------------------------- //
// MD01..MD14                                                                 //
// -------------------------------------------------------------------------- //

describe('S5 message decision unit rows (§5.2 MD01..MD14)', () => {
  it('MD01 an adviser user decision send creates pending@1 with needsReply and no response', () => {
    const allowed = canSendUserMessage({ duties: ['adviser'], readOnlyCopy: false,
      independentReview: false, intent: 'decision_request' });
    expect(allowed).toBe(true);
    const result = transitionMessage({ status: 'absent' }, { type: 'message_sent' }, sendContext(allowed));
    expect(result).toEqual({ ok: true, next: PENDING_STATE, effects: SENT_EFFECTS });
    if (!result.ok) throw new Error('an admitted adviser must be able to send');
    const next = createSessionMessageRecord({
      ref: MESSAGE_REF, sender: WORK_SENDER, recipient: USER_RECIPIENT, bodyRef: BODY,
      sourceRef: SOURCE, createdAt: T, intent: 'decision_request',
      needsReply: true, waitAfterSend: false, goalRef: GOAL_B, decision: decisionMeta(),
    });
    // [lead S5-T3-D7] the S5-MSG-01 constructor writes the owning Goal and the decision metadata.
    expect(next).toMatchObject({
      ref: MESSAGE_REF, schemaVersion: 1, revision: 1, sender: WORK_SENDER,
      recipient: USER_RECIPIENT, bodyRef: BODY, sourceRef: SOURCE, createdAt: T,
      status: 'pending', readAt: null, response: null, intent: 'decision_request', needsReply: true,
      goalRef: GOAL_B, decision: decisionMeta(),
    });
    expect(next).not.toHaveProperty('waitAfterSend');
    expect(messageMachineStateOf(next)).toEqual(result.next);
  });

  it('MD02 an executor user decision send is forbidden with zero effects', () => {
    const allowed = canSendUserMessage({ duties: ['executor'], readOnlyCopy: false,
      independentReview: false, intent: 'decision_request' });
    expect(allowed).toBe(false);
    const result = transitionMessage({ status: 'absent' }, { type: 'message_sent' }, sendContext(allowed));
    expectRefused(result, 'forbidden');
    expect(result).toMatchObject({ reason: 'guard_failed' });
  });

  it('MD03 an operator accept on pending@1 responds@2 and requires application', () => {
    const next = answer(pendingRecord(), userResponse());
    expect(next).toMatchObject({ revision: 2, status: 'responded', readAt: T, application: null,
      response: { sender: HOST_SENDER, decision: { selection: { kind: 'option', optionId: 'accept' }, requiresApplication: true } } });
  });

  it('MD04 an operator defer on read@2 responds@3 and keeps the original readAt', () => {
    const pending = pendingRecord();
    // UNDETERMINED MD04 (§5.2 row, spec line 982): read@2 is a stipulated
    // pure-machine precondition. The existing record writer can express it,
    // but ackMessage/ownsInbox refuses a user recipient, and reads do not ack
    // (§1.2). No production owner history for this precondition is specified.
    const read = nextSessionMessageRecord(pending, { kind: 'read', readAt: READ_AT });
    expect(read).toEqual({ ...pending, revision: 2, status: 'read', readAt: READ_AT });
    const next = answer(read, userResponse({ selection: { kind: 'option', optionId: 'defer' },
      requiresApplication: false, respondedAt: ANSWER_AT }));
    expect(next).toMatchObject({ revision: 3, status: 'responded', readAt: READ_AT,
      response: { respondedAt: ANSWER_AT, decision: { selection: { kind: 'option', optionId: 'defer' }, requiresApplication: false } } });
  });

  it('MD05 a text-only answer is recorded as other without rewriting the text', () => {
    const payload: UserDecisionBodyV1 = { schemaVersion: 1, kind: 'user_decision_response',
      selection: { kind: 'other' }, text: '另一个办法', annotations: [] };
    const response = userResponse({ selection: payload.selection, text: payload.text });
    const next = answer(pendingRecord(), response);
    const stored = storedBody('response', HOST_SENDER, encodeUserDecisionBody(payload));
    expect(next.response).toMatchObject({ bodyRef: stored.ref, decision: {
      selection: { kind: 'other' }, annotations: [], requiresApplication: true,
    } });
    expect(decodeStoredUserDecisionBody(next, 'response', stored)).toEqual({
      text: '另一个办法', body: { schemaVersion: 1, kind: 'user_decision_response',
        selection: { kind: 'other' }, text: '另一个办法', annotations: [] },
    });
  });

  it('MD06 an annotation-only answer is recorded as other with exactly one annotation', () => {
    const object: DecisionObjectV1 = { kind: 'file', workspace: { projectId: PROJECT, workspaceId: WORKSPACE },
      path: FM, digest: null, label: 'fm' };
    const objectKey = canonicalJson(object as JsonValue);
    const annotations: DecisionAnnotationV1[] = [{ objectKey, text: '先处理这里' }];
    const record = pendingRecord(decisionMeta({ objects: [object] }));
    const response = userResponse({ selection: { kind: 'other' }, annotations });
    const next = answer(record, response);
    expect(next.response).toMatchObject({ decision: { selection: { kind: 'other' },
      annotations: [{ objectKey, text: '先处理这里' }], requiresApplication: true } });
    const stored = storedBody('response', HOST_SENDER, encodeUserDecisionBody({
      schemaVersion: 1, kind: 'user_decision_response', selection: { kind: 'other' }, text: '', annotations,
    }));
    expect(decodeStoredUserDecisionBody(next, 'response', stored)).toEqual({ text: '', body: {
      schemaVersion: 1, kind: 'user_decision_response', selection: { kind: 'other' }, text: '',
      annotations: [{ objectKey, text: '先处理这里' }],
    } });
  });

  it('MD07 an answer with no option, empty text and no annotations is invalid', () => {
    const record = pendingRecord();
    const before = structuredClone(record);
    const result = transitionMessage(messageMachineStateOf(record), { type: 'user_decision_answered' }, baseCtx({
      pins: { count: 1, matchesMessage: true, revision: 1 }, decisionAnswer: answerFacts({ selectionValid: false }),
    }));
    expectRefused(result, 'invalid');
    expect(record).toEqual(before);
  });

  it('MD08 an annotation naming an object outside the card is invalid', () => {
    const record = pendingRecord();
    const before = structuredClone(record);
    const result = transitionMessage(messageMachineStateOf(record), { type: 'user_decision_answered' }, baseCtx({
      pins: { count: 1, matchesMessage: true, revision: 1 }, decisionAnswer: answerFacts({ annotationsFromObjects: false }),
    }));
    expectRefused(result, 'invalid');
    expect(record).toEqual(before);
  });

  it('MD09 a work_run answer to a user card is forbidden', () => {
    const record = pendingRecord();
    const before = structuredClone(record);
    const result = transitionMessage(messageMachineStateOf(record), { type: 'user_decision_answered' }, baseCtx({
      principal: 'work_run', workRunAuthorization: 'ok',
      pins: { count: 1, matchesMessage: true, revision: 1 }, decisionAnswer: answerFacts({ operatorMatches: false }),
    }));
    expectRefused(result, 'forbidden');
    expect(result).toMatchObject({ reason: 'guard_failed' });
    expect(record).toEqual(before);
  });

  it('MD10 a paused Goal still answers with no Plan or Run effect', () => {
    // The frozen context exposes goalNotCancelled, not an active-only guard.
    // A paused Goal supplies true; answer() checks the COMPLETE four effects,
    // so an empty list or an extra Plan/Run action cannot pass.
    const paused: { desiredState: 'active' | 'paused' | 'cancelled' } = { desiredState: 'paused' };
    const next = answer(pendingRecord(), userResponse(), answerFacts({ goalNotCancelled: paused.desiredState !== 'cancelled' }));
    expect(next).toMatchObject({ revision: 2, status: 'responded', application: null });
  });

  it('MD11 a synthetic non-message answer creates responded@1 from the operator', () => {
    const result = transitionMessage({ status: 'absent' }, { type: 'synthetic_decision_answered' },
      baseCtx({ decisionAnswer: answerFacts() }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('the synthetic answer must be admitted');
    expect(result.next).toEqual({ status: 'responded', hasReadAt: true, hasResponse: true,
      acceptedInputIds: [], hasDerivation: false, revision: 1 });
    expect(result.effects.filter((effect) => effect.kind === 'store_body')).toEqual([
      { kind: 'store_body', part: 'message', source: 'workspace' },
      { kind: 'store_body', part: 'response', source: 'workspace' },
    ]);
    expect(result.effects.filter((effect) => effect.kind === 'append_event')).toEqual([
      { kind: 'append_event', eventType: 'SessionMessageDecisionAnswered' },
    ]);
    expect(result.effects.filter((effect) => effect.kind === 'guard_message')).toEqual([
      { kind: 'guard_message', expectedRevision: null },
    ]);
    expect(result.effects.filter((effect) => effect.kind === 'write_message')).toHaveLength(1);
    expect(result.effects.filter((effect) => effect.kind === 'guard_work_run_facts')).toEqual([]);
    // [lead S5-T3-D7] the S5-MSG-03 constructor builds the synthetic record from the
    // operator, the card (a NON-message source) and the answer; the answer claim is the
    // service's (§2.5), not a state effect.
    const causeSource: DecisionSourceV1 = {
      kind: 'goal_cause',
      key: decisionSourceKey({ kind: 'goal_cause', goalRef: GOAL_B, code: 'required_task_deferred',
        affected: [{ ref: GOAL_B, revision: 7 }] }),
      goalRef: GOAL_B, pins: [{ ref: GOAL_B, revision: 7 }],
    };
    const metadata = decisionMeta({ source: causeSource, options: [], syntheticAnswer: true });
    const response = userResponse({ selection: { kind: 'other' }, text: '先做 B 的第二项', source: causeSource,
      requiresApplication: true, respondedAt: ANSWER_AT });
    // §2.3: the synthetic message part stores the same answer payload in its own operator-bound envelope.
    const messageBody = storedBody('message', HOST_SENDER, encodeUserDecisionBody({ schemaVersion: 1,
      kind: 'user_decision_response', selection: { kind: 'other' }, text: '先做 B 的第二项', annotations: [] })).ref;
    const synthetic = createSyntheticDecisionAnswerRecord({
      ref: MESSAGE_REF, sender: HOST_SENDER, recipient: USER_RECIPIENT, bodyRef: messageBody, sourceRef: SOURCE,
      createdAt: ANSWER_AT, goalRef: GOAL_B, decision: metadata, response,
    });
    // §2.3: recipient=user, intent=notify, decision.syntheticAnswer=true, responded@1.
    expect(synthetic).toEqual({
      ref: MESSAGE_REF, schemaVersion: 1, revision: 1, sender: HOST_SENDER, recipient: USER_RECIPIENT,
      bodyRef: messageBody, sourceRef: SOURCE, createdAt: ANSWER_AT, status: 'responded', readAt: ANSWER_AT,
      response, intent: 'notify', goalRef: GOAL_B, decision: metadata, application: null,
    });
    expect(messageMachineStateOf(synthetic)).toEqual(result.next);
  });

  it('MD12 recording an application for a requiresApplication=false answer is invalid', () => {
    const record = respondedRecord(false);
    const before = structuredClone(record);
    const result = transitionMessage(messageMachineStateOf(record), { type: 'decision_application_recorded' }, baseCtx({
      pins: { count: 1, matchesMessage: true, revision: 2 },
      decisionApplication: applicationFacts({ requiresApplication: false }),
    }));
    expectRefused(result, 'invalid');
    expect(record).toEqual(before);
    expect(record.application).toBeNull();
  });

  it('MD13 a matching application records the proof and keeps the original response', () => {
    const record = respondedRecord(true);
    const before = structuredClone(record);
    const application: DecisionApplicationV1 = {
      schemaVersion: 1, actor: { kind: 'human', id: 'operator' }, appliedAt: ANSWER_AT,
      receipt: { identityKey: 'ik-1', fingerprint: 'fp-1', cursor: makeCommitCursor(5) },
      changes: [{ before: { ref: GOAL_B, revision: 7 }, after: { ref: GOAL_B, revision: 8 } }],
      basisRebases: [],
    };
    const result = transitionMessage(messageMachineStateOf(record), { type: 'decision_application_recorded' }, baseCtx({
      pins: { count: 1, matchesMessage: true, revision: 2 }, decisionApplication: applicationFacts(),
    }));
    expect(result).toEqual({ ok: true,
      next: { status: 'responded', hasReadAt: true, hasResponse: true, acceptedInputIds: [], hasDerivation: false, revision: 3 },
      effects: [
        { kind: 'write_message', change: 'decision_applied' },
        { kind: 'append_event', eventType: 'SessionMessageDecisionApplied' },
        { kind: 'guard_message', expectedRevision: 2 },
      ],
    });
    if (!result.ok) throw new Error('the matching application proof must be admitted');
    const next = nextSessionMessageRecord(record, { kind: 'decision_applied', application });
    expect(next).toEqual({ ...before, revision: 3, application });
    expect(next.response).toEqual(before.response);
    expect(messageMachineStateOf(next)).toEqual(result.next);
    expect(record).toEqual(before);
  });

  it('MD14 an application proof that disagrees with the captured content is a revision_conflict', () => {
    const record = respondedRecord(true);
    const before = structuredClone(record);
    const result = transitionMessage(messageMachineStateOf(record), { type: 'decision_application_recorded' }, baseCtx({
      pins: { count: 1, matchesMessage: true, revision: 2 },
      decisionApplication: applicationFacts({ changedBeforeMatchesReceipt: false }),
    }));
    expectRefused(result, 'revision_conflict');
    expect(result).toMatchObject({ reason: 'stale' });
    expect(record).toEqual(before);
  });
});
