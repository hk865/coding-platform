import {ensureInitialWorkAssignment} from './initial-work-assignment.js';
import { randomUUID } from 'node:crypto';
/**
 * Ordinary outbox dispatch: assemble bounded Context, bind/link durable work,
 * commit Control.startRun, then call the runtime and submit observed facts.
 * The dispatch intent must exist before side effects. Rejections do not create a
 * new attempt; failures remain visible. Replacement dispatch has its own consumer.
 * Unknown runtime effects must be reconciled and cannot be repaired by blind retry.
 */
import type {
  DispatchDriveFailure,
  DispatchDriveResult,
  DispatchDriveTrigger,
  DispatchPort,
  RunHandle,
  RunPort,
} from "../../contracts/ports.js";
import type { StateLedger } from "../../contracts/ledger.js";
import type { ControlEngine } from "../../contracts/modules.js";
import type { TaskContextPort, TaskContextRequestV1 } from "../../contracts/task-envelope.js";
import type { DispatchIntentV1, RunSnapshot } from "../../contracts/dispatch.js";
import { buildDispatchStartCommand, buildRunFactCommand } from "../../contracts/commands/dispatch.js";
import { replacementAttemptRefFor } from "../../contracts/handoff.js";
import { ensureWorkIdentity } from "./work-identity.js";
import { createModelCallAccess } from './model-call-access.js';
import { CoordinationDrive } from "./coordination-drive.js";
import type { SuccessorPreparationResult } from "./successor-run-preparation.js";

export type DispatchEngineDeps = {
  initialWorkAssignments?: (intent: DispatchIntentV1) => boolean;
  ledger: StateLedger;
  control: ControlEngine;
  contextCompiler: TaskContextPort;
  runtime: RunPort;
  /**
   * 协作通信推进使用的调用方时钟（默认系统时钟）。它是**注入**的：claim 的 now、settle 的
   * settledAt 与租约到期都按它计算，测试与宿主因此可以给确定性的时间。
   */
  now?: () => string;
  maxConcurrentRuns?: number;
  /** 协作 intent 的消费者 id（确定性；默认 COORDINATION_DRIVE_CONSUMER_ID）。 */
  coordinationConsumerId?: string;
  /** 协作 intent 的领取租约时长（默认 60s）。 */
  coordinationLeaseMs?: number;
  /** 路由页一页最多处理多少个订阅（默认 COMMUNICATION_PAGE_MAX_DELIVERIES）。 */
  coordinationPageSize?: number;
  prepareAlternativeReports?: (wait: import('../../contracts/coordination.js').WaitConditionSnapshot) => Promise<import('../../contracts/alternative-report.js').AlternativeReportInspection | null>;
  /**
   * 后继 Run 的准备入口（CM-1A-001 第 3 工作段，缺陷回交 SPEC-01 的正解）。
   *
   * 缺省表示宿主没有接线这条路径：普通 outbox 的语义与接线前逐字节相同。
   * 接线时**只有**由接续受理产生的 intent 会走到它——从持久事实重建 RunSpec，
   * 先 `preflight` 再 `prepare`（两步可重放/幂等），然后才继续既有的
   * `control.startRun` → `runtime.start`。已经运行或结果未知的后继不会被重新准备/重新启动
   * （见 successor-run-preparation.ts）。
   */
  successorPreparation?: (intent: DispatchIntentV1) => Promise<SuccessorPreparationResult>;
};

