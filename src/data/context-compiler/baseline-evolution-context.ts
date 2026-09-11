import type { BaselineEvolutionContextPort, BaselineProposalRef } from '../../contracts/architecture-context.js';
import type { StateLedger } from '../../contracts/ledger.js';
import type { ArchitectureCandidateProposalSnapshot } from '../../contracts/architecture-inspection.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { resolveProjectArchitectureBaseline } from '../state-ledger/governance-records.js';

/** Loads the proposal with its exact current source; materialization remains in
 * ArchitectureReconciler and activation guards remain in Control. */
export class BaselineEvolutionContextCompiler implements BaselineEvolutionContextPort {
  constructor(private readonly ledger: StateLedger) {}
  async assemble(proposalRef: BaselineProposalRef) {
    const loaded = await this.ledger.load(proposalRef);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'ArchitectureCandidateProposal') {
      return { status: 'rejected' as const, code: 'proposal_not_found' as const, message: 'proposal not found' };
    }
    const proposal = (loaded.snapshot as ArchitectureCandidateProposalSnapshot).proposal;
    const source = await resolveProjectArchitectureBaseline(this.ledger, proposal.projectId);
    if (source.status !== 'found' || canonicalJson(source.pin) !== canonicalJson(proposal.sourceBaselinePin)) {
      return { status: 'rejected' as const, code: 'source_stale' as const, message: source.status !== 'found'
        ? 'project active baseline unavailable; proposal source is stale'
        : 'project active baseline != proposal source; candidate is stale' };
    }
    return { status: 'ready' as const, proposal: structuredClone(proposal) };
  }
}
