/**
 * RW-11（ADR 0003 D4-2）claim 守卫用例：角色矩阵 + 角色规格真的在拦 claim。
 *
 * 每个拒绝用例都断言两件事：顶层码仍是既有的 `ineligible`（不新造 receipt 码）、
 * 细节在 issues 的 role_binding_not_admissible 里；以及**零写入**——事件数不变，
 * 而且没有留下 lease／attempt／run／outbox 任何一条快照。
 *
 * 另外两条边界用例：
 *   - 没有角色矩阵的项目沿用 RW-11 之前的绑定语义（不假装已校验，也不拦既有链路）；
 *   - 守卫读的是**安装进去的规格正文**：把 executor 规格换成只读后，同一个 claim 立刻被拒。
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine/control-engine.js";
import { InMemoryLedger } from "../../src/data/state-ledger/in-memory-ledger.js";
import type { LedgerCommit, LedgerCommitReceipt, StateLedger } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand, buildGoalCreateLedgerCommit, goalSnapshotFor } from "../contract-support/fixtures/goal-fixtures.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildActivateLedgerCommit, buildInstallCommand, buildInstallLedgerCommit } from "../../src/fixtures/governance-fixtures.js";
import { architectureBaselinePinFor, completionPolicyPinFor } from "../../src/contracts/governance.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import { DISPATCH_DEPENDENT_TASK_ID, DISPATCH_PLAN_REVISION_FIXTURE_V1, buildDispatchClaimCommand } from "../../src/fixtures/dispatch-fixtures.js";
import { buildPlanLedgerCommit } from "../../src/control/control-engine/records/plan.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import { buildCoordinationPolicyActivateCommand, buildCoordinationPolicyInstallCommand } from "../../src/contracts/commands/governance.js";
import { taskAttemptRefFor, taskLeaseRefFor, runRefFor, dispatchOutboxRefFor, type DispatchClaimCommand, type RoleBindingRefV1 } from "../../src/contracts/dispatch.js";
import { roleSpecContentDigest, type RoleSpecContentV1 } from "../../src/contracts/role-spec.js";
import {
  ROLE_SOURCE_EXECUTOR,
  ROLE_SOURCE_PLANNER,
  ROLE_SOURCE_RECORDER,
  buildCoordinationPolicyContentWithRolesV1,
  buildCoordinationPolicyContentWithoutRolesV1,
  buildRoleMatrixFixture,
  buildRoleSpecActivateCommandFor,
  buildRoleSpecInstallCommandFor,
  roleSpecPinFor,
  roleSpecSourceFor,
} from "../../src/fixtures/role-spec-fixtures.js";

const PROJECT = "proj-alpha";
const GOAL = "goal-1";
const WORKSPACE = "ws-shared";
const TASK = "task-run-adaptor";
const FIXED = FIXED_ISO_2026_09_05;
const AT = "2026-09-10T00:00:00.000Z";
const ACTOR = { kind: "human", id: "tester" } as const;
const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: PROJECT, planId: "plan-dispatch-mvp" };

class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    return super.commit(batch);
  }
}

function makeHarness() {
  const ledger = new RecordingLedger();
  const d = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: d.clock, eventId: d.eventId });
  return { ledger, engine };
}

type Harness = ReturnType<typeof makeHarness>;

async function bootstrapGoalAndPlan(ledger: StateLedger): Promise<void> {
  const bootCmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: "cmd-bootstrap", correlationId: "corr-bootstrap", submittedAt: FIXED });
  expect((await ledger.commit(buildBootstrapLedgerCommit(bootCmd, { eventIds: ["evt-b1", "evt-b2", "evt-b3", "evt-b4"], occurredAt: FIXED }))).status).toBe("committed");
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  const goalCmd = buildCreateGoalCommand(scope, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED });
  expect((await ledger.commit(buildGoalCreateLedgerCommit(goalCmd, { eventId: "evt-goal", occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 }))).status).toBe("committed");

  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, { commandId: "cmd-install-cp", correlationId: "corr-install-cp", submittedAt: FIXED, projectId: PROJECT, idempotencyKey: "inst-cp" }) as InstallCompletionPolicyRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(cp, { eventId: "evt-install-cp", occurredAt: FIXED }));
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, { commandId: "cmd-install-ab", correlationId: "corr-install-ab", submittedAt: FIXED, projectId: PROJECT, idempotencyKey: "inst-ab" }) as InstallArchitectureBaselineRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(ab, { eventId: "evt-install-ab", occurredAt: FIXED }));
  await ledger.commit(buildActivateLedgerCommit(buildActivateCommand(completionPolicyPinFor(cp), { commandId: "cmd-act-cp", correlationId: "corr-act-cp", submittedAt: FIXED, projectId: PROJECT, expectedRevision: 1, idempotencyKey: "act-cp" }), { eventId: "evt-act-cp", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 }));
  await ledger.commit(buildActivateLedgerCommit(buildActivateCommand(architectureBaselinePinFor(ab), { commandId: "cmd-act-ab", correlationId: "corr-act-ab", submittedAt: FIXED, projectId: PROJECT, expectedRevision: 1, idempotencyKey: "act-ab" }), { eventId: "evt-act-ab", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 }));

  const apply = buildApplyPlanCommand(DISPATCH_PLAN_REVISION_FIXTURE_V1, { commandId: "cmd-apply", correlationId: "corr-apply", submittedAt: FIXED, projectId: PROJECT, expectedRevision: 1, idempotencyKey: "apply" });
  const goal = await ledger.load({ aggregateType: "Goal", projectId: PROJECT, goalId: GOAL });
  if (goal.status !== "found") throw new Error("goal not found");
  expect((await ledger.commit(buildPlanLedgerCommit(apply, {
    eventId: "evt-apply", occurredAt: FIXED, acceptedAt: FIXED,
    pins: { completionPolicy: completionPolicyPinFor(cp), architectureBaseline: architectureBaselinePinFor(ab) },
    baseGoal: goalSnapshotFor(buildCreateGoalCommand(scope, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED })),
  }))).status).toBe("committed");
}

async function installAndActivateRole(harness: Harness, roleId: string, suffix: string): Promise<void> {
  const install = await harness.engine.installRoleSpec(buildRoleSpecInstallCommandFor(roleId, {
    commandId: "claim-install-" + roleId + "-" + suffix,
    correlationId: "claim-corr-" + roleId + "-" + suffix,
    submittedAt: AT,
    projectId: PROJECT,
    actor: ACTOR,
    idempotencyKey: "claim-install-key-" + roleId + "-" + suffix,
  }));
  expect(install.status, "install " + roleId).toBe("committed");
  const activate = await harness.engine.activateRoleSpec(buildRoleSpecActivateCommandFor(roleId, {
    commandId: "claim-activate-" + roleId + "-" + suffix,
    correlationId: "claim-corr-act-" + roleId + "-" + suffix,
    submittedAt: AT,
    projectId: PROJECT,
    actor: ACTOR,
    idempotencyKey: "claim-activate-key-" + roleId + "-" + suffix,
    expectedRevision: 1,
  }));
  expect(activate.status, "activate " + roleId).toBe("committed");
}

async function installPolicyWithMatrix(harness: Harness, content: Parameters<typeof buildCoordinationPolicyInstallCommand>[0]["content"], policyId: string): Promise<void> {
  const install = await harness.engine.installCoordinationPolicy(buildCoordinationPolicyInstallCommand({ policyId, content }, {
    commandId: "claim-policy-" + policyId,
    correlationId: "claim-corr-policy-" + policyId,
    submittedAt: AT,
    projectId: PROJECT,
    actor: ACTOR,
    idempotencyKey: "claim-policy-key-" + policyId,
  }));
  expect(install.status).toBe("committed");
  if (install.status !== "committed") throw new Error("policy install failed");
  const activate = await harness.engine.activateCoordinationPolicy(buildCoordinationPolicyActivateCommand({ ref: install.revisionRef, digest: install.contentDigest }, {
    commandId: "claim-policy-act-" + policyId,
    correlationId: "claim-corr-policy-act-" + policyId,
    submittedAt: AT,
    projectId: PROJECT,
    actor: ACTOR,
    idempotencyKey: "claim-policy-act-key-" + policyId,
    expectedRevision: 1,
  }));
  expect(activate.status).toBe("committed");
}

function executorBinding(overrides: Partial<RoleBindingRefV1> = {}): RoleBindingRefV1 {
  return { schemaVersion: 1, bindingId: "binding-executor", templateId: ROLE_SOURCE_EXECUTOR, templateRevision: "1", bindingVersion: 1, policyRevision: "human-implementation-v1", ...overrides };
}

function claimCmd(deps: {
  commandId: string;
  roleBinding?: RoleBindingRefV1;
  declaredPermissions?: { tools: string[]; writeScope: string[] };
  taskId?: string;
  runId?: string;
  attemptId?: string;
}): DispatchClaimCommand {
  return buildDispatchClaimCommand({
    commandId: deps.commandId,
    correlationId: "corr-" + deps.commandId,
    submittedAt: FIXED,
    projectId: PROJECT,
    idempotencyKey: deps.commandId,
    taskId: deps.taskId ?? TASK,
    runId: deps.runId ?? "run-" + deps.commandId,
    attemptId: deps.attemptId ?? "attempt-" + deps.commandId,
    roleBinding: deps.roleBinding ?? executorBinding(),
    declaredPermissions: deps.declaredPermissions ?? { tools: ["read", "write", "shell"], writeScope: ["src/control"] },
  });
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 5000 });
  return page.events.length;
}

/** 零写入：事件数不变，且没有留下任何 claim 产物。 */
async function expectZeroWrite(ledger: StateLedger, before: number, command: DispatchClaimCommand): Promise<void> {
  expect(await eventCount(ledger)).toBe(before);
  const goalId = command.payload.goalId;
  for (const ref of [
    taskLeaseRefFor(PROJECT, goalId, command.aggregateId),
    taskAttemptRefFor(PROJECT, goalId, command.aggregateId, command.payload.attemptId),
    runRefFor(PROJECT, goalId, command.payload.runId),
    dispatchOutboxRefFor(PROJECT, goalId, command.aggregateId, command.payload.attemptId),
  ]) {
    expect((await ledger.load(ref)).status, ref.aggregateType).toBe("not_found");
  }
}

