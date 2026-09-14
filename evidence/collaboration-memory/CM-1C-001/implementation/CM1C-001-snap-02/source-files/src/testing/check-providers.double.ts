/**
 * Deterministic check-provider doubles and the Reviewer capability double.
 * Explicit harness defaults; production command checks use their own provider.
 * Determinism: the same ctx/checkId always
 * yields the same outcome (results keyed on diffClass — table-testable).
 */
import type {
  CheckCapabilityV1,
  CheckContextV1,
  CheckOutcomeV1,
  CheckPort,
  ReviewerCapabilities,
  ReviewerPort,
} from "../contracts/verification.js";
import { REVIEWER_MAX_PACKET_BYTES } from "../contracts/verification.js";

export const STATIC_CHECK_ID = "static-check-lint";
export const DYNAMIC_CHECK_ID = "dynamic-check-tests";
export const NO_CHANGE_PROOF_CHECK_ID = "no-change-fast-path";

export const STATIC_CHECK_CAPABILITIES: CheckCapabilityV1[] = [
  { checkId: STATIC_CHECK_ID, kind: "static", coversKinds: ["static"], replayable: true },
];

export const DYNAMIC_CHECK_CAPABILITIES: CheckCapabilityV1[] = [
  { checkId: DYNAMIC_CHECK_ID, kind: "dynamic", coversKinds: ["dynamic"], replayable: true },
];

export class DeterministicStaticCheckProvider implements CheckPort {
  async capabilities(): Promise<CheckCapabilityV1[]> {
    return STATIC_CHECK_CAPABILITIES;
  }
  async runCheck(ctx: CheckContextV1, checkId: string): Promise<CheckOutcomeV1> {
    const result =
      ctx.changeScope.diffClass === "static-fail"
        ? ("FAIL" as const)
        : ctx.changeScope.diffClass === "static-inconclusive"
          ? ("INCONCLUSIVE" as const)
          : ("PASS" as const);
    return {
      result,
      observationId: "obs-" + checkId + "-" + result,
      summary: "deterministic " + checkId + " outcome for " + ctx.changeScope.diffClass,
      artifactRef: null,
    };
  }
}

export class DeterministicDynamicCheckProvider implements CheckPort {
  async capabilities(): Promise<CheckCapabilityV1[]> {
    return DYNAMIC_CHECK_CAPABILITIES;
  }
  async runCheck(ctx: CheckContextV1, checkId: string): Promise<CheckOutcomeV1> {
    const result =
      ctx.changeScope.diffClass === "dynamic-fail"
        ? ("FAIL" as const)
        : ctx.changeScope.diffClass === "dynamic-inconclusive"
          ? ("INCONCLUSIVE" as const)
          : ("PASS" as const);
    return {
      result,
      observationId: "obs-" + checkId + "-" + result,
      summary: "deterministic " + checkId + " outcome for " + ctx.changeScope.diffClass,
      artifactRef: null,
    };
  }
}

export const DETERMINISTIC_CHECK_PROVIDERS: CheckPort[] = [
  new DeterministicStaticCheckProvider(),
  new DeterministicDynamicCheckProvider(),
];

export class FakeReviewerPort implements ReviewerPort {
  async capabilities(): Promise<ReviewerCapabilities> {
    return {
      mode: "dispatch-run",
      maxPacketBytes: REVIEWER_MAX_PACKET_BYTES,
      noFullTranscript: true,
    };
  }
}

export const FAKE_REVIEWER_PORT = new FakeReviewerPort();
