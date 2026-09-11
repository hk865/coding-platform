/**
 * P1-03 Control entry: unique claim (dispatch intent + lease + attempt + run).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Guard order (all
 * zero-write except the single atomic dispatch-claim commit):
 *   1. schema validation (validateDispatchClaimCommand) -> invalid;
 *   2. Goal exists (else not_found) and its Workspace exists (else not_found);
 *   3. evaluateTaskEligibility over loaded facts (goal/workspace/plan/lease/
 *      resource = command budget + now). A structural ineligibility (any reason
 *      other than resource_unavailable/leased) -> rejected(ineligible, issues),
 *      zero write.
 *   4. The ONLY structural resource signal is an existing lease. If that lease
 *      is held by a DIFFERENT run the claim is a competing claim -> surfaced as
 *      revision_conflict (the loser, zero write) BEFORE the commit; if it is the
 *      SAME run (an idempotent replay of this exact claim, or the caller's own
 *      prior claim) we proceed to the commit and let the ledger's idempotency
 *      replay win (committed/replayed) — replay priority over CAS.
 *   5. Deterministic footprint: buildDispatchClaimLedgerCommit (fold-equality
 *      with the shared fixture builder, given the same ids), then
 *      ledger.commit and map the receipt (committed/replayed vs rejected:
 *      invalid/revision_conflict/idempotency_conflict/unavailable).
 *
 * RW-11 追加守卫（ADR 0003 D4-2，插在第 4 步之后、提交之前）：
 *   项目当前生效的 CoordinationPolicy 如果登记了角色矩阵（roles.catalog），那么
 *   claim 的角色绑定必须与矩阵和已安装的角色规格相符——角色不存在、绑定的 revision
 *   不是矩阵 pin 的 revision、pin 指向的规格未安装／摘要不符、该角色的生效引用与 pin
 *   不一致、或声明的权限超出规格授权上界，任一条不成立即拒绝（顶层码仍用既有的
 *   `ineligible`，细节写在 issues 的 role_binding_not_admissible 里）且零写入。
 *   没有矩阵的项目沿用 RW-11 之前的绑定语义；Control 不编造默认角色目录。
 *
 *   为什么「同一 run 的既有 lease」跳过这条守卫：P1-03 的冻结语义是「重放优先于 CAS」——
 *   已经落账的 claim 再提交一次必须返回 committed/replayed，不能被事后变动的矩阵
 *   变成一个拒绝（它没有产生新的授权，也没有新的写入）。这条跳过只覆盖
 *   `isLeaseOnly` 且 lease 属于同一个 run 的分支，新 claim 一律要过守卫。
 */
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessFacts,
  TaskEligibility,
  TaskLeaseSnapshot,
} from "../../contracts/dispatch.js";
import { dispatchOutboxRefFor, runRefFor, taskAttemptRefFor, taskLeaseRefFor } from "../../contracts/dispatch.js";
import { evaluateTaskEligibility } from "./policies/task-eligibility.js";
import { evaluateRoleBindingAdmission, type RoleBindingAdmissionFactsV1 } from "./policies/role-binding-admission.js";
import { resolveActiveCoordinationPolicy } from "./policies/coordination-policy.js";
import { projectRoleSpecActiveRefFor, type ProjectRoleSpecActiveSnapshot, type RoleSpecRevisionSnapshot } from "../../contracts/role-spec.js";
import { loadLivePlan } from "./dispatch-facts.js";
import type { LedgerCommitReceipt } from "../../contracts/ledger.js";
import type { GoalSnapshot } from "../../contracts/ledger.js";
import type { PlanRevisionSnapshot, PlanRevisionRef } from "../../contracts/plan.js";
import { validateDispatchClaimCommand } from '../../contracts/validation/dispatch.js';
import { buildDispatchClaimLedgerCommit } from "./records/dispatch.js";
import type { ControlEngineDeps } from "./control-engine.js";

function isLeaseOnly(eligibility: TaskEligibility): boolean {
  if (eligibility.eligible) return false;
  return eligibility.reasons.every(
    (r) => r.code === "resource_unavailable" && r.detail === "leased",
  );
}

