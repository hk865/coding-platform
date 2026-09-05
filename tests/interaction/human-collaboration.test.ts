/**
 * Lane-C HumanCollaboration tests (Goal create slice). Driven against the
 * consistent ScriptedControlEngine / ScriptedReadModelIndex doubles. Covers:
 * success, every user-facing rejection mapping, same-request retry (same
 * identity + fresh commandId), conflict on same key with different payload,
 * goalView forwarding with freshness fencing, covered-but-absent not_found,
 * cross-scope isolation, and propagation of unexpected control exceptions.
 */
import { describe, expect, it } from "vitest";
import {
  HumanCollaborationImpl,
  createHumanCollaboration,
} from "../../src/interaction/human-collaboration.js";
import { commandIdentityKey } from "../../src/contracts/command-event.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import {
  ScriptedControlEngine,
  committedReceiptFor,
  rejectedReceiptFor,
} from "../../src/contracts/testing/control.double.js";
import { ScriptedReadModelIndex } from "../../src/contracts/testing/read-model.double.js";
import type { CreateGoalRequest } from "../../src/contracts/modules.js";

const FIXTURE = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;
const ALPHA = FIXTURE.scopes[0]!;
const BETA = FIXTURE.scopes[1]!;

function alphaRequest(overrides: Partial<CreateGoalRequest> = {}): CreateGoalRequest {
  return {
    projectId: ALPHA.projectId,
    workspaceId: ALPHA.workspaceId,
    goalId: ALPHA.goalId,
    objective: ALPHA.objective,
    actor: ALPHA.actor,
    idempotencyKey: FIXTURE.sharedIdempotencyKey,
    ...overrides,
  };
}

function makeCollab(control: ScriptedControlEngine, readModel: ScriptedReadModelIndex) {
  const d = createDeterministicDeps();
  return createHumanCollaboration({
    control,
    readModel,
    commandId: d.commandId,
    correlationId: d.correlationId,
    now: d.clock,
  });
}

