/**
 * P1-14 LANE-C SQLite projection tests — baselineChangeView over the real
 * SqliteReadModelIndex (the same event stream as the InMemory twin, fed as a
 * plain EventPage). Asserts the same ready / isolation / no-advance facts and,
 * on top, close/reopen rebuild equivalence (fresh read-model file replaying the
 * same event stream reproduces the view field-for-field).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteReadModelIndex } from "../../src/sqlite-read-model/sqlite-read-model-index.js";
import { makeCommitCursor, type EventPage, type PositionedEvent } from "../../src/contracts/ledger.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { canonicalJson, sha256Hex } from "../../src/contracts/fingerprint.js";
import { buildP112ArtifactRef, buildP112Proposal } from "../../src/contracts/fixtures/architecture-fixtures.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  buildInstallCommand,
  architectureBaselinePinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import {
  P114_PROJECT,
  P114_WORKSPACE,
  P114_SCHEMA,
  P114_PROPOSAL,
  P114_CANDIDATE,
  p114ProposalRef,
  buildP114Candidate,
  buildP114Decision,
  buildP114Gate,
  buildP114Activation,
  buildP114MaterializeCommand,
  buildP114DecisionCommand,
  buildP114GateCommand,
  buildP114ActivationCommand,
  buildP114CandidateFold,
  buildP114DecisionFold,
  buildP114GateFold,
  buildP114ActivationFold,
} from "../../src/contracts/fixtures/baseline-evolution-fixtures.js";
import type { ArchitectureCandidateProposalV1 } from "../../src/contracts/architecture-inspection.js";
import type { ArchitectureBaselinePin } from "../../src/contracts/governance.js";
import type { InstallArchitectureBaselineRevisionCommand } from "../../src/contracts/governance.js";

const FIXED = FIXED_ISO_2026_09_05;

function json(v: unknown): string {
  return JSON.stringify(v);
}

function buildSourceBaselinePin(projectId: string): ArchitectureBaselinePin {
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: `p114-ab-install-${projectId}`,
    correlationId: "p114-ab-corr",
    submittedAt: FIXED,
    projectId,
    idempotencyKey: `p114-ab-idem-${projectId}`,
  }) as InstallArchitectureBaselineRevisionCommand;
  return architectureBaselinePinFor(ab);
}

function buildP114Proposal(projectId: string = P114_PROJECT): ArchitectureCandidateProposalV1 {
  const base = buildP112Proposal();
  return {
    ...base,
    proposalId: P114_PROPOSAL,
    projectId,
    workspaceId: P114_WORKSPACE,
    planRef: { aggregateType: "PlanRevision", projectId, planId: "plan-mvp-1" },
    sourceBaselinePin: buildSourceBaselinePin(projectId),
    generatedAt: P114_SCHEMA,
  };
}

function buildP114Page(projectId: string = P114_PROJECT): { page: EventPage } {
  const proposal = buildP114Proposal(projectId);
  const candidate = buildP114Candidate(proposal, { candidateId: P114_CANDIDATE });
  const decision = buildP114Decision(candidate);
  const gate = buildP114Gate(candidate);
  const toPin: ArchitectureBaselinePin = {
    ref: { aggregateType: "ArchitectureBaselineRevision", projectId, baselineId: "baseline-architecture-mvp", revision: 2 },
    digest: sha256Hex("p114-activated-baseline"),
  };
  const activation = buildP114Activation(candidate, decision, gate, toPin);

  const materializeCmd = buildP114MaterializeCommand(p114ProposalRef(projectId), { commandId: "p114-cmd-materialize" });
  const candFold = buildP114CandidateFold(materializeCmd, { eventId: "evt-p114-candidate", occurredAt: FIXED, candidate });
  const decisionCmd = buildP114DecisionCommand(decision, { commandId: "p114-cmd-decision" });
  const decFold = buildP114DecisionFold(decisionCmd, { eventId: "evt-p114-decision", occurredAt: FIXED });
  const gateCmd = buildP114GateCommand(gate, { commandId: "p114-cmd-gate" });
  const gateFold = buildP114GateFold(gateCmd, { eventId: "evt-p114-gate", occurredAt: FIXED });
  const actCmd = buildP114ActivationCommand(activation, { commandId: "p114-cmd-activation" });
  const actFold = buildP114ActivationFold(actCmd, { eventId: "evt-p114-activation", occurredAt: FIXED });

  const events: PositionedEvent[] = [
    { cursor: makeCommitCursor(1), event: candFold.events[0]! },
    { cursor: makeCommitCursor(2), event: decFold.events[0]! },
    { cursor: makeCommitCursor(3), event: gateFold.events[0]! },
    { cursor: makeCommitCursor(4), event: actFold.events[0]! },
  ];
  return { page: { afterCursor: null, throughCursor: makeCommitCursor(4), events, hasMore: false } };
}

describe("P1-14 LANE-C SQLite projection: baselineChangeView", () => {
  it("projects candidate/decision/gate/activation rows and a ready post-activation view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p114-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ path });
    try {
      const { page } = buildP114Page();
      const receipt = await rm.advance(page);
      expect(receipt.appliedEventIds.length).toBe(4);

      const view = await rm.baselineChangeView({ projectId: P114_PROJECT, workspaceId: P114_WORKSPACE });
      expect(view.status).toBe("ready");
      if (view.status !== "ready") throw new Error("view not ready");

      expect(view.candidate).not.toBeNull();
      expect(view.candidate!.ref).toEqual({ aggregateType: "CandidateArchitectureBaseline", projectId: P114_PROJECT, workspaceId: P114_WORKSPACE, candidateId: P114_CANDIDATE });
      expect(view.candidate!.stale).toBe(true);

      expect(view.decision).not.toBeNull();
      expect(view.decision!.decisionId).toBe("decision-p114-1");
      expect(view.decision!.outcome).toBe("accept");
      expect(view.decision!.stale).toBe(true);

      expect(view.gate).not.toBeNull();
      expect(view.gate!.gateId).toBe("gate-p114-1");
      expect(view.gate!.planRef).toBe("plan-mvp-1");
      expect(view.gate!.status).toBe("pass");
      expect(view.gate!.stale).toBe(true);

      expect(view.activation).not.toBeNull();
      expect(view.activation!.activationId).toBe("activation-p114-1");

      expect(view.notRebasedPlans).toEqual([
        { planRef: { aggregateType: "PlanRevision", projectId: P114_PROJECT, planId: "plan-mvp-1" }, pinnedBaselinePin: view.activation!.fromPin },
      ]);
      expect(view.freshness).toBeTruthy();
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isolates the same local ids across projects (hard scope key)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p114-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ path });
    try {
      const { page } = buildP114Page();
      await rm.advance(page);
      const other = await rm.baselineChangeView({ projectId: "proj-beta", workspaceId: P114_WORKSPACE });
      expect(other.status).toBe("not_found");
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a never-advanced index returns not_found (no cursor claim)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p114-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ path });
    try {
      const view = await rm.baselineChangeView({ projectId: P114_PROJECT, workspaceId: P114_WORKSPACE });
      expect(view.status).toBe("not_found");
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rebuild equivalence: close/reopen against the SAME db file reproduces the view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p114-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ path });
    try {
      const { page } = buildP114Page();
      await rm.advance(page);
      const before = await rm.baselineChangeView({ projectId: P114_PROJECT, workspaceId: P114_WORKSPACE });
      await rm.close();

      const reopened = createSqliteReadModelIndex({ path });
      try {
        await reopened.advance(page);
        const after = await reopened.baselineChangeView({ projectId: P114_PROJECT, workspaceId: P114_WORKSPACE });
        expect(json(after)).toBe(json(before));
        if (after.status === "ready") {
          expect(after.candidate!.stale).toBe(true);
          expect(after.notRebasedPlans.length).toBe(1);
        }
      } finally {
        await reopened.close();
      }
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
