/** Shared pure inputs for the message record and codec rows; registers no tests. */
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import type { MessageRecipient, SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { MessageHostSenderRecord, MessageSecretaryRoundSenderRecord, NewSessionMessageInput } from '../../src/core/work-graph/state/message-machine.js';

const PROJECT = 'P'; const WORKSPACE = 'W'; const AT = '2026-10-25T00:00:00.000Z';
const MESSAGE_REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm-1' };
const RECIPIENT: MessageRecipient = { projectId: PROJECT, sessionId: 'S' };
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '1' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1, source: SOURCE };
const HOST: MessageHostSenderRecord = { kind: 'host', actor: { kind: 'human', id: 'operator' } };

export function s7aRecordInput(overrides: Partial<NewSessionMessageInput> = {}): NewSessionMessageInput {
  return {
    ref: MESSAGE_REF, sender: HOST, recipient: RECIPIENT, bodyRef: BODY, sourceRef: SOURCE,
    createdAt: AT, intent: null, needsReply: false, waitAfterSend: false, ...overrides,
  };
}

export const SECRETARY_SENDER: MessageSecretaryRoundSenderRecord = {
  kind: 'secretary_round', sessionRef: { projectId: PROJECT, sessionId: 'S' },
  queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'q', runId: 'r' },
  requestRoot: { aggregateType: 'QueryJob', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'q' },
  generation: 1,
};
