/**
 * P1-02 plan contract suite — shared by InMemory AND SQLite adapters.
 *
 * Covers: full accept path (install+activate+applyPlan+views), every
 * non-empty guard (-> plan_guard_failed, ZERO write), GoalGate requirement,
 * Task<->obligation mappings, obligation->required VR compilation against the
 * effective CompletionPolicy, hierarchy/DAG legality (dangling/self/cycles),
 * unresolved governance refs (no active refs / no default fallback), pin
 * immutability after active-ref movement, CAS + idempotency, freshness
 * (not_ready != not_found), cross-project isolation, and NO dispatch outbox /
 * TaskAttempt / AgentRun anywhere.
 */
import { describe, expect, it } from "vitest";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildInstallCommand } from "../../src/fixtures/governance-fixtures.js";
import { completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/governance.js";
import {
  HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1,
  buildApplyPlanCommand,
} from "../../src/fixtures/plan-fixtures.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../contract-support/fixtures/goal-fixtures.js";
import type { P1_02HarnessFactory } from "./p1-02-harness.js";
import { freshCommandId, freshCorrelationId } from "./p1-02-harness.js";
import type { PlanRevisionDraft } from "../../src/contracts/plan.js";

const BOOT = {
  commandId: "cmd-bootstrap-plan-suite",
  correlationId: "corr-bootstrap-plan-suite",
  submittedAt: "2026-09-05T12:00:00.000Z",
};
const SCHEMA = "2026-09-05T12:00:00.000Z";

export function definePlanContractSuite(createHarness: P1_02HarnessFactory): void {
  describe("P1-02 plan contract suite", () => {
    async function setupHarness(projectId = "proj-alpha") {
      const h = await createHarness();
      const boot = await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, BOOT));
      expect(boot.status).toBe("committed");
      // install + activate both kinds for the project
      const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
        commandId: freshCommandId("cmd-suite-install-cp"),
        correlationId: freshCorrelationId(),
        submittedAt: SCHEMA,
        projectId,
        idempotencyKey: "suite-inst-cp-" + projectId,
      });
      const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
        commandId: freshCommandId("cmd-suite-install-ab"),
        correlationId: freshCorrelationId(),
        submittedAt: SCHEMA,
        projectId,
        idempotencyKey: "suite-inst-ab-" + projectId,
      });
      expect((await h.install(cp)).status).toBe("committed");
      expect((await h.install(ab)).status).toBe("committed");
      if (cp.commandType !== "InstallCompletionPolicyRevision") throw new Error("build");
      if (ab.commandType !== "InstallArchitectureBaselineRevision") throw new Error("build");
      const act1 = await h.activate(
        buildActivateCommand(completionPolicyPinFor(cp), {
          commandId: freshCommandId("cmd-suite-act-cp"),
          correlationId: freshCorrelationId(),
          submittedAt: SCHEMA,
          projectId,
          expectedRevision: 1,
          idempotencyKey: "suite-act-cp-" + projectId, // DISTINCT per kind: default key would collide with the AB activation
        }),
      );
      const act2 = await h.activate(
        buildActivateCommand(architectureBaselinePinFor(ab), {
          commandId: freshCommandId("cmd-suite-act-ab"),
          correlationId: freshCorrelationId(),
          submittedAt: SCHEMA,
          projectId,
          expectedRevision: 1,
          idempotencyKey: "suite-act-ab-" + projectId,
        }),
      );
      expect(act1.status).toBe("committed");
      expect(act2.status).toBe("committed");
      // create the goal (fixture uses goalId "goal-1" in ws-shared)
      const goalCmd = buildCreateGoalCommand(MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes.find(
        (s) => s.projectId === projectId,
      )!, {
        commandId: freshCommandId("cmd-suite-create-goal"),
        correlationId: freshCorrelationId(),
        submittedAt: SCHEMA,
        idempotencyKey: "suite-goal-" + projectId,
      });
      const goalReceipt = await h.submit(goalCmd);
      expect(goalReceipt.status).toBe("committed");
      return h;
    }

    function planCommand(
      draft: PlanRevisionDraft,
      projectId: string,
      opts: { expectedRevision?: number; idempotencyKey?: string; goalId?: string } = {},
    ) {
      return buildApplyPlanCommand(draft, {
        commandId: freshCommandId("cmd-suite-apply"),
        correlationId: freshCorrelationId(),
        submittedAt: SCHEMA,
        projectId,
        expectedRevision: opts.expectedRevision ?? 1,
        idempotencyKey: opts.idempotencyKey ?? "suite-apply-" + projectId,
        ...(opts.goalId !== undefined ? { goalId: opts.goalId } : {}),
      });
    }

    function eventsAfter(h: Awaited<ReturnType<typeof setupHarness>>, count?: number) {
      return h.ledger.events({ afterCursor: null, limit: count ?? 100 });
    }

    it("full path: accept plan, goal active revision, views ready, pins exact, one event", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const cmd = planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha");
      const receipt = await h.applyPlan(cmd);
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      expect(receipt.replayed).toBe(false);

      // canonical: goal snapshot advanced, plan snapshot persisted
      const goal = await h.ledger.load({
        aggregateType: "Goal",
        projectId: "proj-alpha",
        goalId: "goal-1",
      });
      expect(goal.status).toBe("found");
      if (goal.status !== "found") return;
      expect((goal.snapshot as { activePlanRevision: unknown }).activePlanRevision).toEqual({
        aggregateType: "PlanRevision",
        projectId: "proj-alpha",
        planId: "plan-mvp-1",
      });
      expect(goal.snapshot.revision).toBe(2);

      const plan = await h.ledger.load({
        aggregateType: "PlanRevision",
        projectId: "proj-alpha",
        planId: "plan-mvp-1",
      });
      expect(plan.status).toBe("found");
      if (plan.status !== "found") return;
      const pins = (plan.snapshot as { effectiveCompletionPolicy: { ref: { revision: number } } }).effectiveCompletionPolicy;
      expect(pins).toBeDefined();

      // views
      await h.advanceProjection();
      const graph = await h.planGraph({ projectId: "proj-alpha", goalId: "goal-1" });
      expect(graph.status).toBe("ready");
      if (graph.status !== "ready") return;
      expect(graph.graph.pinnedCompletionPolicy.ref.policyId).toBe("policy-completion-mvp");
      expect(graph.graph.pinnedCompletionPolicy.digest).toBe(
        completionPolicyPinFor(
          buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
            commandId: "x",
            correlationId: "x",
            submittedAt: SCHEMA,
            projectId: "proj-alpha",
          }) as never,
        ).digest,
      );
      expect(graph.graph.tasks.length).toBe(4);
      expect(graph.graph.taskHierarchy.parentOf.length).toBe(3);
      expect(graph.graph.executionDag.dependsOn.length).toBe(3);

      const detail = await h.taskDetail({ projectId: "proj-alpha", goalId: "goal-1", taskId: "gate-goal" });
      expect(detail.status).toBe("ready");
      if (detail.status !== "ready") return;
      expect(detail.task.taskKind).toBe("gate");
      expect(detail.task.obligations.map((o) => o.obligationId)).toEqual(["obl-3"]);

      const after = await eventsAfter(h);
      const newTypes = after.events.slice(before.events.length).map((p) => p.event.eventType);
      expect(newTypes).toEqual(["PlanRevisionAccepted"]);
    });

    it("unresolved governance refs -> unresolved_governance_ref, zero-write (no fallback)", async () => {
      const h = await createHarness();
      const boot = await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, BOOT));
      expect(boot.status).toBe("committed");
      const goal = await h.submit(
        buildCreateGoalCommand(MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!, {
          commandId: "cmd-suite-goal-norefs",
          correlationId: "x",
          submittedAt: SCHEMA,
        }),
      );
      expect(goal.status).toBe("committed");
      const before = await eventsAfter(h);
      const receipt = await h.applyPlan(
        planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha"),
      );
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      // no active CompletionPolicy yet (nothing activated) -> unresolved
      expect(["unresolved_governance_ref", "not_found"]).toContain(receipt.code);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("goal not found -> not_found, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const receipt = await h.applyPlan(
        planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-beta", { goalId: "goal-unknown" }),
      );
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("not_found");
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    const draftWith = (
      mutate: (draft: PlanRevisionDraft) => PlanRevisionDraft,
    ): PlanRevisionDraft => {
      const cloned = structuredClone(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1) as PlanRevisionDraft;
      return mutate(cloned);
    };

    it("guard: no required executable task -> plan_guard_failed, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.tasks = d.tasks.map((t) => ({ ...t, requirementLevel: "optional" as const }));
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "missing_required_executable_task")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: no active required GoalGateTask -> plan_guard_failed, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.tasks = d.tasks.map((t) =>
          t.taskId === "gate-goal" ? { ...t, disposition: "deferred" as const } : t,
        );
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "missing_active_required_goal_gate")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: no required obligation -> plan_guard_failed, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.obligations = d.obligations.map((o) => ({ ...o, requirementLevel: "optional" as const }));
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "missing_required_obligation")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: required obligation without any required VR -> plan_guard_failed, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.obligations = d.obligations.map((o) => ({
          ...o,
          verificationRequirements: o.verificationRequirements.map((v) => ({
            ...v,
            requirementLevel: "optional" as const,
          })),
        }));
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      // every required obligation must compile >=1 REQUIRED VR per policy minimum
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "empty_verification_requirements")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: required executable task without required obligation mapping -> rejected, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.obligations = d.obligations.map((o) =>
          o.taskIds.includes("task-verify") ? { ...o, taskIds: o.taskIds.filter((id) => id !== "task-verify") } : o,
        );
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "task_obligation_mapping")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: required obligation without mapped work/gate task -> rejected, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.obligations = d.obligations.map((o) =>
          o.obligationId === "obl-2" ? { ...o, taskIds: [] } : o,
        );
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "obligation_task_mapping")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: VR kind outside the effective policy requirementKinds -> rejected, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.obligations = d.obligations.map((o) => ({
          ...o,
          verificationRequirements: o.verificationRequirements.map((v) => ({
            ...v,
            kind: "mutant-oracle",
          })),
        }));
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "unknown_requirement_kind")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: hierarchy dangling ref -> rejected, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.taskHierarchy = { parentOf: [...d.taskHierarchy.parentOf, { parentTaskId: "task-nope", childTaskId: "task-verify" }] };
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "dangling_task_ref")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: hierarchy cycle -> rejected, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.taskHierarchy = { parentOf: [
          { parentTaskId: "task-verify", childTaskId: "task-accept-plan" },
          { parentTaskId: "task-accept-plan", childTaskId: "task-install-contract" },
          { parentTaskId: "task-install-contract", childTaskId: "task-verify" },
        ] };
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "hierarchy_cycle")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: DAG dangling edge -> rejected, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.executionDag = { dependsOn: [...d.executionDag.dependsOn, { taskId: "task-verify", dependsOnId: "task-ghost", requires: { kind: "artifact", label: "x" } }] };
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "dangling_task_ref")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: DAG self dependency -> rejected, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.executionDag = { dependsOn: [...d.executionDag.dependsOn, { taskId: "task-verify", dependsOnId: "task-verify", requires: { kind: "artifact", label: "x" } }] };
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "self_dependency")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("guard: DAG cycle -> rejected, zero-write", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const draft = draftWith((d) => {
        d.executionDag = { dependsOn: [
          { taskId: "task-accept-plan", dependsOnId: "task-install-contract", requires: { kind: "artifact", label: "a" } },
          { taskId: "task-install-contract", dependsOnId: "task-accept-plan", requires: { kind: "artifact", label: "b" } },
        ] };
        return d;
      });
      const receipt = await h.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === "dag_cycle")).toBe(true);
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);
    });

    it("stale goal CAS: wrong expectedRevision -> revision_conflict, zero-write; replay idempotent", async () => {
      const h = await setupHarness();
      const before = await eventsAfter(h);
      const bad = await h.applyPlan(
        planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha", {
          expectedRevision: 99,
          idempotencyKey: "apply-stale",
        }),
      );
      expect(bad.status).toBe("rejected");
      if (bad.status !== "rejected") return;
      expect(bad.code).toBe("revision_conflict");
      expect((await eventsAfter(h)).events.length).toBe(before.events.length);

      // valid apply, then replay same identity+fingerprint
      const keep = {
        commandId: freshCommandId("cmd-suite-apply-idem"),
        correlationId: freshCorrelationId(),
        submittedAt: SCHEMA,
        projectId: "proj-alpha",
        expectedRevision: 1,
        idempotencyKey: "apply-idem-1",
      };
      const first = await h.applyPlan(buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, keep));
      expect(first.status).toBe("committed");
      const replay = await h.applyPlan(buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, keep));
      expect(replay.status).toBe("committed");
      if (replay.status !== "committed" || first.status !== "committed") return;
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(first.eventIds);
      expect(replay.commitCursor).toEqual(first.commitCursor);
    });

    it("pin immutability: moving the active ref does NOT change the accepted plan pins", async () => {
      const h = await setupHarness();
      await h.applyPlan(planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha"));
      await h.advanceProjection();
      const before = await h.planGraph({ projectId: "proj-alpha", goalId: "goal-1" });
      expect(before.status).toBe("ready");
      if (before.status !== "ready") return;

      // install + activate a SECOND (new) policy revision
      const fixture2 = {
        ...COMPLETION_POLICY_FIXTURE_V1,
        revision: 2,
        content: { ...COMPLETION_POLICY_FIXTURE_V1.content },
      };
      const cp2 = buildInstallCommand(fixture2, {
        commandId: freshCommandId("cmd-install-cp2-rev2"),
        correlationId: freshCorrelationId(),
        submittedAt: SCHEMA,
        projectId: "proj-alpha",
        idempotencyKey: "inst-cp-alpha-rev2",
      });
      expect((await h.install(cp2)).status).toBe("committed");
      if (cp2.commandType !== "InstallCompletionPolicyRevision") throw new Error("build");
      const act2 = await h.activate(
        buildActivateCommand(completionPolicyPinFor(cp2), {
          commandId: freshCommandId("cmd-act-cp-rev2"),
          correlationId: freshCorrelationId(),
          submittedAt: SCHEMA,
          projectId: "proj-alpha",
          expectedRevision: 1,
          idempotencyKey: "act-cp-rev2", // DISTINCT from the setupHarness activation key
        }),
      );
      expect(act2.status).toBe("committed");

      await h.advanceProjection();
      const after = await h.planGraph({ projectId: "proj-alpha", goalId: "goal-1" });
      expect(after.status).toBe("ready");
      if (after.status !== "ready") return;
      // pin unchanged: still revision 1 + original digest
      expect(after.graph.pinnedCompletionPolicy.ref.revision).toBe(1);
      expect(after.graph.pinnedCompletionPolicy.digest).toBe(before.graph.pinnedCompletionPolicy.digest);
    });

    it("freshness: not_ready != not_found for plan graph and task detail; cross-project isolation", async () => {
      const h = await setupHarness();
      // projection never advanced: even a nonexistent goal must be not_ready
      const early = await h.planGraph({ projectId: "proj-alpha", goalId: "goal-1" });
      expect(early.status).toBe("not_ready");
      await h.applyPlan(planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha"));
      await h.advanceProjection();
      const cursor = h.observedCursor();
      expect(cursor).not.toBeNull();
      // no atLeastCursor + no row -> not_ready (goal() freshness semantics; never not_found)
      const missingNoCursor = await h.planGraph({ projectId: "proj-alpha", goalId: "goal-2" });
      expect(missingNoCursor.status).toBe("not_ready");
      // covered by observedCursor + truly missing -> not_found
      const missing = await h.planGraph({
        projectId: "proj-alpha",
        goalId: "goal-2",
        atLeastCursor: cursor!,
      });
      expect(missing.status).toBe("not_found");
      const taskMissing = await h.taskDetail({
        projectId: "proj-alpha",
        goalId: "goal-1",
        taskId: "task-nope",
        atLeastCursor: cursor!,
      });
      expect(taskMissing.status).toBe("not_found");
      // beta reuses goal-1 + same plan ids -> strictly isolated (covered -> not_found)
      const betaGraph = await h.planGraph({
        projectId: "proj-beta",
        goalId: "goal-1",
        atLeastCursor: cursor!,
      });
      expect(betaGraph.status).toBe("not_found");
    });

    it("no dispatch outbox, TaskAttempt or AgentRun anywhere in the path", async () => {
      const h = await setupHarness();
      await h.applyPlan(planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha"));
      await h.advanceProjection();
      const page = await eventsAfter(h, 500);
      const json = JSON.stringify(page);
      expect(json).not.toMatch(/TaskAttempt/);
      expect(json).not.toMatch(/AgentRun/);
      expect(json).not.toMatch(/outbox/);
      const types = page.events.map((p) => p.event.eventType);
      // bootstrap fixture emits one ProjectBootstrapped + one WorkspaceBootstrapped
      // PER project/entry (proj-alpha + proj-beta).
      expect(types).toEqual([
        "ProjectBootstrapped",
        "ProjectBootstrapped",
        "WorkspaceBootstrapped",
        "WorkspaceBootstrapped",
        "CompletionPolicyInstalled",
        "ArchitectureBaselineInstalled",
        "CompletionPolicyActivated",
        "ArchitectureBaselineActivated",
        "GoalCreated",
        "PlanRevisionAccepted",
      ]);
    });
  });
}