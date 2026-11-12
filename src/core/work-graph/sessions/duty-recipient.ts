/**
 * The one duty recipient resolver.
 *
 * The scribe arm is the old closure exactly (A-20): page the directory to its end, keep `lifecycle === 'active'`
 * cards whose fixed duty is `scribe`, sort by `sessionId`, return the first. It has no health filter, so an
 * unavailable scribe is still returned. `adviser`/`secretary` use the same active + duty filter; a rejected read, or
 * an `unknown` answer from a `role_spec` (which cannot be told apart from a failed read), makes those arms
 * `unavailable` (the card cannot be proven to be another duty), never "no recipient". The scribe arm returns a
 * non-ready duty read unchanged; a `legacy_template` that answers
 * `unknown` genuinely has no fixed duty and is skipped. The scribe arm skips every such card. A failed `findSessions`
 * page is returned unchanged.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { SessionDirectoryPort } from '../model/session-contracts.js';
import { plainSessionRef } from './session-record-codecs.js';

export type DutyRecipientDependencies = {
  findSessions: SessionDirectoryPort['findSessions'];
  dutyOfRole: (ctx: CoreCallContext, role: RoleConfigurationRef) => Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;
};
export interface DutyRecipientPort {
  /** A scope without `workspaceId` reads the whole project; only `reviewLineOf` asks that, to name a missing line. */
  resolveDutyRecipient(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope | ProjectScope; duty: 'adviser' | 'secretary' | 'scribe' | 'reviewer';
  }): Promise<ReadResult<SessionRef | null>>;
}

/** Where a workspace's exec review goes: its own line, a line only elsewhere in the project, or none at all. */
export type ReviewLineV1 =
  | { kind: 'here'; line: SessionRef }
  | { kind: 'other_workspace' }
  | { kind: 'none' };

/**
 * The exec review's one review-line decision (Workflow's `readReviewState` and the no-line notice both read it): the
 * round's own workspace first; without a line there, one project-wide read only names the reason. A line elsewhere
 * is never sent to — joined-workspace exec review is not connected yet (a known limit: the message and its Query
 * would live in the line's workspace, not the round's). A failed read is returned unchanged.
 */
export async function reviewLineOf(port: Pick<DutyRecipientPort, 'resolveDutyRecipient'>, ctx: CoreCallContext,
  workspace: WorkspaceScope): Promise<ReadResult<ReviewLineV1>> {
  const here = await port.resolveDutyRecipient(ctx, { workspace, duty: 'reviewer' });
  if (here.status !== 'ready') return here;
  if (here.value !== null) return { status: 'ready', value: { kind: 'here', line: here.value } };
  const project = await port.resolveDutyRecipient(ctx,
    { workspace: { projectId: workspace.projectId }, duty: 'reviewer' });
  if (project.status !== 'ready') return project;
  return { status: 'ready', value: { kind: project.value === null ? 'none' : 'other_workspace' } };
}

export function createDutyRecipient(deps: DutyRecipientDependencies): DutyRecipientPort {
  return {
    async resolveDutyRecipient(ctx, input) {
      const found: SessionRef[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await deps.findSessions(ctx, { workspace: input.workspace, includeArchived: false,
          page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
        if (page.status !== 'ready') return page;
        for (const card of page.value.items) {
          if (card.record.lifecycle !== 'active') continue;
          const duty = await deps.dutyOfRole(ctx, card.record.role);
          if (input.duty === 'scribe') {
            // The scribe branch never shortens the list on a failed read: the non-ready result is the answer.
            if (duty.status !== 'ready') return duty;
            if (duty.value === 'scribe') found.push(plainSessionRef(card.record.ref));
            continue;
          }
          if (duty.status !== 'ready') {
            const detail = duty.status === 'rejected' ? duty.reason : `the card's duty read was ${duty.status}`;
            return rejected('unavailable', `a Session card's duty could not be read: ${detail}`);
          }
          if (duty.value === 'unknown') {
            // A legacy platform template genuinely has no fixed duty. A `role_spec` that answers `unknown` cannot be
            // told apart from a failed read, so that arm stays `unavailable`.
            if (card.record.role.kind === 'legacy_template') continue;
            return rejected('unavailable', `a Session card's duty could not be read: no fixed platform duty`);
          }
          if (duty.value === input.duty) found.push(plainSessionRef(card.record.ref));
        }
        if (page.value.nextCursor === null) break;
        cursor = page.value.nextCursor;
      }
      if (found.length === 0) return { status: 'ready', value: null };
      found.sort((left, right) => left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0);
      return { status: 'ready', value: found[0]! };
    },
  };
}
