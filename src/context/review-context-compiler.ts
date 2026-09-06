/**
 * ContextCompiler REVIEW extension — ReviewContextPort implementation (P1-04
 * first consumer freeze). ENTRY FILE (shared baseline — signature FROZEN;
 * lane C fills the implementation). The P1-03 frozen
 * assemble(TaskContextRequestV1) in src/context/context-compiler.ts is NOT
 * touched — this is a VERSIONED extension in its own file.
 *
 * Frozen surface (see src/contracts/review-context.ts):
 *   - assemble(ReviewContextRequestV1) -> ready(packet+bundleRef+manifest) /
 *     needs_material / rejected;
 *   - bounded ReviewPacket (material count, per-material summary, packet bytes;
 *     NO full transcript), body-first in the ArtifactVault;
 *   - stale-binding / forbidden scope / stale workspace / budget / caps / out
 *     of scope -> structured rejection (zero write except the vault put);
 *   - never starts a Reviewer/Agent; reviewer WORK is a formal dispatch Run.
 */
import type { StateLedger } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { ReviewContextPort, ReviewContextRequestV1, ReviewContextResultV1 } from "../contracts/review-context.js";

export type ReviewContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  now: () => string;
};

export class ReviewContextCompilerImpl implements ReviewContextPort {
  constructor(private readonly deps: ReviewContextCompilerDeps) {}

  async assemble(request: ReviewContextRequestV1): Promise<ReviewContextResultV1> {
    throw new Error("P1-04 review-context-compiler: not implemented yet");
  }
}

export function createReviewContextCompiler(deps: ReviewContextCompilerDeps): ReviewContextCompilerImpl {
  return new ReviewContextCompilerImpl(deps);
}
