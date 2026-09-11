/**
 * RW-12 DispatchEngine — 派发时的材料投递驱动。
 *
 * 位置与理由：与 ExplorationContextDrive 同构——**谁在什么时机去取材料**属于派发面，
 * **怎么选材**属于 ContextCompiler（data/context-compiler/work-run-materials.ts）。
 * 本类只做三件事：核对作用域、从 ControlEngine 的权威解析面取这次运行的工作身份、
 * 把编译结果交给既有材料通道。
 *
 * 工作身份不再由本驱动自己按推导规则算。推导 id 只是「该任务还没有既存身份时」的
 * 兜底规则；账本里可能已经有一条别的主体显式声明的工作身份（人／场景 bindWorkContext），
 * 派发面复用的正是那一条。因此这里必须问 ControlEngine 的权威解析面要 workId，
 * 否则材料会按一个不存在的 workId 去取材，把真实运行挡在 needs_material 上。
 * 解析不到（absent／unavailable）即显式失败：运行尚未启动，属于「可证明未启动」的已知失败，
 * 绝不静默退回「没有材料」。
 *
 * 为什么不是"运行期按需拉取"（ADR 0003 D4 方案 B 被否决）：
 *   - 本方法只被 DispatchEngine 自己的运行时适配器（LeasedWorkerRuntime）在
 *     runtime.start 之前调用一次；WorkerRuntime 在运行中不会回调 ContextCompiler，
 *     因此不存在第二次选材、第二次权限复核或"边跑边扩权"的路径；
 *   - 选材用的权限与版本是 claim 时那一份（信封），运行中工作区/计划移动不会把材料换掉。
 */
import type { StateLedger } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { RunSpec } from '../../contracts/runtime-preparation.js';
import type { RuntimeContextMaterials } from '../../contracts/runtime-context-materials.js';
import type { WorkRunMaterialCompiler, WorkRunMaterialRequest } from '../../data/context-compiler/work-run-materials.js';
import { resolveOriginTaskId } from './work-identity.js';
import type { FeedbackMaterialCompiler } from '../../data/context-compiler/feedback-materials.js';
import { materialAccessGrantIdFor } from '../../contracts/material-access.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from '../../contracts/commands/material-access.js';

export class WorkMaterialDrive {
  constructor(private readonly deps: {
    ledger: Pick<StateLedger, 'load'>;
    /** 身份答案来自 ControlEngine 的权威解析面，不在派发面重算第二份。 */
    control: Pick<ControlEngine, 'resolveTaskWorkIdentity'> & Partial<Pick<ControlEngine,'grantMaterialAccess'>>;
    feedback?: FeedbackMaterialCompiler;
    compiler: Pick<WorkRunMaterialCompiler, 'compile'>;
  }) {}

  async assembleRun(spec: RunSpec, envelope: TaskEnvelopeV1): Promise<RuntimeContextMaterials> {
    // 探索与审阅各有自己的材料通道。走到这里说明接线错了：显式失败，不静默退回"没有材料"。
    if (spec.mode !== undefined) throw Error('工作材料通道只服务普通真实运行；' + spec.mode + ' 运行有自己的材料入口');
    if (spec.projectId !== envelope.projectId || spec.workspaceId !== envelope.workspaceId ||
      spec.goalId !== envelope.goalId || spec.taskId !== envelope.taskId || spec.runId !== envelope.runRef.runId) {
      throw Error('工作材料范围与运行信封不匹配');
    }
    // 与 DispatchEngineImpl.drive 的解析用同一个查询键：返工替换链回溯到起源任务后按它查身份
    // （同一份 PlanRevision、同一个回溯上限），因此这里拿到的一定是派发阶段解析／建立的那条身份。
    const origin = await resolveOriginTaskId(this.deps.ledger, envelope.planRef, envelope.taskId);
    const resolution = await this.deps.control.resolveTaskWorkIdentity({
      projectId: envelope.projectId,
      workspaceId: envelope.workspaceId,
      goalId: envelope.goalId,
      taskId: origin.originTaskId,
    });
    if (resolution.status !== 'resolved') {
      throw Error('工作身份不可用（' + resolution.status + (resolution.status === 'unavailable' ? '：' + resolution.reason : '') + '）：运行不在没有身份的账本上取材');
    }
    const request: WorkRunMaterialRequest = {
      schemaVersion: 1,
      scope: {
        projectId: envelope.projectId,
        workspaceId: envelope.workspaceId,
        goalId: envelope.goalId,
        taskId: envelope.taskId,
        runId: envelope.runRef.runId,
      },
      planRef: envelope.planRef,
      workspaceSnapshot: envelope.workspaceSnapshot,
      roleBinding: envelope.roleBinding,
      /** 权限来自 Control 在 claim 时确定的信封，本驱动不改写、不扩大。 */
      permissions: envelope.permissions,
      workId: resolution.binding.workId,
    };
    const result = await this.deps.compiler.compile(request);
    if (result.status === 'needs_material') {
      // 必读材料缺失：在模型调用之前显式终止该次运行（LeasedWorkerRuntime 会把它登记成
      // "可证明未启动"的已知失败），绝不静默通过。
      throw Error('needs_material: ' + result.gaps.map((g) => '[' + g.kind + '] ' + g.message).join(' | '));
    }
    if (result.status === 'rejected') throw Error('工作材料被拒绝：' + result.code + ': ' + result.message);
    if(this.deps.feedback) {
      const selection=await this.deps.feedback.select(envelope,resolution.binding.workId);
      for(const row of selection.selected) {
        const materials=[row.answer.bodyRef!],basis=selection.basis;
        const id=materialAccessGrantIdFor(envelope.runRef,materials,basis);
        const grant=buildMaterialAccessGrantV1({grantId:id,scope:{projectId:envelope.projectId,workspaceId:envelope.workspaceId,goalId:envelope.goalId},
          materials,reader:envelope.runRef,issuedBy:{aggregateType:'Control',projectId:envelope.projectId,goalId:envelope.goalId},
          purpose:'Directed coordinator supplement for the same formally linked work',basis,grantedAt:row.answer.answeredAt});
        const receipt=await this.deps.control.grantMaterialAccess?.(buildGrantMaterialAccessCommand(grant,{commandId:id,projectId:envelope.projectId,
          actorKind:'system',actorId:'feedback-material-sharing',idempotencyKey:id,correlationId:id,submittedAt:row.answer.answeredAt}));
        if(receipt?.status!=='committed') throw Error('Feedback material permission unavailable');
      }
      result.materials.rules.push(...await this.deps.feedback.assemble(selection));
    }
    return result.materials;
  }
}
