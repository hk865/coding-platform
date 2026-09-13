import type { MemoryLedgerPort, MemoryReadResult, MemoryScope } from '../../contracts/memory.js';
/** A current, scope-bound view; stored canonical revision is its freshness marker. */
export class MemoryViewIndex {
  constructor(private readonly ledger:Pick<MemoryLedgerPort,'read'>) {}
  view(scope:MemoryScope):Promise<MemoryReadResult> {return this.ledger.read(scope);}
}
