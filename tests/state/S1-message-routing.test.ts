/**
 * Slice 1 §3.5 message routing (spec §5.2 UT23–UT25): the `archive_wait_disposed`
 * change/event of `state/message-machine.ts`. A transfer writes the new
 * `replyHandler` (and the transfer `archiveWaitDisposition`) without touching
 * status/response/sender/recipient; a cancel records the cancel disposition
 * and keeps the handler; an already accepted response refuses the transfer.
 *
 * Pure: no RecordStore, no Kernel, no clock.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ArchiveWaitChoiceV1 } from '../../src/contracts/core/session-archive.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1 } from '../../src/contracts/dispatch.js';
import { deriveSessionInputId } from '../../src/core/work-graph/model/communication-contracts.js';
import {
  messageMachineStateOf, nextSessionMessageRecord, transitionMessage,
  type MessageGuardContext, type MessageResponseRecord, type MessageWorkRunSenderRecord,
  type SessionMessageChange, type SessionMessageRecord,
} from '../../src/core/work-graph/state/message-machine.js';

// --------------------------------------------------------------------------
// Fixtures (spec §5.1: project p, workspace w, message m, request a, Sessions S/D)
// --------------------------------------------------------------------------

const PROJECT = 'p';
const WORKSPACE = 'w';
const T0 = '2026-10-08T00:00:00.000Z';

const MESSAGE_REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm' };
const SESSION_S: SessionRef = { projectId: PROJECT, sessionId: 'S' };
const SESSION_D: SessionRef = { projectId: PROJECT, sessionId: 'D' };
const RECIPIENT: SessionRef = { projectId: PROJECT, sessionId: 'R' };
const RUN_R0: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: 'g', runId: 'r0' };
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '7' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'sha256:body', sizeBytes: 11, source: SOURCE };
const REPLY_BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'sha256:reply', sizeBytes: 5, source: SOURCE };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};

const SENDER: MessageWorkRunSenderRecord = { kind: 'work_run', sessionRef: SESSION_S, runRef: RUN_R0, roleBinding: ROLE, generation: 2 };
const RESPONDER: MessageWorkRunSenderRecord = {
  kind: 'work_run', sessionRef: SESSION_D, roleBinding: ROLE, generation: 3,
  runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'g', runId: 'r1' },
};
const RESPONSE: MessageResponseRecord = { sender: RESPONDER, bodyRef: REPLY_BODY, sourceRef: SOURCE, respondedAt: T0 };

const RESPONDED: SessionMessageRecord = {
  ref: MESSAGE_REF, schemaVersion: 1, revision: 3, sender: SENDER, recipient: RECIPIENT, bodyRef: BODY, sourceRef: SOURCE,
  createdAt: T0, status: 'responded', readAt: T0, response: RESPONSE,
};
const READ: SessionMessageRecord = {
  ref: MESSAGE_REF, schemaVersion: 1, revision: 2, sender: SENDER, recipient: RECIPIENT, bodyRef: BODY, sourceRef: SOURCE,
  createdAt: T0, status: 'read', readAt: T0, response: null,
};

const TRANSFER_CHOICE: ArchiveWaitChoiceV1 = { kind: 'transfer', runRef: RUN_R0, messageRef: MESSAGE_REF, to: SESSION_D };
const CANCEL_CHOICE: ArchiveWaitChoiceV1 = { kind: 'cancel', runRef: RUN_R0, messageRef: MESSAGE_REF };
const TRANSFER: SessionMessageChange = {
  kind: 'archive_wait_disposed', choice: TRANSFER_CHOICE, archiveSessionRef: SESSION_S, archiveRequestId: 'a', now: T0,
};
const CANCEL: SessionMessageChange = {
  kind: 'archive_wait_disposed', choice: CANCEL_CHOICE, archiveSessionRef: SESSION_S, archiveRequestId: 'a', now: T0,
};

function baseCtx(): MessageGuardContext {
  return {
    principal: 'host', workRunAuthorization: null, callerIsRecipient: null, recipientScope: null, sendFlags: null,
    pins: { count: 0, matchesMessage: false, revision: null }, bodyBounded: null, queryAnswer: null,
    inputAccepted: null, consumedWait: null,
  };
}

function archiveCtx(choice: ArchiveWaitChoiceV1, over: Partial<NonNullable<MessageGuardContext['archiveWait']>> = {}): MessageGuardContext {
  return {
    ...baseCtx(),
    archiveWait: {
      choice, archiveSessionRef: SESSION_S, archiveRequestId: 'a', now: T0,
      requestMatches: true, waitMatches: true, targetEligible: true, responseAccepted: false,
      ...over,
    },
  };
}

// --------------------------------------------------------------------------
// UT23–UT25
// --------------------------------------------------------------------------

describe('archive_wait_disposed (S1-MSG-01/02, §5.2 UT23–UT25)', () => {
  it('UT23 transferring the wait to D writes the reply handler and bumps the revision', () => {
    const state = messageMachineStateOf(RESPONDED);
    const transition = transitionMessage(state, { type: 'archive_wait_disposed' }, archiveCtx(TRANSFER_CHOICE));
    expect(transition.ok).toBe(true);
    if (!transition.ok) return;
    expect(transition.effects).toContainEqual({ kind: 'write_message', change: 'archive_wait_disposed' });
    expect(transition.effects).toContainEqual({ kind: 'append_event', eventType: 'ArchiveWaitDisposed' });

    const next = nextSessionMessageRecord(RESPONDED, TRANSFER);
    expect(next.revision).toBe(RESPONDED.revision + 1);
    expect(next.status).toBe(RESPONDED.status);
    expect(next.response).toEqual(RESPONDED.response);
    expect(next.sender).toEqual(RESPONDED.sender);
    expect(next.recipient).toEqual(RESPONDED.recipient);
    expect(next.replyHandler).toEqual({
      sessionRef: SESSION_D, archiveSessionRef: SESSION_S, archiveRequestId: 'a', changedAt: T0,
    });
    expect(next.archiveWaitDisposition).toEqual({
      kind: 'transfer', runRef: RUN_R0, archiveSessionRef: SESSION_S, archiveRequestId: 'a', recordedAt: T0,
    });
  });

  it('UT24 refuses the transfer once the response is already accepted', () => {
    const responseInput = deriveSessionInputId(MESSAGE_REF, 'response');
    const record: SessionMessageRecord = {
      ...RESPONDED,
      acceptedInputs: [{
        inputId: responseInput, part: 'response', executionRef: RUN_R0, acceptedAt: T0,
        kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-D', runId: 'r1', turnId: 't1', position: 1 },
      }],
    };
    const before = JSON.stringify(record);
    const result = transitionMessage(
      messageMachineStateOf(record),
      { type: 'archive_wait_disposed' },
      archiveCtx(TRANSFER_CHOICE, { responseAccepted: true }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('busy');
    expect('effects' in result).toBe(false);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('UT25 cancelling the wait records the cancel disposition and leaves the response empty', () => {
    const next = nextSessionMessageRecord(READ, CANCEL);
    expect(next.archiveWaitDisposition).toEqual({
      kind: 'cancel', runRef: RUN_R0, archiveSessionRef: SESSION_S, archiveRequestId: 'a', recordedAt: T0,
    });
    expect(next.response).toBeNull();
    expect(next.status).toBe(READ.status);
    expect(next.revision).toBe(READ.revision + 1);
    // A cancel keeps the original handler (here: none).
    expect(next.replyHandler ?? null).toBeNull();
  });
});
