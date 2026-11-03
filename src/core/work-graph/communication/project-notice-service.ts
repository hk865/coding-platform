/**
 * The project notice's one trusted writer: `notifyProject` is platform-originated (a fixed system actor, the
 * subject's project, `workspaceId: null`) and takes no caller and no `ctx`. The subject is the caller's Goal or
 * project (absent: the project). Its identity is the (subject, kind, operation), so a replay returns the recorded
 * notice and a changed payload under the same identity is R2's `idempotency_conflict`; its own refusals are
 * `invalid` (empty/oversized summary, unknown kind, an operation or a subject of another project).
 *
 * The record and event formats are `ProjectNotice@1`/`ProjectNoticeCreated@1` (the role-line codecs); the pure
 * decision is `state/project-notice.ts`. Nothing here reads a clock for identity and nothing projects a current
 * position: the bound `since` comes from the receipt.
 */
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { InferEvent } from '../../../contracts/data-format.js';
import { ProjectNoticeCreatedFormat } from '../../../contracts/role-lines.js';
import type { NotifyProjectInputV1, ProjectNoticeV1 } from '../../../contracts/role-lines.js';
import type { DecisionSubjectV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { projectNoticeCreatedCodec, projectNoticeCodec } from '../sessions/role-line-record-codecs.js';
import { eventIdOf } from '../sessions/trusted-context.js';
import { executeWriteCommand, type WriteCommand } from '../persistence/command-executor.js';
import {
  projectNoticeBound, projectNoticeIdentity, projectNoticeNext, projectNoticePending,
  type ProjectNoticeDraftV1, type ProjectNoticeForCommitV1,
} from '../state/project-notice.js';

export type ProjectNoticeDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  now: () => string;
};

type ProjectNoticeCreatedEventV1 = InferEvent<'ProjectNoticeCreated', (typeof ProjectNoticeCreatedFormat)['fields']>;

/** The fixed platform principal (`hostScopeContext`/`reconcileContext`'s shape), project-scoped: no person, no
 *  Session, no secretary. */
const PROJECT_NOTICE_PRINCIPAL = { kind: 'host', actor: { kind: 'system', id: 'workflow:project-notice' } } as const;

export async function notifyProject(deps: ProjectNoticeDependencies, input: NotifyProjectInputV1):
  Promise<WriteResult<ProjectNoticeV1>> {
  // The caller's subject is a Goal or the project; absent, the notice belongs to the project.
  const subject: DecisionSubjectV1 = structuredClone(input.subject
    ?? { kind: 'project', projectRef: input.projectRef });
  // A JSON caller can omit `kind`; the pure decision's refusal comes before the identity, because the identity
  // fingerprints `kind` and would fail on an undefined value before reaching that refusal.
  if (input.kind === undefined) {
    const decided = projectNoticeNext({ input });
    if ('refuse' in decided) return decided.refuse;
  }
  if (subject.kind === 'project' && subject.projectRef.projectId !== input.projectRef.projectId) {
    return rejected('invalid', 'a project notice subject must be this project');
  }
  if (subject.kind === 'goal' && subject.goalRef.projectId !== input.projectRef.projectId) {
    return rejected('invalid', 'a goal notice subject must belong to this project');
  }
  const { noticeId, commandId } = projectNoticeIdentity({ subject, kind: input.kind, operation: input.operation });
  const scope = { projectId: input.projectRef.projectId, workspaceId: null };   // the record is project-wide
  const command: WriteCommand<ProjectNoticeForCommitV1, ProjectNoticeDraftV1, CoreRejection, ProjectNoticeCreatedEventV1,
    ProjectNoticeV1> = {
    operation: 'projectNotice.create', scope, principal: PROJECT_NOTICE_PRINCIPAL, commandId,
    fingerprintInput: { subject, kind: input.kind, summary: input.summary, operation: input.operation },
    read: async () => ({ status: 'ready', facts: { input } }),   // no record pre-read: R2 replays; the CAS refuses
    decide: (facts) => {
      const decided = projectNoticeNext(facts);
      return 'refuse' in decided ? { refuse: decided.refuse } : { decision: decided.decision };
    },
    build: (draft, keys) => {
      const at = deps.now();
      const event = projectNoticeCreatedCodec.encode({ eventId: eventIdOf(keys.identityKey, 'created'), schemaVersion: 1,
        occurredAt: at, eventType: 'ProjectNoticeCreated', projectId: draft.ref.projectId, workspaceId: null,
        notice: { ref: draft.ref, subject: draft.subject, kind: draft.kind, summary: draft.summary,
          operation: draft.operation } });                                     // the PRE-BIND notice: no `since`
      const pending = projectNoticeCodec.encode(projectNoticePending(draft));
      return { records: [pending], events: [event], guards: [{ refKey: pending.refKey, expectedRevision: null }],
        claims: [], commitCursorBindings: [{ refKey: pending.refKey, field: 'since' as const }] };
    },
    result: { eventType: 'ProjectNoticeCreated', schemaVersion: 1,
      decode: (event) => projectNoticeCreatedCodec.decode(event),
      validate: (event, receipt, keys) => event.projectId === scope.projectId && String(receipt.identityKey) === keys.identityKey
        ? null : 'the recorded notice disagrees with this commit',
      project: (event, cursor) => projectNoticeBound(event.notice, cursor) },   // the cursor is the RECEIPT's, not a read
  };
  const written = await executeWriteCommand(deps.records, command);
  return written.status === 'refused' ? written.refusal : written;
}
