/**
 * P1-12 LANE-B InMemory projection tests — decision brief + candidate proposal
 * rows (ArchitectureDecisionBriefRecorded / ArchitectureCandidateProposalRecorded)
 * + the architectureInspectionView combination point (LANE-A inspection/finding
 * parts are empty until lane A lands). Assertions:
 *   - scope key isolation (project A vs project B never cross-read);
 *   - same local brief/proposal id across projects is distinct (no leakage);
 *   - the lane-B parts are surfaced even without LANE-A inspection rows;
 *   - freshness: not_ready (nothing applied) is NOT not_found (index up to date,
 *     but the scope has no rows);
 *   - rebuild equivalence: a fresh InMemory index from the same events reproduces
 *     the view field-for-field.
 */
import { describe, expect, it } from "vitest";
import { ReadModelIndexImpl } from "../../src/read-model/read-model-index.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import {
  createP108ScenarioRuntime,
  runP108TwoProjectScenario,
  toP1_08Harness,
  type P1_08HarnessLike,
  P108_PROJECT_A,
  P108_PROJECT_B,
  P108_WORKSPACE,
} from "../contract-suite/p1-08-harness.js";
import { toP1_12Harness, type P1_12HarnessLike } from "../contract-suite/p1-12-harness.js";
import {
  P112_PROJECT,
  P112_WORKSPACE,
  P112_BRIEF,
  P112_PROPOSAL,
  p112BaselinePin,
  buildP112Brief,
  buildP112Proposal,
  buildRecordArchitectureDecisionBriefCommand,
  buildRecordCandidateBaselineProposalCommand,
} from "../../src/contracts/fixtures/architecture-fixtures.js";
import { candidateProposalDigest } from "../../src/contracts/architecture-inspection.js";
import type { ArchitectureBaselinePin } from "../../src/contracts/governance.js";

function json(v: unknown): string {
  return JSON.stringify(v);
}

/** pin for any project (same baseline content -> same digest; ref.projectId differs). */
function pinForProject(projectId: string): ArchitectureBaselinePin {
  return { ref: { ...p112BaselinePin().ref, projectId }, digest: p112BaselinePin().digest };
}

function briefForProject(projectId: string): ReturnType<typeof buildP112Brief> {
  return { ...buildP112Brief(), projectId, workspaceId: P108_WORKSPACE, baselinePin: pinForProject(projectId) };
}

function proposalForProject(projectId: string): ReturnType<typeof buildP112Proposal> {
  const proposal = { ...buildP112Proposal(), projectId, workspaceId: P108_WORKSPACE, sourceBaselinePin: pinForProject(projectId) };
  // The digest is deterministic over the payload — recompute after the override
  // so the record command's digest guard passes (not digest_mismatch).
  proposal.proposalDigest = candidateProposalDigest(proposal);
  return proposal;
}

async function recordBriefProposal(h: P1_12HarnessLike): Promise<void> {
  // SAME local ids across two projects (isolation must still hold).
  await h.recordArchitectureDecisionBrief(buildRecordArchitectureDecisionBriefCommand(briefForProject(P112_PROJECT), { commandId: "p112-pj-a-brief" }));
  await h.recordCandidateBaselineProposal(buildRecordCandidateBaselineProposalCommand(proposalForProject(P112_PROJECT), { commandId: "p112-pj-a-proposal" }));
  await h.recordArchitectureDecisionBrief(buildRecordArchitectureDecisionBriefCommand(briefForProject(P108_PROJECT_B), { commandId: "p112-pj-b-brief" }));
  await h.recordCandidateBaselineProposal(buildRecordCandidateBaselineProposalCommand(proposalForProject(P108_PROJECT_B), { commandId: "p112-pj-b-proposal" }));
}

function onlyBriefIds(view: import("../../src/contracts/architecture-inspection.js").ArchitectureInspectionViewResult): string[] {
  if (view.status !== "ready") return [];
  return view.inspections.flatMap((i) => i.briefs.map((b) => b.ref.briefId));
}

