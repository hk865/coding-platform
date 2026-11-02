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
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
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
  resolveDutyRecipient(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; duty: 'adviser' | 'secretary' | 'scribe';
  }): Promise<ReadResult<SessionRef | null>>;
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
