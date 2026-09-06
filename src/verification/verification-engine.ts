/**
 * VerificationEngine — P1-04 VerificationPort implementation (first consumer
 * freeze). ENTRY FILE (shared baseline — exported signature FROZEN; lane B
 * fills the implementation).
 *
 * Frozen surface:
 *   - verify(request) -> ready { plan, observations, verificationPlanRef } /
 *     incomplete (missing material) / rejected (deterministic codes);
 *   - compileVerificationPlan is the PURE content-addressed planner in
 *     src/contracts/verification.ts — the engine resolves canonical facts
 *     (goal/plan/workspace/pins/policy) and delegates to it; never falls back
 *     to built-in defaults;
 *   - CheckPort registry: static/dynamic predicate checks run through the
 *     ports; the deterministic providers (contracts/testing) are the only P1-04
 *     implementations; reviewer-layer checks are NOT executed here — they
 *     produce review-packet / fast-path plan entries;
 *   - the engine NEVER writes the ledger; observations are drafts for the
 *     evidence-intake command.
 */
import type { StateLedger } from "../contracts/ledger.js";
import type { VerificationPort } from "../contracts/verification.js";
import type { ReviewerPort, CheckPort } from "../contracts/verification.js";
import type { VerificationRequestV1, VerificationResultV1 } from "../contracts/verification.js";

export type VerificationEngineDeps = {
  ledger: StateLedger;
  now: () => string;
};

export class VerificationEngineImpl implements VerificationPort {
  constructor(
    private readonly deps: VerificationEngineDeps,
    private readonly checkPorts: CheckPort[],
    private readonly reviewer: ReviewerPort,
  ) {}

  async verify(request: VerificationRequestV1): Promise<VerificationResultV1> {
    throw new Error("P1-04 verification-engine: not implemented yet");
  }
}

export function createVerificationEngine(
  deps: VerificationEngineDeps,
  checkPorts: CheckPort[],
  reviewer: ReviewerPort,
): VerificationEngineImpl {
  return new VerificationEngineImpl(deps, checkPorts, reviewer);
}
