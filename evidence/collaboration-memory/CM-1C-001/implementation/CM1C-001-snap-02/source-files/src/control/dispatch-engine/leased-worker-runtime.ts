import { randomUUID } from 'node:crypto';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { RunPort, RunHandle } from '../../contracts/ports.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { WorkspaceLeasePort } from '../../contracts/workspace-lease.js';
import type { RuntimeContextMaterials } from '../../data/context-compiler/runtime-context.js';
import type { ReviewerRuntimeAccess } from '../../contracts/reviewer-context.js';
import type { CoordinationRuntimeGrantV1 } from '../../contracts/coordination-tools.js';
import type { CodingAgentRuntime, RunSpec } from '../../execution/worker-runtime/coding-agent-runtime.js';
import { buildAcquireReadLeaseCommand, buildAcquireWriteLeaseCommand, buildReleaseLeaseCommand } from '../../contracts/commands/workspace.js';

/** Dispatch's runtime adapter owns lease ordering and pre-execution failures.
 * A material refusal before runtime.start has known, absent model/tool effects. */
export class LeasedWorkerRuntime implements RunPort {
  constructor(private readonly deps: {
    runtime: Pick<CodingAgentRuntime, 'all' | 'start' | 'capabilities' | 'rejectBeforeStart'>;
    lease: () => WorkspaceLeasePort;
    vault: () => ArtifactPort;
    materials: (spec: RunSpec, envelope: TaskEnvelopeV1) => Promise<RuntimeContextMaterials | undefined>;
    reviewerMaterials?: (spec: RunSpec, envelope: TaskEnvelopeV1) => Promise<ReviewerRuntimeAccess>;
    /**
     * 协调能力的**执行前准入 + 装配**（CM-1A-001 协议约束 2.3）。
     *
     * 宿主在这里回答"这个 Run 被授予协调能力了吗、依据是账本里的哪条事实"，并只在 `granted`
     * 时给出访问面；`not_granted` 带可读原因。运行入口据此决定是否注入工具——
     * **不存在**"不带授予却注入工具"的路径（访问面只能作为 granted 的一部分出现）。
     */
    coordination?: (spec: RunSpec, envelope: TaskEnvelopeV1) => Promise<CoordinationRuntimeGrantV1>;
    now: () => string;
  }) {}
  capabilities() { return this.deps.runtime.capabilities(); }