export class DispatchEngineImpl implements DispatchPort {
  private readonly executionConsumerId = 'dispatch-' + randomUUID();
  private readonly coordination: CoordinationDrive;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private async inSlot(work: () => Promise<void>): Promise<void> {
    const configured = this.deps.maxConcurrentRuns;
    const limit = configured !== undefined && Number.isFinite(configured) ? Math.max(1, Math.min(32, Math.floor(configured))) : 2;
    if (this.active >= limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { await work(); } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }

  constructor(private readonly deps: DispatchEngineDeps) {
    this.coordination = new CoordinationDrive({
      ledger: deps.ledger,
      control: deps.control,
      now: deps.now ?? (() => new Date().toISOString()),
      ...(deps.prepareAlternativeReports ? { prepareAlternativeReports: deps.prepareAlternativeReports } : {}),
      ...(deps.coordinationConsumerId === undefined ? {} : { consumerId: deps.coordinationConsumerId }),
      ...(deps.coordinationLeaseMs === undefined ? {} : { leaseDurationMs: deps.coordinationLeaseMs }),
      ...(deps.coordinationPageSize === undefined ? {} : { pageSize: deps.coordinationPageSize }),
    });
  }

  async drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult> {
    const maxIntents = trigger.maxIntents ?? 8;
    // CM-1A-001 第 3 工作段：协作通信（route page / wait deadline / wait admission）**在同一收口内**
    // 推进（D05：不新增第二生产入口、不新开后台循环）。先跑协作面：本 drive 内由接续产生的唯一后继
    // outbox 因此可以在同一次 drive 的 ordinary 段被派发；两段各受 maxIntents 上界约束，
    // 协作面的异常被它自己收进 failures（绝不让 ordinary outbox 停摆）。
    const coordination = await this.coordination.drive(maxIntents);
    const pending = await this.deps.ledger.pendingDispatchIntents(maxIntents, { workKind: 'ordinary', dueAt: (this.deps.now ?? (() => new Date().toISOString()))() });

    let scanned = 0;
    let started = 0;
    let completed = 0;
    const failures: DispatchDriveFailure[] = [];
    await Promise.all(pending.map(entry => this.inSlot(async () => {
      const intent = entry.intent;
      if (intent.work?.kind === 'review') return;
      const outboxRef = entry.ref;

      // P1-06 guard: an intent with a co-committed ReplacementAttempt belongs
      // to the HandoffPort (driveHandoff) — the normal drive NEVER assembles a
      // non-handoff context for a replacement run (skipped BEFORE scanning;
      // not a failure, not counted).
      const replacementResult = await this.deps.ledger.load(
        replacementAttemptRefFor(intent.projectId, intent.goalId, intent.taskId, intent.attemptRef.attemptId),
      );
      if (replacementResult.status === "found") {
        return;
      }

      scanned += 1;

      // 2. assemble (bounded envelope + vault bundle).
      let assembled;
      try {
        assembled = await this.deps.contextCompiler.assemble(this.buildContextRequest(intent));
      } catch (err) {
        failures.push({ effect: 'none',
          intentId: intent.intentId,
          outboxRef,
          code: "context_rejected",
          message: String(err),
        });
        return;
      }

      if (assembled.status === "rejected") {
        failures.push({ effect: 'none',
          intentId: intent.intentId,
          outboxRef,
          code: "context_rejected",
          message: "context rejected: " + assembled.issues.join("; "),
        });
        return;
      }
      if (assembled.status === "needs_material") {
        failures.push({ effect: 'none',
          intentId: intent.intentId,
          outboxRef,
          code: "rejected",
          message: "needs_material: " + assembled.gaps.map((g) => g.message).join("; "),
        });
        return;
      }

      const { envelope, manifest } = assembled;

      // 2b. 真实 Run 的持久工作身份。位置是刻意的——
      //   - 在**上下文组装成功之后**：材料缺口/越权路径保持零写入，不会留下一个没有 Run 的身份；
      //   - 在**DispatchStartRun 之前**：运行一旦启动，工作身份必定已经在 canonical 账本里，
      //     因此派发时编译的历史材料一定指向一个真实存在的 workId；
      //   - 在**唯一收口处**：三个 claimTask 调用点都要经过这里才会启动运行，不存在第二条建立路径。
      // workId 规则与"重复派发不产生第二个身份"的论证见 ./work-identity.ts。
      const workIdentity = await ensureWorkIdentity({ ledger: this.deps.ledger, control: this.deps.control, now: () => intent.requestedAt }, intent);
      if (workIdentity.status === "rejected") {
        failures.push({ effect: 'none',
          intentId: intent.intentId,
          outboxRef,
          code: "rejected",
          message: "work identity " + workIdentity.code + ": " + workIdentity.message,
        });
        return;
      }

      if(this.deps.initialWorkAssignments?.(intent)){
        try{await ensureInitialWorkAssignment(this.deps,intent,workIdentity.workId);}
        catch(error){failures.push({effect:'none',intentId:intent.intentId,outboxRef,code:'rejected',message:String(error)});return;}
      }

      // 2c. 后继 RunSpec 的准备（只对**接续受理产生**的 intent 生效）。
      //     位置是刻意的：在上下文组装与工作身份之后（材料缺口/身份冲突路径保持零准备），
      //     在 startRun/runtime.start 之前——真实 Runtime 必须先有已登记的 exact runId spec。
      //     准备不可用意味着"这次运行的输入无法诚实重建"：如实报告成可见失败，**不启动**。
      if (this.deps.successorPreparation !== undefined) {
        const prepared = await this.deps.successorPreparation(intent);
        if (prepared.status === "unavailable" || prepared.status === "not_restartable") {
          failures.push({ effect: 'none',
            intentId: intent.intentId,
            outboxRef,
            code: "runtime_error",
            message: prepared.status === "unavailable"
              ? "后继运行准备失败（" + prepared.code + "）：" + prepared.message
              : "后继运行不重新启动：" + prepared.message,
          });
          return;
        }
      }

      // 3. startRun (dispatch-start commit) BEFORE runtime.start.
      const freshRun = await this.deps.ledger.load(intent.runRef);
      if (freshRun.status !== 'found') throw Error('Dispatch Run disappeared');
      const startRevision = freshRun.snapshot.revision;
      const startCommand = buildDispatchStartCommand({
        // Preserve the identity used for this persisted command protocol.
        actor: { kind: "human", id: "user-1" },
        commandId: "start-" + intent.intentId + "-r" + startRevision,
        correlationId: intent.correlationId,
        submittedAt: intent.requestedAt,
        projectId: intent.projectId,
        runId: intent.runRef.runId,
        /** P1-07 fix (P1-03 latent): a run-scoped idempotencyKey — a shared
         * default would make every start of the same project collide. */
        idempotencyKey: "p1-03-start-" + intent.runRef.runId + "-r" + startRevision,
        expectedRevision: startRevision,
        executionConsumerId: this.executionConsumerId,
        envelope,
        manifest,
      });
      const startReceipt = await this.deps.control.startRun(startCommand);
      if (startReceipt.status !== "committed") {
        const code = startReceipt.status === "rejected" && startReceipt.code === "not_found" ? "not_found" : "rejected";
        failures.push({ effect: 'none',
          intentId: intent.intentId,
          outboxRef,
          code,
          message: "startRun rejected: " + startReceipt.code,
        });
        return;
      }
      if (startReceipt.replayed) return;
      const generation = ((freshRun.snapshot as RunSnapshot).executionAuthorization?.generation ?? 0) + 1;
      const entered = await this.deps.control.runFact(buildRunFactCommand({ projectId: intent.projectId,
        actor: { kind: 'system', id: this.executionConsumerId }, commandId: 'enter-' + intent.intentId + '-g' + generation,
        idempotencyKey: 'enter-' + intent.intentId + '-g' + generation, correlationId: intent.correlationId,
        submittedAt: (this.deps.now ?? (() => new Date().toISOString()))(), runId: intent.runRef.runId,
        expectedRevision: startRevision + 1, fact: { kind: 'execution_entered', runRef: intent.runRef, generation, consumerId: this.executionConsumerId } }));
      if (entered.status !== 'committed' || entered.replayed) {
        failures.push({ effect: 'none', intentId: intent.intentId, outboxRef, code: 'rejected', message: 'Execution authorization was fenced before Runtime entry' });
        return;
      }
      started += 1;

      // 4. only NOW invoke the runtime (outbox-before-side-effect).
      try {
        const handle = await this.deps.runtime.start(envelope, { modelCalls: createModelCallAccess({
          ledger: this.deps.ledger, control: this.deps.control, envelope,
          now: this.deps.now ?? (() => new Date().toISOString()),
        }) });
        const consumed = await this.consumeRun(handle, intent);
        completed += consumed;
      } catch (err) {
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code: "runtime_error",
          message: String(err),
        });
      }
    })));

