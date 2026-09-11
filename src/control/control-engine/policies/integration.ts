import { canonicalJson, sha256Hex } from "../../../contracts/fingerprint.js";
import type { EvidenceCoverageV1 } from "../../../contracts/evidence.js";
import { evidenceConflictKeyFor, type IntegrationInputRefV1, type EvidenceConflictFactV1, type EvidenceConflictRecordV1 } from "../../../contracts/integration.js";

/**
 * FROZEN pure detection: for every PAIR of input evidence with the same
 * coverage (obligationId, requirementId) and the same (planRevision,
 * workspaceRevision) tuple where both are APPLICABLE, outcomes differ, and
 * source runs differ -> one conflict record (deterministic order by
 * conflictKey then evidenceIds; conflictId = sha256(conflictKey + sorted
 * evidenceIds)).
 */
export function detectEvidenceConflicts(
  inputs: IntegrationInputRefV1[],
  facts: (evidenceId: string) => EvidenceConflictFactV1 | null,
  detectedAt: string,
): EvidenceConflictRecordV1[] {
  const evidenceInputs = inputs
    .map((i) => ({ input: i, fact: i.kind === "evidence" && i.evidenceRef !== null ? facts(i.evidenceRef.evidenceId) : null }))
    .filter((e): e is { input: IntegrationInputRefV1; fact: EvidenceConflictFactV1 } => e.fact !== null);
  const records: EvidenceConflictRecordV1[] = [];
  const grouped = new Map<string, EvidenceConflictFactV1[]>();
  for (const { fact } of evidenceInputs) {
    for (const c of [fact.coverage] as EvidenceCoverageV1[]) {
      const key = JSON.stringify([c.obligationId, c.requirementId, fact.planRevision, fact.workspaceRevision]);
      const list = grouped.get(key) ?? [];
      list.push({ ...fact, coverage: c });
      grouped.set(key, list);
    }
  }
  const keys = Array.from(grouped.keys()).sort();
  for (const key of keys) {
    const list = grouped.get(key)!;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (
          a.applicability === "APPLICABLE" &&
          b.applicability === "APPLICABLE" &&
          a.outcome !== b.outcome &&
          canonicalJson(a.runRef) !== canonicalJson(b.runRef)
        ) {
          const conflictKey = evidenceConflictKeyFor({
            obligationId: a.coverage.obligationId,
            requirementId: a.coverage.requirementId,
            planRevision: a.planRevision,
            workspaceRevision: a.workspaceRevision,
          });
          const evidenceIds = [a.evidenceId, b.evidenceId].sort();
          records.push({
            conflictId: sha256Hex(conflictKey + "\u0000" + evidenceIds.join("\u0000")),
            conflictKey,
            kind: "outcome_disagreement",
            obligationId: a.coverage.obligationId,
            requirementId: a.coverage.requirementId,
            planRevision: a.planRevision,
            workspaceRevision: a.workspaceRevision,
            evidence: [a, b]
              .map((e) => ({
                evidenceId: e.evidenceId,
                outcome: e.outcome,
                runRef: e.runRef,
                applicability: e.applicability,
              }))
              .sort((x, y) => x.evidenceId.localeCompare(y.evidenceId)),
            detectedAt,
          });
        }
      }
    }
  }
  return records;
}