describe("RW-11 claim 守卫：角色矩阵 + 角色规格", () => {
  it("登记齐全且权限在界内的 claim 正常提交（守卫不会拦下合法链路）", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    await installAndActivateRole(harness, ROLE_SOURCE_EXECUTOR, "ok");
    await installAndActivateRole(harness, ROLE_SOURCE_PLANNER, "ok");
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT), "with-roles");

    const receipt = await harness.engine.claimTask(claimCmd({ commandId: "cmd-ok" }));
    expect(receipt.status).toBe("committed");
  });

  it("角色不存在（未登记在矩阵里）→ ineligible/role_not_registered 且零写入", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    await installAndActivateRole(harness, ROLE_SOURCE_EXECUTOR, "unreg");
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]), "unreg");

    const command = claimCmd({ commandId: "cmd-unregistered", roleBinding: executorBinding({ templateId: "template-short-lived-runner", templateRevision: "2026-09-05" }) });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("ineligible");
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible" && issue.detail === "role_not_registered")).toBe(true);
    await expectZeroWrite(harness.ledger, before, command);
  });

  it("绑定 revision 不是矩阵 pin 的 revision → role_spec_stale 且零写入", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    await installAndActivateRole(harness, ROLE_SOURCE_EXECUTOR, "stale-rev");
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]), "stale-rev");

    const command = claimCmd({ commandId: "cmd-stale-rev", roleBinding: executorBinding({ templateRevision: "2" }) });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("ineligible");
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible" && issue.detail === "role_spec_stale")).toBe(true);
    await expectZeroWrite(harness.ledger, before, command);
  });

  it("矩阵 pin 指向未安装的规格 → role_spec_not_installed 且零写入", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    // 只装策略（矩阵引用了 executor 的规格），但那份规格从未安装。
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]), "not-installed");

    const command = claimCmd({ commandId: "cmd-not-installed" });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible" && issue.detail === "role_spec_not_installed")).toBe(true);
    await expectZeroWrite(harness.ledger, before, command);
  });

  it("规格只装未激活（生效引用缺失）→ role_spec_stale 且零写入", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    const install = await harness.engine.installRoleSpec(buildRoleSpecInstallCommandFor(ROLE_SOURCE_EXECUTOR, {
      commandId: "claim-install-only", correlationId: "claim-corr-install-only", submittedAt: AT, projectId: PROJECT, actor: ACTOR, idempotencyKey: "claim-install-only-key",
    }));
    expect(install.status).toBe("committed");
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]), "install-only");

    const command = claimCmd({ commandId: "cmd-install-only" });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible" && issue.detail === "role_spec_stale")).toBe(true);
    await expectZeroWrite(harness.ledger, before, command);
  });

  it("声明工具超出规格授权 → permissions_exceed_spec 且零写入", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    await installAndActivateRole(harness, ROLE_SOURCE_EXECUTOR, "tools");
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]), "tools");

    const command = claimCmd({ commandId: "cmd-tools", declaredPermissions: { tools: ["read", "write", "shell", "git-push"], writeScope: ["src/control"] } });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible" && issue.detail === "permissions_exceed_spec")).toBe(true);
    await expectZeroWrite(harness.ledger, before, command);
  });

  it("只读角色声明写入范围 → permissions_exceed_spec 且零写入", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    await installAndActivateRole(harness, ROLE_SOURCE_RECORDER, "readonly");
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_RECORDER]), "readonly");

    const command = claimCmd({
      commandId: "cmd-readonly",
      roleBinding: executorBinding({ templateId: ROLE_SOURCE_RECORDER, templateRevision: "1" }),
      declaredPermissions: { tools: ["read"], writeScope: ["src/control"] },
    });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible" && issue.detail === "permissions_exceed_spec")).toBe(true);
    await expectZeroWrite(harness.ledger, before, command);
  });

  it("没有角色矩阵的项目沿用既有绑定语义（不假装已校验，也不拦既有链路）", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    // 生效策略里没有 roles：矩阵不存在，claim 走 RW-11 之前的绑定语义。
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithoutRolesV1(), "no-roles");
    const receipt = await harness.engine.claimTask(claimCmd({
      commandId: "cmd-no-matrix",
      roleBinding: executorBinding({ templateId: "template-short-lived-runner", templateRevision: "2026-09-05" }),
    }));
    expect(receipt.status).toBe("committed");
  });

  it("守卫读的是安装进去的规格正文：把 executor 规格换成只读后同一个 claim 立刻被拒", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    // 人为构造一份「只读版 executor」source，经同一条正式路径安装并激活。
    const readOnlyContent: RoleSpecContentV1 = {
      ...roleSpecSourceFor(ROLE_SOURCE_EXECUTOR).content,
      permissions: { tools: ["read"], writeScope: "none" },
    };
    const install = await harness.engine.installRoleSpec({
      commandId: "claim-install-readonly-executor",
      commandType: "InstallRoleSpecRevision",
      schemaVersion: 1,
      identity: { projectId: PROJECT, actor: ACTOR, idempotencyKey: "claim-install-readonly-executor-key" },
      correlationId: "claim-corr-readonly-executor",
      submittedAt: AT,
      payload: { roleId: ROLE_SOURCE_EXECUTOR, content: readOnlyContent, contentDigest: roleSpecContentDigest(readOnlyContent, ROLE_SOURCE_EXECUTOR, 1) },
    });
    expect(install.status).toBe("committed");
    if (install.status !== "committed") return;
    // 激活必须用**刚安装的**那份 revision 与摘要作为 pin（fixture 的 pin 指向默认正文，会摘要不符）。
    const activate = await harness.engine.activateRoleSpec({
      commandId: "claim-activate-readonly-executor",
      commandType: "ActivateRoleSpecRevision",
      schemaVersion: 1,
      identity: { projectId: PROJECT, actor: ACTOR, idempotencyKey: "claim-activate-readonly-executor-key" },
      aggregateId: ROLE_SOURCE_EXECUTOR,
      expectedRevision: 1,
      correlationId: "claim-corr-activate-readonly-executor",
      submittedAt: AT,
      payload: { target: { ref: install.revisionRef, digest: install.contentDigest } },
    });
    expect(activate.status).toBe("committed");

    // 矩阵 pin 也必须指向这份新的内容摘要（否则 pin 与落账内容不符）。
    const matrix = { catalog: { [ROLE_SOURCE_EXECUTOR]: { ref: install.revisionRef, digest: install.contentDigest } }, coordinator: { roleId: ROLE_SOURCE_EXECUTOR, note: "测试用" } };
    await installPolicyWithMatrix(harness, { ...buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]), roles: matrix }, "readonly-executor");

    const command = claimCmd({ commandId: "cmd-readonly-executor" });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible" && issue.detail === "permissions_exceed_spec")).toBe(true);
    await expectZeroWrite(harness.ledger, before, command);

    // 同一份规格下、声明只在界内的 claim 仍然可以提交（拒绝只针对越界声明）。
    const ok = await harness.engine.claimTask(claimCmd({ commandId: "cmd-readonly-executor-ok", declaredPermissions: { tools: ["read"], writeScope: [] } }));
    expect(ok.status).toBe("committed");
  });

  it("同一 run 的既有 claim 重放优先于事后变动的矩阵（账本幂等裁决，不变成拒绝）", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    await installAndActivateRole(harness, ROLE_SOURCE_EXECUTOR, "replay");
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]), "replay");

    const command = claimCmd({ commandId: "cmd-replay-matrix", runId: "run-replay-matrix", attemptId: "attempt-replay-matrix" });
    const first = await harness.engine.claimTask(command);
    expect(first.status).toBe("committed");

    // 事后换一份「不含 executor」的矩阵策略并激活：已落账 claim 的重放仍必须返回 committed/replayed。
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_PLANNER]), "replay-narrowed");
    const replay = await harness.engine.claimTask(command);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed" && first.status === "committed") {
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(first.eventIds);
    }
  });

  it("矩阵与生效引用冲突（pin 摘要与已安装规格不符）→ role_spec_stale 且零写入", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    await installAndActivateRole(harness, ROLE_SOURCE_EXECUTOR, "digest");
    const pin = roleSpecPinFor(PROJECT, ROLE_SOURCE_EXECUTOR);
    await installPolicyWithMatrix(harness, {
      ...buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]),
      roles: { catalog: { [ROLE_SOURCE_EXECUTOR]: { ref: pin.ref, digest: "a".repeat(64) } }, coordinator: { roleId: ROLE_SOURCE_EXECUTOR, note: "伪造摘要" } },
    }, "digest-conflict");

    const command = claimCmd({ commandId: "cmd-digest-conflict" });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible" && issue.detail === "role_spec_stale")).toBe(true);
    await expectZeroWrite(harness.ledger, before, command);
  });

  it("任务不可派发与角色绑定不符同时存在时，先给出的仍是任务资格原因（既有顺序不变）", async () => {
    const harness = makeHarness();
    await bootstrapGoalAndPlan(harness.ledger);
    await installPolicyWithMatrix(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]), "order");
    const command = claimCmd({ commandId: "cmd-order", taskId: DISPATCH_DEPENDENT_TASK_ID, roleBinding: executorBinding({ templateId: "unregistered-role", templateRevision: "1" }) });
    const before = await eventCount(harness.ledger);
    const receipt = await harness.engine.claimTask(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.issues?.some((issue) => issue.code === "deps_unsatisfied")).toBe(true);
    expect(receipt.issues?.some((issue) => issue.code === "role_binding_not_admissible")).toBe(false);
    await expectZeroWrite(harness.ledger, before, command);
  });
});