    // Known preparation failures may retry mechanically, without another TaskAttempt.
    for (const failure of failures) {
      if (failure.effect !== 'none') continue;
      const entry = pending.find(row => row.intent.intentId === failure.intentId);
      if (!entry) continue;
      const loaded = await this.deps.ledger.load(entry.intent.runRef);
      if (loaded.status !== 'found' || (loaded.snapshot as RunSnapshot).envelope) continue;
      const deferred = await this.deps.control.runFact(buildRunFactCommand({
        actor: { kind: 'system', id: 'dispatch' }, projectId: entry.intent.projectId,
        runId: entry.intent.runRef.runId, expectedRevision: loaded.snapshot.revision,
        commandId: 'defer-' + entry.intent.intentId + '-' + entry.revision,
        idempotencyKey: 'defer-' + entry.intent.intentId + '-' + entry.revision,
        correlationId: entry.intent.correlationId, submittedAt: (this.deps.now ?? (() => new Date().toISOString()))(),
        fact: { kind: 'dispatch_deferred', runRef: entry.intent.runRef, reason: failure.message },
      }));
      if (deferred.status !== 'committed') failure.message += '; durable retry was not recorded: ' + deferred.code;
    }
    const remaining = await this.deps.ledger.pendingDispatchIntents(Number.MAX_SAFE_INTEGER, { workKind: 'ordinary', includeQuarantined: true });
    const now = (this.deps.now ?? (() => new Date().toISOString()))();
    const oldestPendingAt = remaining.map(e => e.pendingAt).sort()[0] ?? null;
    const backlog = {
      pending: remaining.length,
      due: remaining.filter(e => !e.schedule?.quarantined && (!e.schedule || e.schedule.availableAt <= now)).length,
      delayed: remaining.filter(e => !e.schedule?.quarantined && e.schedule && e.schedule.availableAt > now).length,
      quarantined: remaining.filter(e => e.schedule?.quarantined).length,
      oldestPendingAt, oldestPendingAgeMs: oldestPendingAt ? Math.max(0, Date.parse(now) - Date.parse(oldestPendingAt)) : null,
      nextAvailableAt: remaining.filter(e => !e.schedule?.quarantined).map(e => e.schedule?.availableAt ?? e.pendingAt).sort()[0] ?? null,
      blocked: remaining.filter(e => e.schedule).slice(0, 32).map(e => ({ intentId: e.intent.intentId,
        reason: e.schedule!.lastFailure, availableAt: e.schedule!.availableAt, quarantined: e.schedule!.quarantined })),
    };
    // 本次 drive 完全没有协作事实可推进时**不**带上 coordination 字段：ordinary-only 的调用方
    // （以及它们对结果的逐字段比对）看到的形状与之前逐字节相同。有协作事实（含只有 backlog 的）
    // 时如实给出。
    const coordinationReported =
      coordination.backlog.observed > 0 || coordination.claimed > 0 || coordination.failures.length > 0;
    return {
      scanned, started, completed, pendingRemaining: remaining.length, failures,
      ...(remaining.length ? { backlog } : {}),
      ...(coordinationReported ? { coordination } : {}),
    };
  }

  private buildContextRequest(intent: DispatchIntentV1): TaskContextRequestV1 {
    return {
      schemaVersion: 1,
      requestId: "context-" + intent.intentId,
      projectId: intent.projectId,
      workspaceId: intent.workspaceId,
      goalId: intent.goalId,
      taskId: intent.taskId,
      planRef: intent.planRef,
      runRef: intent.runRef,
      attemptRef: intent.attemptRef,
      roleBinding: intent.roleBinding,
      workspaceSnapshot: intent.workspaceSnapshot,
      declaredPermissions: intent.declaredPermissions,
      scope: {
        tools: [...intent.declaredPermissions.tools],
        writeScope: [...intent.declaredPermissions.writeScope],
      },
      budget: intent.budget,
      submittedAt: intent.requestedAt,
    };
  }

  consumeRun(handle: RunHandle, intent: DispatchIntentV1, expectedRunRevision?: number): Promise<number> {
    return consumeDispatchedRun(this.deps.control, handle, intent, expectedRunRevision, this.deps.ledger);
  }
}

