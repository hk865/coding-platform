/**
 * L8 (book ruling 12; interface §7; ruling 4 cancellation): the one assembler
 * reminder read.
 *
 * It resolves the CURRENT formal catalog revision first, then hands that exact
 * `AdoptedArchitecture` (or `null` when the project has no active catalog) to
 * the observation service, which loads the state and the two observations once.
 * A catalog read that is neither `ready` nor `not_found` is returned as-is; no
 * reminder row is ever rendered from a failed read. After every await the
 * caller's signal wins: an abort returns `cancelled`, never a ready/failed row.
 */
import type { ArchitectureReminderReadPort } from '../core/agent-runtime/context-assembler.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import type { ObservedArchitecturePort } from '../core/work-graph/architecture/contracts.js';
import type { CoreRejection } from '../contracts/core/results.js';

export function createArchitectureReminderFactsReader(deps: {
  catalog: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  observed: Pick<ObservedArchitecturePort, 'readReminderFacts'>;
}): ArchitectureReminderReadPort {
  return {
    async read(ctx, workspace) {
      const cancelled = (): CoreRejection =>
        ({ status: 'rejected', code: 'cancelled', reason: 'the architecture reminder read was cancelled' });
      const revision = await deps.catalog.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
      if (ctx.signal.aborted) return cancelled();
      if (revision.status === 'not_found') {
        const facts = await deps.observed.readReminderFacts(ctx, { workspace, catalog: null });
        if (ctx.signal.aborted) return cancelled();
        return facts;
      }
      if (revision.status !== 'ready') return revision;
      const facts = await deps.observed.readReminderFacts(ctx, {
        workspace,
        catalog: revision.value.catalog?.catalog ?? null,
      });
      if (ctx.signal.aborted) return cancelled();
      return facts;
    },
  };
}