  async start(envelope: TaskEnvelopeV1, access?: { modelCalls?: import('../../contracts/dispatch.js').ModelCallAccess }): Promise<RunHandle> {
    const spec = this.deps.runtime.all().find(r => r.spec.projectId === envelope.projectId && r.spec.workspaceId === envelope.workspaceId && r.spec.goalId === envelope.goalId && r.spec.runId === envelope.runRef.runId)?.spec;
    if (!spec) throw Error('真实运行缺少已登记输入');
    const readOnly = envelope.permissions.tools.length === 1 && envelope.permissions.tools[0] === 'read' && envelope.permissions.writeScope.length === 0;
    const leaseId = `lease-${envelope.runRef.runId}`;
    const commandId = randomUUID();
    const lease = { commandId, correlationId: commandId, actor: { kind: 'system' as const, id: 'integrator' },
      idempotencyKey: (readOnly ? 'p107-acquire-read-' : 'p107-acquire-write-') + leaseId, expiresAt: null,
      projectId: envelope.projectId, workspaceId: envelope.workspaceId, leaseId,
      scope: { schemaVersion: 1 as const, projectId: envelope.projectId, workspaceId: envelope.workspaceId, kind: 'workspace' as const, id: envelope.workspaceId, revision: envelope.workspaceSnapshot.revision },
      holder: { runRef: envelope.runRef, attemptRef: envelope.attemptRef, roleBinding: envelope.roleBinding }, submittedAt: this.deps.now() };
    const acquire = () => readOnly ? this.deps.lease().acquireReadLease(buildAcquireReadLeaseCommand(lease)) : this.deps.lease().acquireWriteLease(buildAcquireWriteLeaseCommand({ ...lease, declaredWriteScope: envelope.permissions.writeScope }));
    let acquired = await acquire();
    for (let retry = 0; retry < 8 && acquired.status === 'rejected' && acquired.code === 'revision_conflict'; retry++) acquired = await acquire();
    if (acquired.status !== 'committed') {
      // Lease acquisition precedes material assembly and runtime.start.  At
      // this point the adapter can prove that neither model nor tool code has
      // run, so persist a deterministic terminal event instead of throwing
      // into the dispatcher's ambiguous-interruption path.
      return this.deps.runtime.rejectBeforeStart(
        envelope,
        readOnly ? '工作区读租约被拒绝：' + acquired.code : '工作区写租约被拒绝：' + acquired.code,
      );
    }
    const release = async () => {
      const releaseId = randomUUID();
      const releaseCurrent = () => this.deps.lease().releaseLease(buildReleaseLeaseCommand({ commandId: releaseId, correlationId: releaseId,
        actor: { kind: 'system', id: 'integrator' }, idempotencyKey: 'p107-release-' + leaseId, projectId: envelope.projectId, workspaceId: envelope.workspaceId,
        leaseId, kind: readOnly ? 'read' : 'write', holderRunRef: envelope.runRef, submittedAt: this.deps.now() }));
      let result = await releaseCurrent();
      for (let retry = 0; retry < 8 && result.status === 'rejected' && result.code === 'revision_conflict'; retry++) result = await releaseCurrent();
      if (result.status !== 'committed') throw Error('工作区租约释放未确认');
    };
    let handle: RunHandle;
    let materials: RuntimeContextMaterials | undefined;
    let reviewer: ReviewerRuntimeAccess | undefined;
    let coordination: Extract<CoordinationRuntimeGrantV1, { status: 'granted' }> | null = null;
    try {
      if (spec.mode === 'review') {
        if (!this.deps.reviewerMaterials || !readOnly || !envelope.work || !envelope.reviewInput) throw Error('审阅运行缺少独立只读材料入口');
        reviewer = await this.deps.reviewerMaterials(spec, envelope);
      } else materials = await this.deps.materials(spec, envelope);
      // 协调能力与材料同处"运行启动之前的准备阶段"：准入只读 canonical 事实，不产生任何写。
      // 未授予 → 本次运行没有协调工具（也不向内核声明该能力），内核侧对这类调用会给出可读拒绝。
      if (spec.mode === undefined && this.deps.coordination) {
        const decision = await this.deps.coordination(spec, envelope);
        coordination = decision.status === "granted" ? decision : null;
      }
    }
    catch (error) {
      await release();
      return this.deps.runtime.rejectBeforeStart(envelope, error instanceof Error ? error.message : '运行材料无法组装');
    }
    try { handle = await this.deps.runtime.start(envelope, { ...access, vault: this.deps.vault(), ...(materials ? { materials } : {}), ...(reviewer ? { reviewer } : {}), ...(coordination === null ? {} : { coordination }) }); }
    catch (error) {
      await release();
      // F-01 residual: `CodingAgentRuntime.start` rejects every pre-execution
      // validation error (closing, task/permission/envelope mismatch, unknown
      // outcome) BEFORE any model or tool call. Those are the same
      // zero-side-effect class as a refused lease, so classify them as a known
      // pre-start failure instead of throwing into the dispatcher's ambiguous
      // path, which would wedge the run as `outcome_unknown`.
      //
      // `rejectBeforeStart` keeps its own "must be provably unstarted"
      // precondition (prepared, no active execution, no events, no trace) and
      // throws when it cannot prove that. We must not claim a known failure we
      // cannot prove, so an unprovable state falls back to rethrowing the
      // original error and stays ambiguous on purpose.
      try {
        return await this.deps.runtime.rejectBeforeStart(envelope, error instanceof Error ? error.message : '运行未能开始');
      } catch (unprovable) {
        // The runtime could not prove that nothing started, so we cannot claim a
        // known failure. Keep the ambiguity (the dispatcher will mark it
        // unknown), but surface why the classification was refused.
        const reason = error instanceof Error ? error.message : String(error);
        const why = unprovable instanceof Error ? unprovable.message : String(unprovable);
        throw Error(reason + '（无法证明尚未启动：' + why + '）');
      }
    }
    return {
      runRef: handle.runRef,
      pollFreshEvents: async () => {
        const events = await handle.pollFreshEvents();
        if (events.some(e => e.eventType !== 'run_started')) await release();
        return events;
      },
      // CM-1A-001 第 4 步：调用证据面**无条件**原样透传（本适配器只负责租约顺序，不解释证据）。
      // 证据面是必选方法，因此"忘了转发"会在编译期暴露——不会让证据在内层被静默吞掉。
      pollModelRequestEvidence: () => handle.pollModelRequestEvidence(),
    };
  }
}
