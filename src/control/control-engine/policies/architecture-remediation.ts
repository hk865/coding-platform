/** Control-owned deterministic domain policy. */
import type { ArchitectureFindingV1 } from "../../../contracts/architecture-inspection.js";
import type { ArchitectureEvolutionPolicyContentV1, EvolutionPolicyDecisionContext, EvolutionPolicyDecision } from "../../../contracts/architecture-evolution-policy.js";



export function evolutionPolicyDecision(
  finding: ArchitectureFindingV1,
  content: ArchitectureEvolutionPolicyContentV1,
  ctx: EvolutionPolicyDecisionContext,
): EvolutionPolicyDecision {
  const reasons: string[] = [];
  if (finding.material || finding.ambiguous) {
    reasons.push("material_or_ambiguous_finding_requires_decision_brief");
    return { allowed: false, reasons };
  }
  if (finding.deltaRef === null) {
    reasons.push("finding_has_no_delta_ref_report_only");
    return { allowed: false, reasons };
  }
  if (content.driftBudget.maxRemediationsPerCycle <= 0 || ctx.remediationCountThisCycle >= content.driftBudget.maxRemediationsPerCycle) {
    reasons.push("drift_budget_exhausted");
    return { allowed: false, reasons };
  }
  const entry = content.allowlist.find((e) => e.findingCategory === finding.category);
  if (entry === undefined) {
    reasons.push("category_not_in_allowlist");
    return { allowed: false, reasons };
  }
  const rank = { high: 3, medium: 2, low: 1 } as const;
  if (rank[finding.risk] > rank[entry.maxRisk]) {
    reasons.push("risk_exceeds_allowlist_max");
    return { allowed: false, reasons };
  }
  if (entry.reversibility !== "reversible") {
    reasons.push("not_reversible_in_allowlist");
    return { allowed: false, reasons };
  }
  const scopeHit =
    (entry.scope === "module" && finding.affectedRefs.moduleRefs.length > 0) ||
    (entry.scope === "interface" && finding.affectedRefs.interfaceRefs.length > 0) ||
    (entry.scope === "runtime" && finding.affectedRefs.pathRefs.length > 0) ||
    (entry.scope === "governance" && finding.category === "governance");
  if (!scopeHit) {
    reasons.push("scope_not_matched");
    return { allowed: false, reasons };
  }
  return { allowed: true, reasons: [] };
}