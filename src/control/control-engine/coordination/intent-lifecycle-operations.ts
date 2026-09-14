import type { CommitCursor } from "../../../contracts/command-event.js";
import type {
CancelCommunicationCommand,
CommunicationClaimCommand,
CommunicationClaimReceipt,
CommunicationIntentRef,
CommunicationIntentSnapshot,
CommunicationIntentV1,
CommunicationSettleCommand,
CommunicationSettleReceipt,
CommunicationWriteReceipt,
DirectedRequestSnapshot,
RequestIntentCancellationCommand,
SubscriptionSnapshot,
WaitConditionRef,
WaitConditionSnapshot
} from "../../../contracts/coordination.js";
import {
cancelCommunicationFingerprint,
communicationClaimFingerprint,communicationIntentRefFor,
communicationSettleFingerprint,
directedRequestRefFor,requestIntentCancellationFingerprint,
subscriptionRefFor,waitAdmissionIntentIdFor,waitConditionRefFor,waitDeadlineIntentIdFor
} from "../../../contracts/coordination.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { deliverArchitectureReview } from "../architecture-review.js";
import {
decideIntentClaim
} from "../policies/coordination-rules.js";
import {
buildCommunicationIntentClaimCommit,
buildDirectedRequestCancelCommit,
buildIntentCancelRequestCommit,
buildIntentSettleCommit,
buildSubscriptionCancelCommit,
buildWaitCancelCommit,
communicationIntentRefForOf
} from "../records/coordination.js";
import {
checkCommandShape,
checkRoutePageProposal,
checkWaitConditionRefShape,
mapCommitReceipt,
mapSettleCommitRejection,
rejectWrite,
requireIsoTimestamp,
requireString
} from "./admission-support.js";
import { CoordinationOperationContext,isTerminalIntentStatus } from './operation-context.js';
import type { SubscriptionRoutingOperations } from './subscription-routing-operations.js';

/** Complete Control admission operations for this coordination responsibility. */
export class IntentLifecycleOperations {
  constructor(
    private readonly context: CoordinationOperationContext,
    private readonly subscriptions: SubscriptionRoutingOperations,
  ) {}

  // --------------------------------------------------------------------- //
  // 7. cancelCommunication（desired-state-first）                           //
  // --------------------------------------------------------------------- //

