import type {
  ArchitectureChangeDecisionRef,
  ArchitectureChangeDecisionV1,
  BaselineActivationRef,
  BaselineActivationV1,
  BaselineChangeViewResult,
  CandidateArchitectureBaselineSnapshot,
  MigrationGateTaskRef,
  MigrationGateTaskV1,
} from "../../contracts/baseline-evolution.js";
import { isSourceStale } from "../../contracts/baseline-evolution.js";
import type { CommitCursor } from "../../contracts/command-event.js";
import type { ArchitectureBaselinePin } from "../../contracts/governance.js";
import type { PlanRevisionRef } from "../../contracts/plan.js";

/**
 * BaselineChangeView pure projection (single implementation).
 *
 * The in-memory ReadModel and the SQLite ReadModel previously carried two
 * byte-identical copies of this derivation (95 normalized lines, verified by
 * normalized comparison). Two copies of an explanation rule can drift silently,
 * so the pure part lives here once, following the existing
 * `reviewer-projection.ts` precedent.
 *
 * This function performs NO I/O and reads NO cursor state: each adapter fetches
 * and sorts its own rows (that part legitimately differs by backend) and passes
 * them in already sorted ascending, together with the cursor it already read.
 * Row ordering and cursor freshness therefore stay owned by each adapter, while
 * the explanation semantics are shared and covered by both backends' tests.
 */
export function projectBaselineChangeView(input: {
  candidateRows: CandidateArchitectureBaselineSnapshot[];
  decisionRows: { ref: ArchitectureChangeDecisionRef; decision: ArchitectureChangeDecisionV1 }[];
  gateRows: { ref: MigrationGateTaskRef; gate: MigrationGateTaskV1 }[];
  activationRows: { ref: BaselineActivationRef; activation: BaselineActivationV1 }[];
  observedCursor: CommitCursor;
}): BaselineChangeViewResult {
  const { candidateRows, decisionRows, gateRows, activationRows, observedCursor } = input;

  const latestCandidate =
    candidateRows.length === 0 ? null : candidateRows[candidateRows.length - 1]!;
  const latestDecision =
    decisionRows.length === 0 ? null : decisionRows[decisionRows.length - 1]!;
  const latestGate = gateRows.length === 0 ? null : gateRows[gateRows.length - 1]!;
  const latestActivation =
    activationRows.length === 0 ? null : activationRows[activationRows.length - 1]!;

  // defaultPin = latest activation's toPin; before any activation the default is
  // still the candidate's source pin (this view serves the post-activation
  // explanation: who authorized / gate evidence / which plans are not yet
  // rebased). With neither activation nor candidate we cannot claim the view.
  let defaultPin: ArchitectureBaselinePin;
  if (latestActivation !== null) {
    defaultPin = latestActivation.activation.toPin;
  } else if (latestCandidate !== null) {
    defaultPin = latestCandidate.candidate.parentSourcePin;
  } else {
    return { status: "not_found" };
  }

  // Authoritative chain: when an activation exists, follow it to the exact
  // gate / decision / candidate it records; otherwise fall back to the latest
  // of each type (pre-activation state).
  let candidate = latestCandidate;
  let decision = latestDecision;
  let gate = latestGate;
  if (latestActivation !== null) {
    gate =
      gateRows.find((g) => g.ref.gateId === latestActivation.activation.gateRef.gateId) ??
      latestGate;
    decision =
      decisionRows.find((d) => d.ref.decisionId === latestActivation.activation.decisionRef.decisionId) ??
      latestDecision;
    if (gate !== null) {
      const g = gate;
      candidate =
        candidateRows.find((c) => c.ref.candidateId === g.gate.candidateRef.candidateId) ??
        candidate;
    }
    if (candidate === null && decision !== null) {
      const d = decision;
      candidate =
        candidateRows.find((c) => c.ref.candidateId === d.decision.subject.candidateRef.candidateId) ??
        null;
    }
  }

  // gate stale = the candidate it derives from is stale OR the gate is stale.
  let gateStale: boolean | null = null;
  if (gate !== null) {
    const g = gate;
    const relatedCandidate =
      candidateRows.find((c) => c.ref.candidateId === g.gate.candidateRef.candidateId) ??
      null;
    const relatedCandidateStale =
      relatedCandidate === null
        ? false
        : isSourceStale(relatedCandidate.candidate.parentSourcePin, defaultPin);
    gateStale = relatedCandidateStale || g.gate.status === "stale";
  }

  // notRebasedPlans: the migration gate's planRef names ONE still-pinned plan;
  // report it once an activation exists (post-activation evidence).
  const notRebasedPlans: { planRef: PlanRevisionRef; pinnedBaselinePin: ArchitectureBaselinePin }[] = [];
  if (latestActivation !== null && gate !== null && gate.gate.planRef !== "") {
    notRebasedPlans.push({
      planRef: { aggregateType: "PlanRevision", projectId: gate.gate.projectId, planId: gate.gate.planRef },
      pinnedBaselinePin: latestActivation.activation.fromPin,
    });
  }

  return {
    status: "ready",
    defaultPin,
    candidate:
      candidate === null
        ? null
        : { ...candidate, stale: isSourceStale(candidate.candidate.parentSourcePin, defaultPin) },
    decision:
      decision === null
        ? null
        : { ...decision.decision, ref: decision.ref, stale: isSourceStale(decision.decision.authorizedTarget.fromPin, defaultPin) },
    gate: gate === null ? null : { ...gate.gate, ref: gate.ref, stale: gateStale ?? false },
    activation:
      latestActivation === null
        ? null
        : { ...latestActivation.activation, ref: latestActivation.ref },
    notRebasedPlans,
    freshness: observedCursor,
  };
}
