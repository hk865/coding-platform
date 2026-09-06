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
import type { StateLedger } from "../contracts/ledger.js";
import type {
  BaselineEvolutionPort,
  CandidateArchitectureBaselineV1,
  RecordMaterializeResult,
} from "../contracts/baseline-evolution.js";
import type { AggregateSnapshot } from "../contracts/ledger.js";
import type { ArchitectureCandidateProposalSnapshot } from "../contracts/architecture-inspection.js";
import { candidateContentDigest, candidateIdFromDigest } from "../contracts/baseline-evolution.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import { resolveProjectArchitectureBaseline } from "../contracts/governance.js";

export type BaselineEvolutionPortDeps = {
  ledger: StateLedger;
  now: () => string;
};

export type BaselineEvolutionProposalRef = {
  aggregateType: "ArchitectureCandidateProposal";
  projectId: string;
  workspaceId: string;
  proposalId: string;
};

function isProposalSnapshot(s: AggregateSnapshot): s is ArchitectureCandidateProposalSnapshot {
  return s.ref.aggregateType === "ArchitectureCandidateProposal";
}

export class BaselineEvolutionPortImpl implements BaselineEvolutionPort {
  constructor(private readonly deps: BaselineEvolutionPortDeps) {}

  async materialize(proposalRef: BaselineEvolutionProposalRef): Promise<RecordMaterializeResult> {
    // -- 1. The proposal must exist.
    const proposalResult = await this.deps.ledger.load(proposalRef);
    if (proposalResult.status !== "found" || !isProposalSnapshot(proposalResult.snapshot)) {
      return {
        status: "rejected",
        code: "proposal_not_found",
        message: "proposal not found",
      };
    }
    const proposal = proposalResult.snapshot.proposal;

    // -- 2. Project active baseline must EQUAL the proposal source, else the
    //        source moved and the candidate cannot be requested/activated.
    const sourceResolve = await resolveProjectArchitectureBaseline(this.deps.ledger, proposal.projectId);
    if (
      sourceResolve.status !== "found" ||
      canonicalJson(sourceResolve.pin) !== canonicalJson(proposal.sourceBaselinePin)
    ) {
      return {
        status: "rejected",
        code: "source_stale",
        message:
          sourceResolve.status !== "found"
            ? "project active baseline unavailable; proposal source is stale"
            : "project active baseline != proposal source; candidate is stale",
      };
    }

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
      normalizedContent: {
        description: proposal.normalizedContent.description,
        constraints: proposal.normalizedContent.constraints.map((c) => ({ ...c })),
      },
      contentDigest: digest,
      materializedAt: this.deps.now(),
    };

    return { status: "materialized", candidate };
  }
}

export function createBaselineEvolutionPort(deps: BaselineEvolutionPortDeps): BaselineEvolutionPortImpl {
  return new BaselineEvolutionPortImpl(deps);
}
