/**
 * The one project-notice decision (pure): the operation identity, the record id derived from it, and the record
 * shape the R2 writer commits. `ProjectNotice@1`'s field table and codec are the role-line codecs' (G1-1); this file
 * only decides whether a notice may be written and what its unbound fields are.
 *
 * The record id IS the operation identity, so a replay of the same operation writes nothing new and a changed payload
 * under the same identity is R2's `idempotency_conflict`. The writer's stored position is its bound `since`; nothing
 * here reads a clock.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { DecisionSubjectV1 } from '../../../contracts/goal-decisions.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ProjectScope } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  PROJECT_NOTICE_KINDS,
  type NotifyProjectInputV1, type ProjectNoticeKindV1, type ProjectNoticeV1,
} from '../../../contracts/role-lines.js';

/** The project notice's identity: the project subject, the kind and the operation that caused it. */
export function projectNoticeIdentity(input: { subject: DecisionSubjectV1; kind: ProjectNoticeKindV1;
  operation: OperationRef }): { noticeId: string; commandId: string } {
  const digest = sha256Hex(canonicalJson({ subjectKey: canonicalJson(input.subject as unknown as JsonValue),
    kind: input.kind, operation: input.operation } as unknown as JsonValue));
  return { noticeId: digest, commandId: `project-notice:${digest}` };   // the record id IS the operation identity
}

export type ProjectNoticeForCommitV1 = { input: NotifyProjectInputV1 };

/** The pre-bind notice: `since` comes from the commit that writes it, never from this decision. */
export type ProjectNoticeDraftV1 = { ref: { aggregateType: 'ProjectNotice'; projectId: string; noticeId: string };
  subject: DecisionSubjectV1; kind: ProjectNoticeKindV1; summary: string; operation: OperationRef };

/** One record per operation identity: R2 replays the same command; a second record is its absence CAS's conflict. */
export function projectNoticeNext(facts: ProjectNoticeForCommitV1):
  { refuse: CoreRejection } | { decision: ProjectNoticeDraftV1 } {
  const { input } = facts;
  const summary = typeof input.summary === 'string' ? input.summary : '';
  if (summary.length === 0 || Buffer.byteLength(summary, 'utf8') > 512) {
    return { refuse: rejected('invalid', 'a project notice summary is 1..512 UTF-8 bytes') };
  }
  if (!PROJECT_NOTICE_KINDS.includes(input.kind)) {
    return { refuse: rejected('invalid', 'the project notice kind is not recognized') };
  }
  const subject: DecisionSubjectV1 = { kind: 'project', projectRef: { ...input.projectRef } };
  if (input.operation.projectId !== input.projectRef.projectId) {
    return { refuse: rejected('invalid', 'a project notice operation must be this project') };
  }
  const { noticeId } = projectNoticeIdentity({ subject, kind: input.kind, operation: input.operation });
  return { decision: { ref: { aggregateType: 'ProjectNotice', projectId: input.projectRef.projectId, noticeId },
    subject, kind: input.kind, summary,
    operation: { ...input.operation } } };
}

/** The pending record: its `since` is filled by the commit that writes it and its revision starts at 1. */
export type ProjectNoticePendingV1 = Omit<ProjectNoticeV1, 'since'> & { since: null };

export const projectNoticePending = (draft: ProjectNoticeDraftV1): ProjectNoticePendingV1 =>
  ({ ...draft, since: null, revision: 1 });

/** The replay projection: the bound cursor comes from the receipt, never a current read. */
export const projectNoticeBound = (draft: ProjectNoticeDraftV1, since: CommitCursor): ProjectNoticeV1 =>
  ({ ...draft, since, revision: 1 });
