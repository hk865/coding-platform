import type { StateLedger } from '../../contracts/ledger.js';
import type { CandidateArchitectureBaselineRef, CandidateArchitectureBaselineSnapshot, CandidateArchitectureBaselineV1 } from '../../contracts/baseline-evolution.js';
import type { VerificationMigrationContextPort } from '../../contracts/verification-context.js';
import { resolveProjectArchitectureBaseline } from '../state-ledger/governance-records.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
/** Resolves current source facts; pass/fail/stale decisions remain in Verification. */
export class VerificationMigrationContextCompiler implements VerificationMigrationContextPort {
  constructor(private readonly deps: {
    ledger: StateLedger;
  }) { }
  async migrationCandidate(ref: CandidateArchitectureBaselineRef) {
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'CandidateArchitectureBaseline')
      return null;
    return (loaded.snapshot as CandidateArchitectureBaselineSnapshot).candidate;
  }
  async migrationBasis(candidate: CandidateArchitectureBaselineV1) {
    const source = await resolveProjectArchitectureBaseline(this.deps.ledger, candidate.projectId);
    if (source.status !== 'found' || canonicalJson(source.pin) !== canonicalJson(candidate.parentSourcePin)) {
      return { activeSourcePin: source.status === 'found' ? source.pin : null, workspaceRevision: null };
    }
    const workspace = await this.deps.ledger.load({ aggregateType: 'Workspace', projectId: candidate.projectId, workspaceId: candidate.workspaceId });
    return {
      activeSourcePin: source.pin,
      workspaceRevision: workspace.status === 'found' && workspace.snapshot.ref.aggregateType === 'Workspace' ? workspace.snapshot.revision : null,
    };
  }
}
