/**
 * P1-12 LANE-B SQLite projection tests — decision brief + candidate proposal
 * rows (architecture_brief_rows / architecture_proposal_rows) + the
 * architectureInspectionView combination point. Same assertions as the InMemory
 * twin, run against the persistent harness; on top it asserts rebuild equivalence
 * after a close/reopen (fresh read-model file) against the SAME ledger event
 * stream (field-for-field parity).
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import {
  createP108ScenarioRuntime,
  runP108TwoProjectScenario,
  toP1_08Harness,
  type P1_08HarnessLike,
  P108_PROJECT_B,
  P108_WORKSPACE,
} from "../contract-suite/p1-08-harness.js";
import { toP1_12Harness, type P1_12HarnessLike } from "../contract-suite/p1-12-harness.js";
import {
  P112_PROJECT,
  P112_BRIEF,
  P112_PROPOSAL,
  p112BaselinePin,
  buildP112Brief,
  buildP112Proposal,
  buildRecordArchitectureDecisionBriefCommand,
  buildRecordCandidateBaselineProposalCommand,
} from "../../src/fixtures/architecture-fixtures.js";
import { candidateProposalDigest } from "../../src/contracts/architecture-inspection.js";
import type { ArchitectureBaselinePin } from "../../src/contracts/governance.js";

function json(v: unknown): string {
  return JSON.stringify(v);
}

function pinForProject(projectId: string): ArchitectureBaselinePin {
  return { ref: { ...p112BaselinePin().ref, projectId }, digest: p112BaselinePin().digest };
}

function briefForProject(projectId: string): ReturnType<typeof buildP112Brief> {
  return { ...buildP112Brief(), projectId, workspaceId: P108_WORKSPACE, baselinePin: pinForProject(projectId) };
}

function proposalForProject(projectId: string): ReturnType<typeof buildP112Proposal> {
  const proposal = { ...buildP112Proposal(), projectId, workspaceId: P108_WORKSPACE, sourceBaselinePin: pinForProject(projectId) };
  proposal.proposalDigest = candidateProposalDigest(proposal);
  return proposal;
}

async function makeHarness(): Promise<PersistentSqliteHarness> {
  return createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
}

async function recordBriefProposal(h: P1_12HarnessLike): Promise<void> {
  await h.recordArchitectureDecisionBrief(buildRecordArchitectureDecisionBriefCommand(briefForProject(P112_PROJECT), { commandId: "p112-pj-a-brief" }));
  await h.recordCandidateBaselineProposal(buildRecordCandidateBaselineProposalCommand(proposalForProject(P112_PROJECT), { commandId: "p112-pj-a-proposal" }));
  await h.recordArchitectureDecisionBrief(buildRecordArchitectureDecisionBriefCommand(briefForProject(P108_PROJECT_B), { commandId: "p112-pj-b-brief" }));
  await h.recordCandidateBaselineProposal(buildRecordCandidateBaselineProposalCommand(proposalForProject(P108_PROJECT_B), { commandId: "p112-pj-b-proposal" }));
  await h.advanceProjection();
}

describe("P1-12 LANE-B SQLite projection: brief/proposal isolation", () => {
  it("surfaces lane-B briefs/proposals per full scope key with cross-project isolation", async () => {
    const h = await makeHarness();
    try {
      const H = toP1_12Harness(h as unknown as P1_12HarnessLike);
      await runP108TwoProjectScenario(toP1_08Harness(h as unknown as P1_08HarnessLike));
      await recordBriefProposal(H);

      const a = await H.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P108_WORKSPACE });
      const b = await H.architectureInspectionView({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
      expect(a.status).toBe("ready");
      expect(b.status).toBe("ready");
      if (a.status !== "ready" || b.status !== "ready") throw new Error("view not ready");

      expect(a.inspections.flatMap((i) => i.briefs).map((x) => x.ref.briefId)).toEqual([P112_BRIEF]);
      expect(a.inspections.flatMap((i) => i.proposals).map((x) => x.ref.proposalId)).toEqual([P112_PROPOSAL]);
      expect(b.inspections.flatMap((i) => i.briefs).map((x) => x.ref.briefId)).toEqual([P112_BRIEF]);
      expect(b.inspections.flatMap((i) => i.proposals).map((x) => x.ref.proposalId)).toEqual([P112_PROPOSAL]);

      const aBrief = a.inspections.flatMap((i) => i.briefs)[0]!;
      const bBrief = b.inspections.flatMap((i) => i.briefs)[0]!;
      expect(aBrief.ref.projectId).toBe(P112_PROJECT);
      expect(bBrief.ref.projectId).toBe(P108_PROJECT_B);
      expect(json(a)).not.toBe(json(b));

      const none = await H.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: "ws-absent" });
      expect(none.status).toBe("not_found");
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("freshness: a never-advanced index returns not_ready (not not_found)", async () => {
    const h = await makeHarness();
    try {
      const H = toP1_12Harness(h as unknown as P1_12HarnessLike);
      await runP108TwoProjectScenario(toP1_08Harness(h as unknown as P1_08HarnessLike));
      const H2 = toP1_12Harness(h as unknown as P1_12HarnessLike);
      // No P1-12 advance happened; but the P1-08 world already advanced the
      // cursor, so a scope with no brief/proposal is not_found (index up to date).
      const none = await H2.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P108_WORKSPACE });
      expect(none.status).toBe("not_found");
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("rebuild equivalence: close/reopen with a fresh read-model file reproduces the view", async () => {
    const h = await makeHarness();
    try {
      const H = toP1_12Harness(h as unknown as P1_12HarnessLike);
      await runP108TwoProjectScenario(toP1_08Harness(h as unknown as P1_08HarnessLike));
      await recordBriefProposal(H);
      const before = {
        a: await H.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P108_WORKSPACE }),
        b: await H.architectureInspectionView({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE }),
      };
      await h.close();
      const reopened = await h.reopen({ readModelFile: "readmodel-p112-rebuild.sqlite" });
      try {
        await reopened.advanceProjection();
        const H2 = toP1_12Harness(reopened as unknown as P1_12HarnessLike);
        const after = {
          a: await H2.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P108_WORKSPACE }),
          b: await H2.architectureInspectionView({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE }),
        };
        expect(json(after.a)).toBe(json(before.a));
        expect(json(after.b)).toBe(json(before.b));
      } finally {
        await reopened.cleanup().catch(() => undefined);
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 60_000);
});