  async cancelCommunication(command: CancelCommunicationCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "CancelCommunication", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["reason"], "payload.reason", issues);
    const target = payload["target"];
    if (target !== "directed_request" && target !== "subscription" && target !== "wait") {
      issues.push("payload.target 必须是 directed_request|subscription|wait");
    }
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前聚合的正整数 revision");
    }
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const projectId = command.identity.projectId;
    const scopeWorkspace = workspaceId as string;
    const foldDeps = this.context.foldDeps(scopeWorkspace);

    if (target === "directed_request") {
      const ref = directedRequestRefFor(projectId, scopeWorkspace, command.aggregateId);
      const prior = await this.context.loadTyped<DirectedRequestSnapshot>(ref, "DirectedRequest");
      if (prior === null) return rejectWrite(command.commandId, "not_found", ["DirectedRequest 不存在：" + command.aggregateId]);
      if (prior.request.status === "cancelled" || prior.request.status === "expired") {
        return rejectWrite(command.commandId, "forbidden", ["DirectedRequest 已经是终态：" + prior.request.status]);
      }
      if (prior.revision !== command.expectedRevision) {
        return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
      }
      const batch = buildDirectedRequestCancelCommit({
        command,
        deps: foldDeps,
        fingerprint: cancelCommunicationFingerprint(command),
        prior,
      });
      const receipt = await this.context.deps.ledger.commit(batch);
      return mapCommitReceipt(receipt, command.commandId, canonicalJson(ref));
    }

    if (target === "subscription") {
      const ref = subscriptionRefFor(projectId, scopeWorkspace, command.aggregateId);
      const prior = await this.context.loadTyped<SubscriptionSnapshot>(ref, "Subscription");
      if (prior === null) return rejectWrite(command.commandId, "not_found", ["Subscription 不存在：" + command.aggregateId]);
      if (prior.subscription.status === "cancelled") {
        return rejectWrite(command.commandId, "forbidden", ["Subscription 已经取消"]);
      }
      if (prior.revision !== command.expectedRevision) {
        return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
      }
      const batch = buildSubscriptionCancelCommit({
        command,
        deps: foldDeps,
        fingerprint: cancelCommunicationFingerprint(command),
        prior,
      });
      const receipt = await this.context.deps.ledger.commit(batch);
      return mapCommitReceipt(receipt, command.commandId, canonicalJson(ref));
    }

    const ref = waitConditionRefFor(projectId, scopeWorkspace, command.aggregateId);
    const prior = await this.context.loadTyped<WaitConditionSnapshot>(ref, "WaitCondition");
    if (prior === null) return rejectWrite(command.commandId, "not_found", ["WaitCondition 不存在：" + command.aggregateId]);
    if (prior.wait.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["WaitCondition 已经不是 active：" + prior.wait.status]);
    }
    if (prior.revision !== command.expectedRevision) {
      return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
    }
    // desired-state-first：等待先写 cancelled；它自己的 deadline intent（当前实现唯一的
    // 定时 intent）在同一事务里被置为终态，因此任何在途消费者之后的 settle 都会被拒
    // （见 settleCommunicationIntent 的「已终态不得再 settle」守卫）。
    const deadlineIntent = await this.context.loadTyped<CommunicationIntentSnapshot>(
      communicationIntentRefForOf(projectId, scopeWorkspace, waitDeadlineIntentIdFor(command.aggregateId)),
      "CommunicationIntent",
    );
    const batch = buildWaitCancelCommit({
      command,
      deps: foldDeps,
      fingerprint: cancelCommunicationFingerprint(command),
      prior,
      intent: deadlineIntent !== null && isTerminalIntentStatus(deadlineIntent.intent.status) ? null : deadlineIntent,
    });
    const receipt = await this.context.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      /**
       * **先持久化取消意图，再调用执行能力**（协作通信可靠投递规则 / 先记取消意图）。
       *
       * desired state 已经在上面落账（wait = cancelled）。这之后仍可能被触发的是**由这个等待
       * 派生出来的机械 intent**：deadline intent 已在同一事务里终态化，而 wait_admission intent
       * 不在（它由 ensureWaitAdmission 在别的事务里建立，可能正 pending/leased）。若不标记它们，
       * 一个已取消的等待仍会不断被重新领取并调用 admitWaitSuccessor——那正是「取消意图没有先落账」
       * 的典型后果。这里只**标记**（零副作用）：真正的收敛由消费者在拿到当前 generation 后按
       * 租约与 sideEffectStarted 判定（见 CoordinationDrive.convergeCancelled）。
       */
      for (const intentRef of await this.derivedIntentsOfWait(ref, prior.revision)) {
        const loaded = await this.context.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
        if (loaded === null) continue;
        if (isTerminalIntentStatus(loaded.intent.status) || loaded.intent.status === "quarantined") continue;
        const cancelId = "cancel-wait-" + command.aggregateId + "-" + loaded.intent.intentId + "-r" + String(loaded.revision);
        await this.requestCommunicationIntentCancellation({
          commandId: cancelId,
          commandType: "RequestCommunicationIntentCancellation",
          schemaVersion: 1,
          aggregateId: loaded.intent.intentId,
          expectedRevision: loaded.revision,
          correlationId: cancelId,
          submittedAt: this.context.deps.now(),
          identity: { projectId, actor: { kind: "system", id: "coordination-cancel" }, idempotencyKey: cancelId },
          payload: { workspaceId: scopeWorkspace, reason: "所属等待已被取消：" + command.aggregateId },
        });
      }
    }
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(ref));
  }


  /**
   * 某个等待派生出来的机械 intent 的**确定性引用集合**。
   *
   * 两条派生规则（与生产者一一对应）：
   *   · wait_deadline：intentId = waitDeadlineIntentIdFor(waitId)，恰好一个；
   *   · wait_admission：intentId = waitAdmissionIntentIdFor(waitId, satisfiedRevision)，而
   *     satisfiedRevision 在建立时等于「当时的 wait.revision + 1」。wait 只会前进，因此历史上
   *     建立过的那些 satisfiedRevision 一定落在 1..(当前 revision + 1) 内——按 id 逐个探测就能
   *     **完整**枚举，不需要全量事件扫描，也不会猜到不存在的 id。
   */
  private async derivedIntentsOfWait(waitRef: WaitConditionRef, currentRevision: number): Promise<CommunicationIntentRef[]> {
    const refs: CommunicationIntentRef[] = [
      communicationIntentRefFor(waitRef.projectId, waitRef.workspaceId, waitDeadlineIntentIdFor(waitRef.waitId)),
    ];
    for (let satisfiedRevision = 1; satisfiedRevision <= currentRevision + 1; satisfiedRevision += 1) {
      refs.push(communicationIntentRefFor(waitRef.projectId, waitRef.workspaceId, waitAdmissionIntentIdFor(waitRef.waitId, satisfiedRevision)));
    }
    return refs;
  }



  // --------------------------------------------------------------------- //
  // 7b. requestCommunicationIntentCancellation（先持久化取消意图）              //
  // --------------------------------------------------------------------- //

  /**
   * **先持久化取消意图**（协作通信可靠投递规则 / 先记取消意图）。
   *
   * 允许的输入状态：pending / leased / retry_scheduled（未终态、未被人工隔离）。
   * 已终态（done/cancelled/outcome_unknown）与 quarantined 一律零写入拒绝：前者已经结束，
   * 后者是人工处置态，不能被自动流程改写成另一种状态。
   * **不发放新 generation**：已经产生的副作用不会因为这次标记而消失——收敛阶段必须继续看到
   * 同一个 generation 与 sideEffectStarted。
   */
  async requestCommunicationIntentCancellation(command: RequestIntentCancellationCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "RequestCommunicationIntentCancellation", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["reason"], "payload.reason", issues);
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前 CommunicationIntent 的正整数 revision");
    }
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);
    const scopeWorkspace = workspaceId as string;
    const intentRef = communicationIntentRefFor(command.identity.projectId, scopeWorkspace, command.aggregateId);
    const prior = await this.context.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
    if (prior === null) return rejectWrite(command.commandId, "not_found", ["CommunicationIntent 不存在：" + command.aggregateId]);
    if (isTerminalIntentStatus(prior.intent.status) || prior.intent.status === "quarantined") {
      return rejectWrite(command.commandId, "forbidden", ["intent 已经终态或已隔离，不能再标记取消：" + prior.intent.status]);
    }
    if (prior.revision !== command.expectedRevision) {
      return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
    }
    if (prior.intent.status === "cancel_requested") {
      // 已经标记过：同一条命令身份的重放交给账本判定；不同身份再来一次是幂等命中，不新写事实。
      return { status: "committed", commandId: command.commandId, replayed: true, eventIds: [], commitCursor: "c0000000001" as CommitCursor, revisions: [{ refKey: canonicalJson(intentRef as never), revision: prior.revision }] };
    }
    const batch = buildIntentCancelRequestCommit({
      command,
      deps: this.context.foldDeps(scopeWorkspace),
      fingerprint: requestIntentCancellationFingerprint(command),
      prior,
    });
    const receipt = await this.context.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(intentRef));
  }


  // --------------------------------------------------------------------- //
  // 8. claimCommunicationIntent                                            //
  // --------------------------------------------------------------------- //

  async claimCommunicationIntent(command: CommunicationClaimCommand): Promise<CommunicationClaimReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "CommunicationClaimIntent", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["consumerId"], "payload.consumerId", issues);
    const leaseDurationMs = payload["leaseDurationMs"];
    if (typeof leaseDurationMs !== "number" || !Number.isFinite(leaseDurationMs) || leaseDurationMs < 0) {
      issues.push("payload.leaseDurationMs 必须是非负数字");
    }
    const now = requireIsoTimestamp(payload["now"], "payload.now", issues);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid", issues };
    }

    const projectId = command.identity.projectId;
    const intentRef = communicationIntentRefFor(projectId, workspaceId as string, command.aggregateId);
    const prior = await this.context.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
    if (prior === null) {
      return { status: "not_found", commandId: command.commandId, intentRef };
    }

    const decision = decideIntentClaim({
      intent: prior.intent,
      consumerId: payload["consumerId"] as string,
      now: now as string,
    });
    if (!decision.allow) {
      if (decision.code === "owned_elsewhere") {
        return {
          status: "owned_elsewhere",
          commandId: command.commandId,
          intentRef,
          leaseOwner: prior.intent.leaseOwner,
          leaseExpiresAt: prior.intent.leaseExpiresAt,
        };
      }
      // not_claimable / requires_reconcile / cancel_requested：claim receipt 的联合类型
      // 里没有对应码，按既有语义映射为 rejected + 机器可读的 issues 前缀，绝不改写成 claimed。
      // 三种不可领取的原因分别写进 issues，调用方据此决定对账/等待/放弃：
      //   - requires_reconcile（已产生外部副作用且租约过期）→ 绝不能重新领取，必须先对账；
      //   - cancel_requested → desired-state 已写，不再发放新 generation；
      //   - not_claimable（未到 availableAt 或已是终态）→ 稍后重试。
      // 三者都映射为 code=invalid，且**零写入**（见文件头守卫顺序）。
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "invalid",
        issues: [
          decision.code + "：intent 当前不可领取（status=" + prior.intent.status +
          "，leaseGeneration=" + String(prior.intent.leaseGeneration) +
          "，sideEffectStarted=" + String(prior.intent.sideEffectStarted) + "）",
        ],
      };
    }

    // CAS 期望版本：先于 ledger 判定，给出明确的 revision_conflict 与当前版本。
    if (prior.revision !== command.expectedRevision) {
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: prior.revision };
    }

    const batch = buildCommunicationIntentClaimCommit({
      command,
      deps: this.context.foldDeps(workspaceId as string),
      fingerprint: communicationClaimFingerprint(command),
      prior,
      nextGeneration: decision.nextGeneration,
    });
    const receipt = await this.context.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      const claimed = batch.snapshots[0]!;
      return {
        status: "claimed",
        commandId: command.commandId,
        intentRef,
        leaseGeneration: claimed.intent.leaseGeneration,
        leaseOwner: claimed.intent.leaseOwner as string,
        leaseExpiresAt: claimed.intent.leaseExpiresAt as string,
        revision: claimed.revision,
        replayed: receipt.replayed,
        commitCursor: receipt.commitCursor,
      };
    }
    if (receipt.code === "revision_conflict") {
      const current = (receipt.currentVersions ?? []).find((v) => canonicalJson(v.ref) === canonicalJson(intentRef));
      return current === undefined
        ? { status: "rejected", commandId: command.commandId, code: "revision_conflict" }
        : { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: current.revision };
    }
    return {
      status: "rejected",
      commandId: command.commandId,
      code: receipt.code === "idempotency_conflict" ? "idempotency_conflict"
        : receipt.code === "unavailable" ? "unavailable" : "invalid",
    };
  }


  // --------------------------------------------------------------------- //
  // 9. settleCommunicationIntent                                           //
  // --------------------------------------------------------------------- //

  async settleCommunicationIntent(command: CommunicationSettleCommand): Promise<CommunicationSettleReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "CommunicationSettleIntent", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["consumerId"], "payload.consumerId", issues);
    const leaseGeneration = payload["leaseGeneration"];
    if (typeof leaseGeneration !== "number" || !Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
      issues.push("payload.leaseGeneration 必须是非负整数");
    }
    const outcome = payload["outcome"];
    if (outcome === "route_page") {
      checkRoutePageProposal(payload["page"], command.identity.projectId, workspaceId as string, issues);
    } else if (outcome === "wait_deadline") {
      checkWaitConditionRefShape(payload["waitRef"], "payload.waitRef", command.identity.projectId, workspaceId as string, issues);
      if (payload["observedStatus"] !== "active") issues.push('payload.observedStatus 必须是 "active"');
    } else if (outcome === "cancel_confirmed" || outcome === "catchup_page" || outcome === "architecture_delivery") {
      // 无附加字段。
    } else if (outcome === "unknown" || outcome === "quarantine" || outcome === "side_effect_started") {
      requireString(payload["reason"], "payload.reason", issues);
    } else if (outcome === "no_effect_failure") {
      requireString(payload["reason"], "payload.reason", issues);
      const backoffMs = payload["backoffMs"];
      if (typeof backoffMs !== "number" || !Number.isFinite(backoffMs) || backoffMs < 0) {
        issues.push("payload.backoffMs 必须是非负数字");
      }
    } else {
      issues.push("payload.outcome 必须是 route_page|wait_deadline|cancel_confirmed|unknown|quarantine|no_effect_failure|side_effect_started");
    }
    const settledAt = outcome === null || outcome === undefined
      ? null
      : requireIsoTimestamp(payload["settledAt"], "payload.settledAt", issues);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid", issues };
    }

    if(command.payload.outcome === 'architecture_delivery') return deliverArchitectureReview(this.context.deps,command as import('../../../contracts/architecture-review.js').ArchitectureDeliveryCommand);
    const projectId = command.identity.projectId;
    const scopeWorkspace = workspaceId as string;
    const intentRef = communicationIntentRefFor(projectId, scopeWorkspace, command.aggregateId);
    const prior = await this.context.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
    if (prior === null) {
      return { status: "rejected", commandId: command.commandId, code: "not_found", issues: ["CommunicationIntent 不存在：" + command.aggregateId] };
    }

    // 过期 generation 不能 settle（desired-state-first 与租约竞争的核心守卫）。
    if (prior.intent.leaseGeneration !== leaseGeneration) {
      return { status: "stale_generation", commandId: command.commandId, intentRef, currentGeneration: prior.intent.leaseGeneration };
    }
    if (isTerminalIntentStatus(prior.intent.status)) {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "forbidden",
        issues: ["intent 已经是终态，不能重复 settle：" + prior.intent.status],
      };
    }
    const outcomeKind = outcome as string;
    if (prior.intent.leaseOwner !== null && prior.intent.leaseOwner !== command.payload.consumerId) {
      return { status: 'rejected', commandId: command.commandId, code: 'forbidden', issues: ['Only the current lease owner may settle this generation'] };
    }
    if (outcomeKind === 'cancel_confirmed' && prior.intent.sideEffectStarted) {
      return { status: 'rejected', commandId: command.commandId, code: 'forbidden', issues: ['Started side effect requires reconciliation, not an unsupported cancellation confirmation'] };
    }
    /**
     * 协作通信可靠投递规则：**只有已证实无副作用的失败**才能进入退避重试（协议约束 2.4 / 外部副作用恢复）。
     * 这里是权威判定点：intent 一旦标记过 sideEffectStarted，退避请求一律零写入拒绝——
     * 结果不明时必须对账或隔离，不能自动再调用一次。
     */
    if (outcomeKind === "no_effect_failure" && prior.intent.sideEffectStarted) {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "forbidden",
        issues: ["该 intent 已经产生过外部副作用（sideEffectStarted=true），结果未知时不允许自动重试"],
      };
    }
    /**
     * 哪些 outcome 要求"此刻确实持有租约"：
     *   · route_page / wait_deadline / no_effect_failure / side_effect_started 会推进业务状态或重排
     *     重试，必须来自一次真实领取（status 必须是 leased）；
     *   · cancel_confirmed / unknown / quarantine 是**收口**结果，可以由 cancel_requested 状态收敛
     *     ——取消标记刻意不动租约字段（generation/owner/expiresAt 原样保留），因此"同一 generation
     *     收口"这条不变式仍然成立（上面已逐条核对 generation）。
     */
    const requiresLease = outcomeKind !== "cancel_confirmed" && outcomeKind !== "unknown" && outcomeKind !== "quarantine";
    if (requiresLease && prior.intent.status !== "leased") {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "forbidden",
        issues: ["intent 当前不是 leased，不能以该 outcome settle：status=" + prior.intent.status],
      };
    }
    if (prior.revision !== command.expectedRevision) {
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: prior.revision };
    }

    const foldDeps = this.context.foldDeps(scopeWorkspace);
    const fingerprint = communicationSettleFingerprint(command);

    if (outcomeKind === "catchup_page") return this.subscriptions.settleCatchupPage(command, prior);

    if (outcomeKind === "route_page") {
      return this.subscriptions.settleRoutePage(command, prior);
    }

    if (outcomeKind === "wait_deadline") {
      if (prior.intent.domain.kind !== "wait_deadline") {
        return { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["intent 的 domain 不是 wait_deadline"] };
      }
      const waitRef = payload["waitRef"] as WaitConditionRef;
      if (canonicalJson(waitRef) !== canonicalJson(prior.intent.domain.waitRef)) {
        return { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.waitRef 与 intent domain 不一致"] };
      }
      const wait = await this.context.loadTyped<WaitConditionSnapshot>(waitRef, "WaitCondition");
      if (wait === null) {
        return { status: "rejected", commandId: command.commandId, code: "not_found", issues: ["WaitCondition 不存在：" + waitRef.waitId] };
      }
      // 等待已经不是 active（例如同事务里已被 satisfied/cancelled）：deadline 到点无
      // 事可做，只把 intent 收敛为 done，**不**改写等待。
      if (wait.wait.status !== "active") {
        const batch = buildIntentSettleCommit({ command, deps: foldDeps, fingerprint, prior, status: "done", waits: [] });
        const receipt = await this.context.deps.ledger.commit(batch);
        if (receipt.status !== "committed") return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(intentRef));
        return {
          status: "committed", commandId: command.commandId, replayed: receipt.replayed, intentRef,
          intentStatus: "done", deliveries: [], nextIntentRef: null,
          eventIds: [...receipt.eventIds], commitCursor: receipt.commitCursor,
        };
      }
      if (wait.wait.deadlineAt === null || wait.wait.deadlineAt > (settledAt as string)) {
        return {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["deadline 未到，不能按 wait_deadline 收敛：" + String(wait.wait.deadlineAt)],
        };
      }
      const nextWait: WaitConditionSnapshot = {
        ...wait,
        revision: wait.revision + 1,
        wait: { ...wait.wait, status: "timed_out", settledAt: settledAt as string },
        recordedAt: foldDeps.now(),
      };
      // 注意：等待收敛为 timed_out，而 intent 自身收敛为 done——CommunicationIntentStatus
      // 里没有 timed_out（它是等待的业务状态，不是机械调度状态，机械状态与业务状态分离规则「两类状态不合并」）。
      const batch = buildIntentSettleCommit({ command, deps: foldDeps, fingerprint, prior, status: "done", waits: [nextWait] });
      const receipt = await this.context.deps.ledger.commit(batch);
      if (receipt.status !== "committed") return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(intentRef));
      return {
        status: "committed", commandId: command.commandId, replayed: receipt.replayed, intentRef,
        intentStatus: "done", deliveries: [], nextIntentRef: null,
        eventIds: [...receipt.eventIds], commitCursor: receipt.commitCursor,
      };
    }

    // no_effect_failure / side_effect_started 是**非终态**：状态由 buildIntentSettleCommit 按
    // outcome 折叠（retry_scheduled + availableAt / 保持 leased + sideEffectStarted），这里给出的
    // status 只对真正的终态分支有意义。
    const status: CommunicationIntentV1["status"] =
      outcomeKind === "cancel_confirmed" ? "cancelled"
      : outcomeKind === "unknown" ? "outcome_unknown"
      : outcomeKind === "no_effect_failure" ? "retry_scheduled"
      : outcomeKind === "side_effect_started" ? "leased"
      : "quarantined";
    const batch = buildIntentSettleCommit({ command, deps: foldDeps, fingerprint, prior, status, waits: [] });
    const receipt = await this.context.deps.ledger.commit(batch);
    if (receipt.status !== "committed") return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(intentRef));
    return {
      status: "committed", commandId: command.commandId, replayed: receipt.replayed, intentRef,
      intentStatus: status, deliveries: [], nextIntentRef: null,
      eventIds: [...receipt.eventIds], commitCursor: receipt.commitCursor,
    };
  }
}

