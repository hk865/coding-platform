/**
 * P1-14 ArchitectureReconciler.BaselineEvolutionPort — deterministic candidate
 * materialization (lane B implementation).
 *
 * FROZEN surface: materialize(proposalRef) returns
 *   materialized -> { status, candidate } (candidate deterministically derived
 *     from the proposal + its EXACT source baseline; digest recomputed);
 *   needs_material -> { status, gaps } (reserved: materialization may require
 *     content/body material that this read-only port does not fetch);
 *   rejected -> proposal_not_found | source_stale | digest_mismatch |
 *     invalid_request.
 *
 * The port is READ-ONLY: it NEVER writes the ledger. The candidate record and
 * its immutable revision are committed by Control (lane A / the P1-14
 * integrator); this port only computes the candidate fact.
 *
 * Judgment mirrors lane A: load the proposal, verify the project's CURRENT
 * active baseline still equals the proposal source (else source_stale — the
 * source moved and the candidate must be re-proposed), and recompute the
 * candidate digest and check it equals the proposal's expectedCandidateDigest.
 */
import type { BaselineEvolutionContextPort } from "../../contracts/architecture-context.js";
import type {
  BaselineEvolutionPort,
  CandidateArchitectureBaselineV1,
  RecordMaterializeResult,
} from "../../contracts/baseline-evolution.js";


import { candidateContentDigest, candidateIdFromDigest } from "../../contracts/baseline-evolution.js";



export type BaselineEvolutionPortDeps = {
  context: BaselineEvolutionContextPort;
  now: () => string;
};

export type BaselineEvolutionProposalRef = {
  aggregateType: "ArchitectureCandidateProposal";
  projectId: string;
  workspaceId: string;
  proposalId: string;
};

export class BaselineEvolutionPortImpl implements BaselineEvolutionPort {
  constructor(private readonly deps: BaselineEvolutionPortDeps) {}

  async materialize(proposalRef: BaselineEvolutionProposalRef): Promise<RecordMaterializeResult> {
    const selected = await this.deps.context.assemble(proposalRef);
    if (selected.status !== 'ready') return selected;
    const proposal = selected.proposal;

    // -- 3. Recompute the candidate digest; it must equal the proposal's
    //        expectedCandidateDigest (content-addressed agreement).
    const digest = candidateContentDigest(proposal.normalizedContent);
    if (digest !== proposal.expectedCandidateDigest) {
      return {
        status: "rejected",
        code: "digest_mismatch",
        message: "candidate digest mismatch (recomputed != proposal.expectedCandidateDigest)",
      };
    }

    // -- 4. Deterministic candidate materialization from the proposal + exact
    //        source. Content is shallow-copied so the candidate is independent.
    const candidate: CandidateArchitectureBaselineV1 = {
      schemaVersion: 1,
      candidateId: candidateIdFromDigest(digest),
      projectId: proposal.projectId,
      workspaceId: proposal.workspaceId,
      proposalRef: { ...proposalRef },
      parentSourcePin: { ...proposal.sourceBaselinePin },
      normalizedContent: structuredClone(proposal.normalizedContent),
      contentDigest: digest,
      materializedAt: this.deps.now(),
    };

    return { status: "materialized", candidate };
  }
}

export function createBaselineEvolutionPort(deps: BaselineEvolutionPortDeps): BaselineEvolutionPortImpl {
  return new BaselineEvolutionPortImpl(deps);
}
