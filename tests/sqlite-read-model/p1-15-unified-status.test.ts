import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
/**
 * P1-15 LANE-B SQLite projection tests — unifiedStatusView over the real
 * SqliteReadModelIndex (the same event stream as the InMemory twin, fed as a
 * plain EventPage). Asserts the same ready / no-advance / isolation facts and,
 * on top, close/reopen rebuild equivalence (fresh read-model file replaying the
 * same event stream reproduces the view field-for-field).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteReadModelIndex } from "../../src/data/read-model-index/sqlite-read-model-index.js";
import { makeCommitCursor, type EventPage, type PositionedEvent } from "../../src/contracts/ledger.js";
import { FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { P115_PROJECT, P115_WORKSPACE, P115_DESIGN, P115_DECISION, P115_POLICY, p115DesignRef, p115DecisionRef, p115PolicyRef, p115PolicyActiveRef, buildP115Proposal, buildP115Decision, buildP115ProposalCommand, buildP115DecisionCommand, buildP115InstallCommand, buildP115ActivateCommand } from "../contract-support/fixtures/human-role-collaboration-fixtures.js";
import { buildP115ProposalFold, buildP115DecisionFold, buildP115PolicyInstallFold, buildP115PolicyActivateFold } from "../../src/control/control-engine/records/human-role-collaboration.js";
import type { UnifiedStatusViewResult } from "../../src/contracts/human-role-collaboration.js";

const FIXED = FIXED_ISO_2026_09_05;

function json(v: unknown): string {
  return JSON.stringify(v);
}

function buildP115Page(projectId: string = P115_PROJECT): { page: EventPage } {
  const proposal = buildP115Proposal({ projectId });
  const decision = buildP115Decision(proposal);

  const proposalCmd = buildP115ProposalCommand(proposal, { commandId: "p115-cmd-proposal" });
  const proposalFold = buildP115ProposalFold(proposalCmd, { eventId: "evt-p115-proposal", occurredAt: FIXED });
  const decisionCmd = buildP115DecisionCommand(decision, { commandId: "p115-cmd-decision" });
  const decisionFold = buildP115DecisionFold(decisionCmd, { eventId: "evt-p115-decision", occurredAt: FIXED });
  const installCmd = buildP115InstallCommand(projectId, { commandId: "p115-cmd-install-policy" });
  const installFold = buildP115PolicyInstallFold(installCmd, { eventId: "evt-p115-install", occurredAt: FIXED });
  const activateCmd = buildP115ActivateCommand(projectId, { commandId: "p115-cmd-activate-policy", expectedRevision: 1 });
  const activateFold = buildP115PolicyActivateFold(activateCmd, { eventId: "evt-p115-activate", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 });

  const events: PositionedEvent[] = [
    { cursor: makeCommitCursor(1), event: proposalFold.events[0]! },
    { cursor: makeCommitCursor(2), event: decisionFold.events[0]! },
    { cursor: makeCommitCursor(3), event: installFold.events[0]! },
    { cursor: makeCommitCursor(4), event: activateFold.events[0]! },
  ];
  return { page: { afterCursor: null, throughCursor: makeCommitCursor(4), events, hasMore: false } };
}

describe("P1-15 LANE-B SQLite projection: unifiedStatusView", () => {
  it("projects the 4 rows and returns a ready facts-first view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p115-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      const { page } = buildP115Page();
      const receipt = await rm.advance(page);
      expect(receipt.appliedEventIds.length).toBe(4);

      const view: UnifiedStatusViewResult = await rm.unifiedStatusView({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE });
      expect(view.status).toBe("ready");
      if (view.status !== "ready") throw new Error("view not ready");

      expect(view.facts.length).toBe(4);
      expect(view.facts.map((f) => f.kind)).toEqual(["proposal", "decision", "baseline", "baseline"]);

      expect(view.facts[0]!.kind).toBe("proposal");
      expect(view.facts[0]!.refKey).toBe(canonicalJson(p115DesignRef(P115_PROJECT)));
      expect(view.facts[0]!.display).toBe("InitialDesignProposal(" + P115_DESIGN + ")");
      expect(view.facts[0]!.revision).toBe(1);
      expect(view.facts[0]!.stale).toBe(false);
      expect(view.facts[0]!.sourceCursor).toBe(makeCommitCursor(1));

      expect(view.facts[1]!.kind).toBe("decision");
      expect(view.facts[1]!.refKey).toBe(canonicalJson(p115DecisionRef(P115_PROJECT)));
      expect(view.facts[1]!.display).toBe("InitialDesignDecision(" + P115_DECISION + ", accept)");
      expect(view.facts[1]!.revision).toBe(1);
      expect(view.facts[1]!.stale).toBe(false);
      expect(view.facts[1]!.sourceCursor).toBe(makeCommitCursor(2));

      expect(view.facts[2]!.kind).toBe("baseline");
      expect(view.facts[2]!.refKey).toBe(canonicalJson(p115PolicyRef(P115_PROJECT)));
      expect(view.facts[2]!.display).toBe("CoordinationPolicy(" + P115_POLICY + "@r1)");
      expect(view.facts[2]!.revision).toBe(1);
      expect(view.facts[2]!.stale).toBe(false);
      expect(view.facts[2]!.sourceCursor).toBe(makeCommitCursor(3));

      expect(view.facts[3]!.kind).toBe("baseline");
      expect(view.facts[3]!.refKey).toBe(canonicalJson(p115PolicyActiveRef(P115_PROJECT)));
      expect(view.facts[3]!.display.startsWith("CoordinationPolicyActive(" + P115_PROJECT)).toBe(true);
      expect(view.facts[3]!.revision).toBe(1);
      expect(view.facts[3]!.stale).toBe(false);
      expect(view.facts[3]!.sourceCursor).toBe(makeCommitCursor(4));

      expect(view.decisions.length).toBe(1);
      expect(view.decisions[0]).toEqual({ decisionId: P115_DECISION, outcome: "accept", summary: "接受包含查询入口的初始设计", stale: false });

      expect(view.explanations).toEqual([{ fact: "design option", explanation: "由 HumanCollaboration 解释", stale: false }]);
      expect(view.freshness).toBe(makeCommitCursor(4));
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a never-advanced index returns not_found (no cursor claim)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p115-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      const view = await rm.unifiedStatusView({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE });
      expect(view.status).toBe("not_found");
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isolates the same local ids across projects (hard scope key)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p115-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      const { page } = buildP115Page();
      await rm.advance(page);
      const other = await rm.unifiedStatusView({ projectId: "proj-beta", workspaceId: P115_WORKSPACE });
      expect(other.status).toBe("not_found");
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rebuild equivalence: close/reopen against the SAME db file reproduces the view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p115-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      const { page } = buildP115Page();
      await rm.advance(page);
      const before = await rm.unifiedStatusView({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE });
      await rm.close();

      const reopened = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
      try {
        await reopened.advance(page);
        const after = await reopened.unifiedStatusView({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE });
        expect(json(after)).toBe(json(before));
        if (after.status === "ready") {
          expect(after.facts.length).toBe(4);
          expect(after.decisions.length).toBe(1);
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
