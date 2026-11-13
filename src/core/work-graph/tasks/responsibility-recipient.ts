/** The one responsibility recipient read (7D2 O4b, v4 §5.2 (a), book :575–:580): with a technical module the
 *  narrowest effective region adviser first, then the Goal's open responsible adviser link, then the asker's
 *  effective creator, then the person. One read; no cache; it never writes `creator` and never falls back to a
 *  secretary or a platform Session. The send site writes the copy, the resolver only names it. */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { ROLE_LINE_DUTIES } from '../../../contracts/role-lines.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { RoleLineAllocationReadPort } from '../model/session-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { readEffectiveRegionAdviser, readOpenResponsibilityLines } from './plan-readers.js';

export type ResponsibilityRecipientInputV1 = {
  projectId: string;
  goalRef: GoalRef | null;
  moduleRef: ModuleRef | null;
  kind: 'general' | 'technical';
  asker: SessionRef | null;        // null = a platform system round: no creator arm, no copy
};
export type ResponsibilityRecipientV1 =
  | { kind: 'session'; session: SessionRef; copy: SessionRef | null }
  | { kind: 'human' };

export interface ResponsibilityRecipientPort {
  resolveResponsibilityRecipient(ctx: CoreCallContext, input: ResponsibilityRecipientInputV1):
    Promise<ReadResult<ResponsibilityRecipientV1>>;
}

export type ResponsibilityRecipientDependenciesV1 = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  duty: SessionDutyReadPort;
  catalog: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;   // the one current catalog
  allocation: RoleLineAllocationReadPort;                              // the holder's derived `creator` contact
};

export function createResponsibilityRecipient(
  deps: ResponsibilityRecipientDependenciesV1,
): ResponsibilityRecipientPort {
  /** v4 :5381–:5386: the asker's holder entry in the one allocation report (7D1's derived contact); only a
   *  `session` contact answers — human, platform, lapsed and unknown are the person arm (`null`). */
  async function effectiveCreatorOf(ctx: CoreCallContext, asker: SessionRef): Promise<ReadResult<SessionRef | null>> {
    const report = await deps.allocation.readRoleLineAllocation(ctx, {});
    if (report.status !== 'ready') return report;
    for (const duty of ROLE_LINE_DUTIES) {
      const holder = report.value.duties[duty].holders.find((entry) =>
        entry.session.projectId === asker.projectId && entry.session.sessionId === asker.sessionId);
      if (holder !== undefined) {
        return { status: 'ready', value: holder.creator.kind === 'session' ? holder.creator.session : null };
      }
    }
    return { status: 'ready', value: null };
  }

  return {
    async resolveResponsibilityRecipient(ctx, input) {
      // technical: the narrowest effective region first; only an empty region falls back to the Goal adviser.
      let recipient: SessionRef | null = null;
      if (input.kind === 'technical' && input.moduleRef !== null) {
        const catalogRead = await deps.catalog.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
        if (catalogRead.status !== 'ready' && catalogRead.status !== 'not_found') return catalogRead;
        const region = await readEffectiveRegionAdviser(deps.records, ctx, {
          projectId: input.projectId, moduleRef: input.moduleRef,
          catalog: catalogRead.status === 'ready' ? catalogRead.value.catalog.catalog : null,
        }, deps.duty);
        if (region.status !== 'ready') return region;
        recipient = region.value?.session ?? null;
      }

      if (recipient === null && input.goalRef !== null) {
        const lines = await readOpenResponsibilityLines(deps.records, ctx, { goalRef: input.goalRef }, deps.duty);
        if (lines.status !== 'ready') return lines;
        recipient = lines.value.find((line) => line.duty === 'adviser')?.session ?? null;
      }

      const creatorRead = input.asker === null ? null : await effectiveCreatorOf(ctx, input.asker);
      if (creatorRead !== null && creatorRead.status !== 'ready') return creatorRead;
      const creator = creatorRead === null ? null : creatorRead.value;
      recipient ??= creator;
      if (recipient === null) return { status: 'ready', value: { kind: 'human' } };
      const copy = creator !== null && creator.sessionId !== recipient.sessionId ? creator : null;
      return { status: 'ready', value: { kind: 'session', session: recipient, copy } };
    },
  };
}
