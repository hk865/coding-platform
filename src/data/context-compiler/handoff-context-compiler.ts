/**
 * P1-06 ContextCompiler.HandoffContextPort implementation.
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane B fills the
 * implementation). See IMPLEMENTATION-HANDOFF "P1-06 契约与存储语义" item 3:
 *   - assemble validates the request, resolves the registered HandoffPacket,
 *     enforces CANONICAL source revision (mismatch -> explicit stale_packet /
 *     stale_workspace_snapshot, never silently reusing the old packet), material
 *     presence (needs_material), scope/binding subset rules, budget + size caps
 *     (P1-03 rules), then assembles B's bounded TaskEnvelope whose fresh bundle
 *     is derived from the packet fields (objective/constraints/completed/
 *     unresolved/refs — NEVER a transcript) plus fresh plan/workspace material,
 *     stored body-first in the vault.
 *
 * FROZEN guard order (all zero-write except the body-first vault.put):
 *   1) validateHandoffContextRequest -> invalid_request;
 *   2) ledger.load(handoffPacketRef) -> not registered -> packet_not_found;
 *      packet projectId/goalId/taskId vs request, or packet.planRef (exact ref),
 *      mismatch -> packet_mismatch;
 *   3) Workspace + Plan resolution -> missing -> needs_material{gaps,
 *      selectedRefs} (same source-ref format as P1-03);
 *   4) packet.taskRevision != plan.planRevision -> packet_mismatch;
 *      request.workspaceSnapshot.revision != canonical ->
 *      stale_workspace_snapshot; packet.workspaceSnapshot.revision != canonical
 *      -> stale_packet (first hit wins, in this order — a stale request does not
 *      mask the existence of a stale packet);
 *   5) scope (tools / writeScope, independently) must be a subset of
 *      declaredPermissions + non-empty policyRevision -> forbidden_tool_or_scope;
 *   6) positive tokenBudget and un-passed deadline -> budget_exhausted;
 *   7) bounded Bundle body (JSON; <= HANDOFF_CONTEXT_BUNDLE_MAX_BYTES ->
 *      exceeds_size_cap) body-first vault.put (ownerRef = request.runRef, B's
 *      run); put rejected -> material_unavailable / exceeds_size_cap;
 *   8) B's TaskEnvelopeV1 (shape FROZEN from P1-03) validated
 *      (validateTaskEnvelope -> exceeds_size_cap);
 *   9) manifest {schemaVersion, selectedRefs, gaps: [], packetRef,
 *      packetTaskRevision, noFullTranscript: true, freshness}.
 * assemble NEVER starts an Agent.
 *
 * stale_binding is NOT decided here (delegated to Control.startRun, as in
 * P1-03). assemble does only the minimal ref shape / subset consistency.
 */
import type { StateLedger, AggregateSnapshot, WorkspaceSnapshot } from "../../contracts/ledger.js";
import type { ArtifactPort, ArtifactRef } from "../../contracts/artifact.js";
import type { PlanRevisionSnapshot } from "../../contracts/plan.js";
import type { SourceRefV1 } from "../../contracts/dispatch.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import type { JsonValue } from "../../contracts/fingerprint.js";
import type {
  HandoffContextPort,
  HandoffContextRequestV1,
  HandoffContextResultV1,
  HandoffContextRejectionCode,
  HandoffContextManifestV1,
} from "../../contracts/handoff-context.js";
import { HANDOFF_CONTEXT_BUNDLE_MAX_BYTES } from "../../contracts/handoff.js";
import type { HandoffPacketSnapshot } from "../../contracts/handoff.js";
import type { TaskEnvelopeV1, MaterialGapV1 } from "../../contracts/task-envelope.js";
import type { ValidationIssue } from '../../contracts/validation/common.js';
import { issuesToErrorMessage } from '../../contracts/validation/common.js';
import { validateHandoffContextRequest } from '../../contracts/validation/handoff.js';
import { validateTaskEnvelope } from '../../contracts/validation/dispatch.js';

export type HandoffContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  now: () => string;
};

export class HandoffContextCompilerImpl implements HandoffContextPort {
  constructor(private readonly deps: HandoffContextCompilerDeps) {}