describe("HumanCollaborationImpl (lane C)", () => {
  it("constructs via the documented dependency shape", () => {
    const d = createDeterministicDeps();
    const collab = new HumanCollaborationImpl({
      control: new ScriptedControlEngine(),
      readModel: new ScriptedReadModelIndex(),
      commandId: d.commandId,
      correlationId: d.correlationId,
      now: d.clock,
    });
    expect(collab).toBeInstanceOf(HumanCollaborationImpl);
  });

  it("maps committed to persisted and builds a well-formed CreateGoal command", async () => {
    const control = new ScriptedControlEngine();
    const readModel = new ScriptedReadModelIndex();
    const collab = makeCollab(control, readModel);
    const result = await collab.createGoal(alphaRequest());
    expect(result).toEqual({
      status: "persisted",
      goalId: ALPHA.goalId,
      commitCursor: makeCommitCursor(1),
    });
    const cmd = control.submitCalls[0]!;
    expect(cmd.commandType).toBe("CreateGoal");
    expect(cmd.schemaVersion).toBe(1);
    expect(cmd.expectedRevision).toBe(0);
    expect(cmd.identity).toEqual({
      projectId: ALPHA.projectId,
      actor: ALPHA.actor,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });
    expect(cmd.aggregateId).toBe(ALPHA.goalId);
    expect(cmd.payload).toEqual({
      workspaceId: ALPHA.workspaceId,
      objective: ALPHA.objective,
    });
    expect(cmd.commandId).toBe("cmd-0001");
    expect(cmd.correlationId).toBe("corr-0001");
    expect(cmd.submittedAt).toBe(FIXED_ISO_2026_09_05);
  });

  const rejectionCases: Array<[string, string]> = [
    ["invalid", "invalid_request"],
    ["not_found", "scope_not_found"],
    ["revision_conflict", "conflict"],
    ["idempotency_conflict", "conflict"],
    ["unavailable", "temporarily_unavailable"],
  ];

  it.each(rejectionCases)("maps %s rejection to %s", async (code, expected) => {
    const control = new ScriptedControlEngine({
      submit: (cmd) => rejectedReceiptFor(cmd, code as "invalid" | "not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable"),
    });
    const readModel = new ScriptedReadModelIndex();
    const collab = makeCollab(control, readModel);
    const result = await collab.createGoal(alphaRequest({ idempotencyKey: "k" }));
    expect(result).toEqual({ status: "rejected", code: expected });
  });

  it("retry reuses the same identity but issues a fresh commandId", async () => {
    const control = new ScriptedControlEngine();
    const readModel = new ScriptedReadModelIndex();
    const collab = makeCollab(control, readModel);
    const request = alphaRequest({ idempotencyKey: "shared-retry" });
    const first = await collab.createGoal(request);
    const second = await collab.createGoal(request);
    expect(first.status).toBe("persisted");
    expect(second.status).toBe("persisted");
    expect(control.submitCalls).toHaveLength(2);
    const c1 = control.submitCalls[0]!;
    const c2 = control.submitCalls[1]!;
    expect(c1.commandId).toBe("cmd-0001");
    expect(c2.commandId).toBe("cmd-0002");
    expect(c1.commandId).not.toBe(c2.commandId);
    expect(commandIdentityKey(c1.identity)).toBe(commandIdentityKey(c2.identity));
    expect(c1.identity).toEqual(c2.identity);
  });

  it("same idempotency key with a different payload maps to conflict", async () => {
    let calls = 0;
    const control = new ScriptedControlEngine({
      submit: (cmd) => {
        calls += 1;
        if (calls === 1) return committedReceiptFor(cmd);
        return rejectedReceiptFor(cmd, "idempotency_conflict");
      },
    });
    const readModel = new ScriptedReadModelIndex();
    const collab = makeCollab(control, readModel);
    const first = await collab.createGoal(
      alphaRequest({ idempotencyKey: "same-key", objective: ALPHA.objective }),
    );
    expect(first.status).toBe("persisted");
    const second = await collab.createGoal(
      alphaRequest({ idempotencyKey: "same-key", objective: "totally different" }),
    );
    expect(second).toEqual({ status: "rejected", code: "conflict" });
  });

  it("goalView forwards to the read model with freshness fencing", async () => {
    const control = new ScriptedControlEngine();
    let ready = false;
    const readModel = new ScriptedReadModelIndex({
      goal: (q) => {
        if (ready) {
          return {
            status: "ready",
            goal: {
              goalId: q.goalId,
              projectId: q.projectId,
              workspaceId: q.workspaceId,
              objective: "x",
              desiredState: "active",
              activePlanRevision: null,
              aggregateRevision: 1,
              sourceCursor: makeCommitCursor(1),
            },
            observedCursor: makeCommitCursor(1),
          };
        }
        return {
          status: "not_ready",
          requiredCursor: q.atLeastCursor!,
          observedCursor: null,
        };
      },
    });
    const collab = makeCollab(control, readModel);
    const query = {
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      atLeastCursor: makeCommitCursor(1),
    };
    const before = await collab.goalView(query);
    expect(before.status).toBe("not_ready");
    ready = true;
    const after = await collab.goalView(query);
    expect(after.status).toBe("ready");
    expect(readModel.goalCalls).toEqual([query, query]);
  });

  it("goalView returns not_found once covered and absent", async () => {
    const control = new ScriptedControlEngine();
    const readModel = new ScriptedReadModelIndex({
      goal: () => ({ status: "not_found", observedCursor: makeCommitCursor(1) }),
    });
    const collab = makeCollab(control, readModel);
    const res = await collab.goalView({
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: "absent-goal",
      atLeastCursor: makeCommitCursor(1),
    });
    expect(res.status).toBe("not_found");
  });

  it("keeps the shared idempotency key / local ids scoped by projectId", async () => {
    const control = new ScriptedControlEngine();
    const readModel = new ScriptedReadModelIndex();
    const collab = makeCollab(control, readModel);
    await collab.createGoal(
      alphaRequest({ idempotencyKey: FIXTURE.sharedIdempotencyKey }),
    );
    await collab.createGoal({
      projectId: BETA.projectId,
      workspaceId: BETA.workspaceId,
      goalId: BETA.goalId,
      objective: BETA.objective,
      actor: BETA.actor,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });
    expect(control.submitCalls).toHaveLength(2);
    const a = control.submitCalls[0]!;
    const b = control.submitCalls[1]!;
    expect(a.identity.projectId).toBe(ALPHA.projectId);
    expect(b.identity.projectId).toBe(BETA.projectId);
    expect(a.identity.idempotencyKey).toBe(FIXTURE.sharedIdempotencyKey);
    expect(b.identity.idempotencyKey).toBe(FIXTURE.sharedIdempotencyKey);
    expect(commandIdentityKey(a.identity)).not.toBe(commandIdentityKey(b.identity));
    expect(a.aggregateId).toBe(ALPHA.goalId);
    expect(b.aggregateId).toBe(BETA.goalId);
  });

  it("propagates unexpected control exceptions instead of masking them", async () => {
    const control = new ScriptedControlEngine({
      submit: () => {
        throw new Error("boom");
      },
    });
    const readModel = new ScriptedReadModelIndex();
    const collab = makeCollab(control, readModel);
    await expect(collab.createGoal(alphaRequest({ idempotencyKey: "k" }))).rejects.toThrow(
      "boom",
    );
  });
});