async function claimTaskImpl(
  deps: ControlEngineDeps,
  command: DispatchClaimCommand,
): Promise<DispatchClaimReceipt> {
  // Guard 1: schema validation.
  const validationIssues = validateDispatchClaimCommand(command);
  if (validationIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const projectId = command.identity.projectId;
  const goalId = command.payload.goalId;
  const taskId = command.aggregateId;

  // Guard 2: ref resolution (Goal then its Workspace).
  const goalRef = { aggregateType: "Goal" as const, projectId, goalId };
  const goalResult = await deps.ledger.load(goalRef);
  if (goalResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const goal = goalResult.snapshot as GoalSnapshot;
  const workspaceRef = goal.workspaceRef;
  const workspaceResult = await deps.ledger.load(workspaceRef);
  if (workspaceResult.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  const workspaceRevision = workspaceResult.snapshot.revision;
  const workspaceId = workspaceRef.workspaceId;

  // Guard 3: accepted PlanRevision (for eligibility + the deterministic fold).
  const planRef: PlanRevisionRef | null = goal.activePlanRevision;
  let plan: PlanRevisionSnapshot | null = null;
  if (planRef !== null) {
    const planResult = await deps.ledger.load(planRef);
    if (planResult.status === "found") {
      plan = await loadLivePlan(deps.ledger, planResult.snapshot as PlanRevisionSnapshot);
    }
  }

  // Lease.
  const leaseRef = taskLeaseRefFor(projectId, goalId, taskId);
  const leaseResult = await deps.ledger.load(leaseRef);
  const leaseSnapshot: TaskLeaseSnapshot | null =
    leaseResult.status === "found" && leaseResult.snapshot.ref.aggregateType === "TaskLease"
      ? (leaseResult.snapshot as TaskLeaseSnapshot)
      : null;
  const lease = leaseSnapshot
    ? { status: "leased" as const, holderRunId: leaseSnapshot.holderRunId, grantedAt: leaseSnapshot.grantedAt }
    : { status: "none" as const };

  const facts: DispatchReadinessFacts = {
    projectId,
    goalId,
    goalDesiredState: goal.desiredState,
    goalActivePlanRevision: goal.activePlanRevision,
    plan,
    lease,
    resource: {
      tokenBudget: command.payload.budget.tokenBudget,
      deadline: command.payload.budget.deadline,
      now: deps.now(),
    },
  };
  const eligibility: TaskEligibility = evaluateTaskEligibility(facts, taskId);

  // 同 run 的既有 lease：这是重放/重复提交，交给账本的幂等与 CAS 裁决（P1-03 冻结语义），
  // RW-11 的角色守卫不拦截它（见文件头说明）。
  let selfLeaseFallThrough = false;
  if (!eligibility.eligible) {
    if (isLeaseOnly(eligibility)) {
      // The only structural blocker is an existing lease. A competing claimant
      // (different run) loses as revision_conflict; the owner's own replay
      // proceeds so the ledger's idempotency can return committed/replayed.
      if (leaseSnapshot !== null && leaseSnapshot.holderRunId !== command.payload.runId) {
        return {
          status: "rejected",
          commandId: command.commandId,
          code: "revision_conflict",
          currentRevision: leaseSnapshot.revision,
        };
      }
      // Self-lease: fall through to the commit; ledger decides replay vs conflict.
      selfLeaseFallThrough = true;
    } else {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "ineligible",
        issues: eligibility.reasons,
      };
    }
  }

  if (planRef === null) {
    // Unreachable for an eligible claim (plan_not_accepted is structural), but
    // keep the fold safe: a claim can never proceed without an accepted plan.
    return { status: "rejected", commandId: command.commandId, code: "ineligible", issues: eligibility.reasons };
  }

  // Guard 4.5（RW-11）：角色绑定必须与项目的角色矩阵和角色规格相符，否则零写入。
  if (!selfLeaseFallThrough) {
    const admission = await evaluateRoleBindingAdmissionForClaim(deps, projectId, command);
    if (!admission.admissible) {
      return { status: "rejected", commandId: command.commandId, code: "ineligible", issues: admission.reasons };
    }
  }

  // Guard 5: deterministic fold + atomic commit (fold-equality with the fixture
  // builder — the ledger validator + CAS/idempotency resolve the outcome).
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildDispatchClaimLedgerCommit(command, {
    eventId,
    occurredAt,
    workspaceId,
    planRef,
    workspaceRevision,
  });

  const receipt = await deps.ledger.commit(batch);
  return mapClaimReceipt(receipt, command);
}

/**
 * RW-11：把账本事实读成纯策略的输入（读取顺序固定，全部只读）。
 *   - 项目当前生效策略的角色矩阵（没有生效策略／正文没有 roles → null，沿用既有语义）；
 *   - 矩阵 pin 指向的规格 revision（未安装即 null，策略会据此拒绝）；
 *   - 该角色在项目上的生效引用（缺失即 null，策略会据此拒绝）。
 * 任何一次读取失败都只是「事实缺失」，由策略决定拒绝还是沿用——这里绝不补默认值。
 */
async function evaluateRoleBindingAdmissionForClaim(
  deps: ControlEngineDeps,
  projectId: string,
  command: DispatchClaimCommand,
): Promise<ReturnType<typeof evaluateRoleBindingAdmission>> {
  const policy = await resolveActiveCoordinationPolicy(deps.ledger, projectId);
  const matrix = policy?.content.roles ?? null;
  const roleId = command.payload.roleBinding.templateId;
  let pinnedSpec: RoleSpecRevisionSnapshot | null = null;
  let activeRevision = null as RoleBindingAdmissionFactsV1["activeRevision"];
  const pin = matrix === null || !Object.prototype.hasOwnProperty.call(matrix.catalog, roleId) ? undefined : matrix.catalog[roleId];
  if (pin !== undefined) {
    const installed = await deps.ledger.load(pin.ref);
    if (installed.status === "found" && installed.snapshot.ref.aggregateType === "RoleSpecRevision") {
      pinnedSpec = installed.snapshot as RoleSpecRevisionSnapshot;
    }
    const active = await deps.ledger.load(projectRoleSpecActiveRefFor(projectId, roleId));
    if (active.status === "found" && active.snapshot.ref.aggregateType === "ProjectRoleSpecActive") {
      activeRevision = (active.snapshot as ProjectRoleSpecActiveSnapshot).activeRevision;
    }
  }
  return evaluateRoleBindingAdmission({
    roleBinding: command.payload.roleBinding,
    declaredPermissions: command.payload.declaredPermissions,
    matrix,
    pinnedSpec,
    activeRevision,
  });
}

function mapClaimReceipt(
  receipt: LedgerCommitReceipt,
  command: DispatchClaimCommand,
): DispatchClaimReceipt {
  if (receipt.status === "committed") {
    const projectId = command.identity.projectId;
    const goalId = command.payload.goalId;
    const taskId = command.aggregateId;
    const attemptId = command.payload.attemptId;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      leaseRef: taskLeaseRefFor(projectId, goalId, taskId),
      attemptRef: taskAttemptRefFor(projectId, goalId, taskId, attemptId),
      runRef: runRefFor(projectId, goalId, command.payload.runId),
      outboxRef: dispatchOutboxRefFor(projectId, goalId, taskId, attemptId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }

  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict": {
      const target = receipt.currentVersions?.find(
        (v) =>
          v.ref.aggregateType === "TaskLease" &&
          v.ref.projectId === command.identity.projectId &&
          v.ref.goalId === command.payload.goalId &&
          v.ref.taskId === command.aggregateId,
      );
      const currentRevision = target?.revision ?? receipt.currentVersions?.[0]?.revision;
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "revision_conflict",
        ...(currentRevision !== undefined ? { currentRevision } : {}),
      };
    }
  }
}

export function claimTask(
  deps: ControlEngineDeps,
  command: DispatchClaimCommand,
): Promise<DispatchClaimReceipt> {
  return claimTaskImpl(deps, command);
}