export function createDispatchEngine(deps: DispatchEngineDeps): DispatchEngineImpl {
  return new DispatchEngineImpl(deps);
}

export async function consumeDispatchedRun(control: Pick<ControlEngine, 'runFact'>, handle: RunHandle, intent: DispatchIntentV1, expectedRunRevision?: number, ledger?: Pick<StateLedger, 'load'>): Promise<number> {
    let completed = 0;
    // The Run is at revision 2 right after startRun; each accepted fact returns
    // its new run revision, which we track for the next single-writer CAS.
    let expectedRevision = expectedRunRevision ?? 2;
    for (;;) {
      const events = await handle.pollFreshEvents();
      if (events.length === 0) break;
      let terminal = false;
      for (const event of events) {
        let receipt;
        for (let retry = 0; retry < 8; retry++) {
        if (ledger) {
          const loaded = await ledger.load(intent.runRef);
          if (loaded.status !== 'found') return completed;
          expectedRevision = loaded.snapshot.revision;
        }
        const command = buildRunFactCommand({
          actor: { kind: "human", id: "user-1" },
          idempotencyKey: "p1-03-runfact",
          commandId: "fact-" + intent.intentId + "-" + String(event.sequence),
          correlationId: intent.correlationId,
          submittedAt: event.occurredAt,
          projectId: intent.projectId,
          runId: intent.runRef.runId,
          expectedRevision,
          fact: { kind: "runtime_event", event },
        });
        receipt = await control.runFact(command);
        if (!ledger || receipt.status === 'committed' || receipt.code !== 'revision_conflict') break;
        }
        if (!receipt) return completed;
        if (receipt.status === "committed") {
          expectedRevision = receipt.runRevision;
          if (receipt.terminal) {
            completed += 1;
            terminal = true;
            break;
          }
        } else {
          // Rejected fact (duplicate/stale/conflict/after_terminal/revision
          // conflict): stop consuming; the outbox/run stay as committed. No
          // retry in P1-03.
          if (ledger && receipt.code !== 'after_terminal' && receipt.code !== 'duplicate_event') throw Error('Runtime fact was not recorded: ' + receipt.code + ' event=' + event.eventType);
          return completed;
        }
      }
      if (terminal) break;
    }
    return completed;
  }