  async assemble(request: HandoffContextRequestV1): Promise<HandoffContextResultV1> {
    // 1) Structural validation (unknown schema / wrong field shapes).
    const requestIssues = validateHandoffContextRequest(request);
    if (requestIssues.length > 0) {
      return reject("invalid_request", requestIssues);
    }
    // validateHandoffContextRequest does NOT guarantee the refs are fully formed —
    // guard them so a malformed runtime request never dereferences a missing ref.
    if (!request.planRef || !request.runRef || !request.attemptRef || !request.handoffPacketRef) {
      return {
        status: "rejected",
        code: "invalid_request",
        issues: ["planRef, runRef, attemptRef and handoffPacketRef are required"],
      };
    }

    // 2) Resolve the registered bounded HandoffPacket.
    const packetLoad = await this.deps.ledger.load(request.handoffPacketRef);
    if (packetLoad.status === "not_found" || !isHandoffPacketSnapshot(packetLoad.snapshot)) {
      return {
        status: "rejected",
        code: "packet_not_found",
        issues: ["handoff packet is not registered in the ledger"],
      };
    }
    const packet = packetLoad.snapshot.packet;

    // packet.projectId/goalId/taskId vs request + packet.planRef (exact ref).
    if (
      packet.projectId !== request.projectId ||
      packet.goalId !== request.goalId ||
      packet.taskId !== request.taskId ||
      canonicalJson(packet.planRef) !== canonicalJson(request.planRef)
    ) {
      return {
        status: "rejected",
        code: "packet_mismatch",
        issues: ["handoff packet references a different task / plan / goal tuple"],
      };
    }

    // 3) Workspace + Plan resolution (material presence; P1-03 source-ref format).
    const workspaceRef = {
      aggregateType: "Workspace" as const,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
    };
    const [wsResult, planResult] = await Promise.all([
      this.deps.ledger.load(workspaceRef),
      this.deps.ledger.load(request.planRef),
    ]);
    const selected: SourceRefV1[] = [];
    const gaps: MaterialGapV1[] = [];
    let planSnap: PlanRevisionSnapshot | null = null;
    if (planResult.status === "found" && isPlanRevisionSnapshot(planResult.snapshot)) {
      planSnap = planResult.snapshot;
      selected.push({
        kind: "plan-revision",
        refId: request.planRef.planId,
        revision: String(planSnap.planRevision),
        digest: request.planRef.planId,
      });
    } else {
      gaps.push({
        kind: "plan-revision",
        refId: request.planRef.planId,
        message: "accepted PlanRevision not found in the ledger",
      });
    }
    let canonicalWsRevision: number | null = null;
    if (wsResult.status === "found" && isWorkspaceSnapshot(wsResult.snapshot)) {
      canonicalWsRevision = wsResult.snapshot.revision;
      selected.push({
        kind: "workspace",
        refId: request.workspaceId,
        revision: String(canonicalWsRevision),
      });
    } else {
      gaps.push({
        kind: "workspace-snapshot",
        refId: request.workspaceId,
        message: "Workspace not found in the ledger",
      });
    }
    if (gaps.length > 0) {
      return { status: "needs_material", gaps, selectedRefs: selected };
    }

    // packet.taskRevision vs the accepted plan revision (needs the plan snapshot).
    if (packet.taskRevision !== planSnap!.planRevision) {
      return {
        status: "rejected",
        code: "packet_mismatch",
        issues: [
          `packet taskRevision ${packet.taskRevision} != PlanRevision ${planSnap!.planRevision}`,
        ],
      };
    }

    // 4) Canonical source revisions — EXPLICIT stale, never silently reused.
    const requestedWsRevision = request.workspaceSnapshot.revision;
    if (requestedWsRevision !== canonicalWsRevision) {
      return {
        status: "rejected",
        code: "stale_workspace_snapshot",
        issues: [
          `workspace snapshot revision ${requestedWsRevision} != canonical ${canonicalWsRevision}`,
        ],
      };
    }
    if (packet.workspaceSnapshot.revision !== canonicalWsRevision) {
      return {
        status: "rejected",
        code: "stale_packet",
        issues: [
          `packet workspace revision ${packet.workspaceSnapshot.revision} != canonical ${canonicalWsRevision}`,
        ],
      };
    }

    // 5) Forbidden tool/scope: request.scope ⊆ declaredPermissions (independently
    //    for tools & writeScope) + non-empty roleBinding.policyRevision.
    const forbiddenIssues: string[] = [];
    for (const tool of request.scope.tools) {
      if (!request.declaredPermissions.tools.includes(tool)) {
        forbiddenIssues.push(`tool '${tool}' is not within declaredPermissions.tools`);
      }
    }
    for (const scope of request.scope.writeScope) {
      if (!request.declaredPermissions.writeScope.includes(scope)) {
        forbiddenIssues.push(`writeScope '${scope}' is not within declaredPermissions.writeScope`);
      }
    }
    if (request.roleBinding.policyRevision.length === 0) {
      forbiddenIssues.push("roleBinding.policyRevision must be non-empty");
    }
    if (forbiddenIssues.length > 0) {
      return { status: "rejected", code: "forbidden_tool_or_scope", issues: forbiddenIssues };
    }

    // 6) Budget: positive tokenBudget and an un-passed deadline.
    const now = this.deps.now();
    const deadline = request.budget.deadline;
    if (!(request.budget.tokenBudget > 0) || (deadline !== null && deadline < now)) {
      return {
        status: "rejected",
        code: "budget_exhausted",
        issues: ["tokenBudget must be positive and deadline must not have passed"],
      };
    }

    // 7) Assemble the bounded Bundle body (packet whitelist fields + fresh
    //    plan/workspace material; NEVER a transcript).
    const plan = planSnap as PlanRevisionSnapshot;
    const runtimeTask = plan.tasks.find((t) => t.taskId === request.taskId);
    const title = runtimeTask ? runtimeTask.title : `<task ${request.taskId}>`;
    const obligations = plan.obligations
      .filter((o) => o.taskIds.includes(request.taskId))
      .map((o) => ({ obligationId: o.obligationId, title: o.title }));

    const permissions = {
      policyRevision: request.roleBinding.policyRevision,
      tools: [...request.scope.tools],
      writeScope: [...request.scope.writeScope],
    };

    // The packet body ref is the packet-related artifact source.
    const packetArtifactSource: SourceRefV1 = {
      kind: "artifact",
      refId: packet.bodyRef.digest,
      revision: String(packet.taskRevision),
      digest: packet.bodyRef.digest,
    };
    const bundleSelected: SourceRefV1[] = [...selected, packetArtifactSource];

    const bundle = {
      schemaVersion: 1,
      projectId: request.projectId,
      goalId: request.goalId,
      taskId: request.taskId,
      planRef: { ...request.planRef },
      workspaceSnapshot: { ...request.workspaceSnapshot },
      handoff: {
        packetId: packet.packetId,
        taskRevision: packet.taskRevision,
        objective: packet.objective,
        constraints: packet.constraints,
        completed: packet.completed.map((c) => ({
          summary: c.summary,
          artifactRef: c.artifactRef,
          evidenceRefs: c.evidenceRefs,
        })),
        unresolved: packet.unresolved.map((u) => ({
          kind: u.kind,
          summary: u.summary,
          artifactRef: u.artifactRef,
        })),
        evidenceRefs: packet.evidenceRefs,
        artifactRefs: packet.artifactRefs,
        source: {
          runRef: packet.source.runRef,
          binding: packet.source.binding,
        },
      },
      task: { title, obligations },
      budget: { ...request.budget },
      permissions,
      roleBinding: { ...request.roleBinding },
      noFullTranscript: true,
    };
    const body = canonicalJson(bundle as JsonValue);
    const bundleBytes = Buffer.byteLength(body, "utf8");
    if (bundleBytes > HANDOFF_CONTEXT_BUNDLE_MAX_BYTES) {
      return {
        status: "rejected",
        code: "exceeds_size_cap",
        issues: [`bundle size ${bundleBytes} exceeds ${HANDOFF_CONTEXT_BUNDLE_MAX_BYTES}`],
      };
    }

    // Body-first: the bounded bundle goes into the vault BEFORE the envelope.
    const putResult = await this.deps.vault.put({
      contentType: "application/json",
      body,
      sourceRefs: bundleSelected,
      ownerRef: request.runRef,
      requestedAt: now,
    });
    if (putResult.status === "rejected") {
      const code =
        putResult.code === "size_exceeded" ? "exceeds_size_cap" : "material_unavailable";
      return { status: "rejected", code, issues: putResult.issues };
    }
    const bundleRef: ArtifactRef = putResult.ref;

    // 8) Build B's bounded TaskEnvelopeV1 (shape FROZEN from P1-03) and enforce
    //    the HARD size cap.
    const envelope: TaskEnvelopeV1 = {
      schemaVersion: 1,
      envelopeId: "env-handoff-" + request.requestId,
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      goalId: request.goalId,
      taskId: request.taskId,
      runRef: { ...request.runRef },
      attemptRef: { ...request.attemptRef },
      planRef: { ...request.planRef },
      roleBinding: { ...request.roleBinding },
      workspaceSnapshot: { ...request.workspaceSnapshot },
      permissions,
      budget: { ...request.budget },
      sourceRefs: bundleSelected,
      bundleRef,
    };
    const envelopeIssues = validateTaskEnvelope(envelope);
    if (envelopeIssues.length > 0) {
      const code = envelopeIssues.some((i) => i.code === "size_exceeded")
        ? "exceeds_size_cap"
        : "invalid_request";
      return {
        status: "rejected",
        code,
        issues: envelopeIssues.map((i) => issuesToErrorMessage([i])),
      };
    }

    // 9) Manifest.
    const manifest: HandoffContextManifestV1 = {
      schemaVersion: 1,
      selectedRefs: bundleSelected,
      gaps: [],
      packetRef: { ...request.handoffPacketRef },
      packetTaskRevision: packet.taskRevision,
      noFullTranscript: true,
      freshness: {
        workspaceSnapshot: { ...request.workspaceSnapshot },
        planRef: { ...request.planRef },
      },
    };

    return { status: "ready", envelope, bundleRef, manifest };
  }
}

function reject(
  code: HandoffContextRejectionCode,
  issues: ValidationIssue[],
): HandoffContextResultV1 {
  return {
    status: "rejected",
    code,
    issues: issues.map((i) => issuesToErrorMessage([i])),
  };
}

function isHandoffPacketSnapshot(snapshot: AggregateSnapshot): snapshot is HandoffPacketSnapshot {
  return snapshot.ref.aggregateType === "HandoffPacket";
}

function isWorkspaceSnapshot(snapshot: AggregateSnapshot): snapshot is WorkspaceSnapshot {
  return snapshot.ref.aggregateType === "Workspace";
}

function isPlanRevisionSnapshot(snapshot: AggregateSnapshot): snapshot is PlanRevisionSnapshot {
  return snapshot.ref.aggregateType === "PlanRevision";
}