function onlyProposalIds(view: import("../../src/contracts/architecture-inspection.js").ArchitectureInspectionViewResult): string[] {
  if (view.status !== "ready") return [];
  return view.inspections.flatMap((i) => i.proposals.map((pr) => pr.ref.proposalId));
}

describe("P1-12 LANE-B InMemory projection: brief/proposal isolation", () => {
  it("surfaces lane-B briefs/proposals per full scope key with cross-project isolation", async () => {
    const h = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    const H = toP1_12Harness(h as unknown as P1_12HarnessLike);
    await runP108TwoProjectScenario(toP1_08Harness(h as unknown as P1_08HarnessLike));
    await recordBriefProposal(H);
    await H.advanceProjection();

    const a = await H.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P108_WORKSPACE });
    expect(a.status).toBe("ready");
    const b = await H.architectureInspectionView({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
    expect(b.status).toBe("ready");
    if (a.status !== "ready" || b.status !== "ready") throw new Error("view not ready");

    // Each project surfaces exactly its own brief+proposal (same local ids).
    expect(onlyBriefIds(a)).toEqual([P112_BRIEF]);
    expect(onlyProposalIds(a)).toEqual([P112_PROPOSAL]);
    expect(onlyBriefIds(b)).toEqual([P112_BRIEF]);
    expect(onlyProposalIds(b)).toEqual([P112_PROPOSAL]);

    // Same local ids across projects -> each view holds its OWN aggregate
    // (different projectId in the ref), so the views differ and never cross-read.
    const aBrief = a.inspections.flatMap((i) => i.briefs)[0]!;
    const bBrief = b.inspections.flatMap((i) => i.briefs)[0]!;
    expect(aBrief.ref.projectId).toBe(P112_PROJECT);
    expect(bBrief.ref.projectId).toBe(P108_PROJECT_B);
    const aProp = a.inspections.flatMap((i) => i.proposals)[0]!;
    const bProp = b.inspections.flatMap((i) => i.proposals)[0]!;
    expect(aProp.ref.projectId).toBe(P112_PROJECT);
    expect(bProp.ref.projectId).toBe(P108_PROJECT_B);
    expect(json(a)).not.toBe(json(b));
    expect(a.sourceCursor).toBeTruthy();
    expect(b.sourceCursor).toBeTruthy();

    // The synthetic inspection entries bound to a brief/proposal carry it.
    const aProposals = a.inspections.flatMap((i) => i.proposals).map((pr) => pr.proposal.proposalId);
    expect(aProposals).toContain(P112_PROPOSAL);
    const aBriefs = a.inspections.flatMap((i) => i.briefs).map((br) => br.brief.briefId);
    expect(aBriefs).toContain(P112_BRIEF);

    // A scope with NO lane-B rows is not_found (index is up to date), NOT not_ready.
    const none = await H.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: "ws-absent" });
    expect(none.status).toBe("not_found");
    if (none.status === "not_found") {
      expect(none.projectId).toBe(P112_PROJECT);
      expect(none.workspaceId).toBe("ws-absent");
    }
  });

  it("freshness: a never-advanced index returns not_ready (not not_found)", async () => {
    const fresh = new ReadModelIndexImpl();
    const view = await fresh.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P108_WORKSPACE });
    expect(view.status).toBe("not_ready");
    if (view.status === "not_ready") expect(view.observedCursor).toBeNull();
  });

  it("rebuild equivalence: a fresh InMemory index from the same events reproduces the view", async () => {
    const h = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    const H = toP1_12Harness(h as unknown as P1_12HarnessLike);
    await runP108TwoProjectScenario(toP1_08Harness(h as unknown as P1_08HarnessLike));
    await recordBriefProposal(H);
    await H.advanceProjection();

    const page = await h.ledger.events({ afterCursor: null, limit: 2000 });
    const fresh = new ReadModelIndexImpl();
    await fresh.advance(page);

    const a = await H.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P108_WORKSPACE });
    const fa = await fresh.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P108_WORKSPACE });
    expect(json(fa)).toBe(json(a));

    const b = await H.architectureInspectionView({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
    const fb = await fresh.architectureInspectionView({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
    expect(json(fb)).toBe(json(b));
  });
});
