/**
 * The one duty recipient resolver.
 *
 * The scribe arm is the old closure exactly (A-20): page the directory to its end, keep `lifecycle === 'active'`
 * cards whose fixed duty is `scribe`, sort by `sessionId`, return the first. It has no health filter, so an
 * unavailable scribe is still returned. `adviser`/`secretary` use the same active + duty filter; a duty read that is
 * rejected or answers `unknown` makes those arms `unavailable` (the card cannot be proven to be another duty), never
 * "no recipient". The scribe arm skips such a card. A failed `findSessions` page is returned unchanged.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { SessionDirectoryPort } from '../model/session-contracts.js';

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
            if (duty.status === 'ready' && duty.value === 'scribe') found.push(card.record.ref);
            continue;
          }
          if (duty.status !== 'ready' || duty.value === 'unknown') {
            const detail = duty.status === 'ready' ? 'no fixed platform duty'
              : duty.status === 'rejected' ? duty.reason : `the card's duty read was ${duty.status}`;
            return rejected('unavailable', `a Session card's duty could not be read: ${detail}`);
          }
          if (duty.value === input.duty) found.push(card.record.ref);
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
