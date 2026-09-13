/** Read and attribute persisted output material to its exact producing Run.
 * Verification owns the role expectation table; Context owns storage reads. */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { EventPage, StateLedger } from '../../contracts/ledger.js';
import type { ExecutionNoteSnapshot, ExecutionNoteRecordedEvent } from '../../contracts/context-continuity.js';
import { executionNoteRefFor, EXECUTION_NOTE_KINDS } from '../../contracts/context-continuity.js';
import type { IntegrationResultSnapshot, IntegrationTaskResultV1 } from '../../contracts/integration.js';
import { integrationResultRefFor } from '../../contracts/integration.js';
import type { PatchRecordSnapshot, PatchRecordedEvent } from '../../contracts/patch.js';
import { patchRecordRefFor } from '../../contracts/patch.js';
import type { ReviewWorkSnapshot } from '../../contracts/reviewer-work.js';
import { canonicalJson } from '../../contracts/fingerprint.js';


import type { RoleOutputWitnessChannelV1, RunOutputWitness as WitnessOutcomeV1 } from '../../contracts/run-output-materials.js';
export const RUN_OUTPUT_SCAN_PAGE_SIZE = 256;
export const RUN_OUTPUT_SCAN_MAX_PAGES = 256;

const sameRun = (a: RunRef, b: RunRef): boolean =>
  a.projectId === b.projectId && a.goalId === b.goalId && a.runId === b.runId;


export class RunOutputFacts {
  private scan: Promise<{ patches: PatchRecordedEvent[]; notes: ExecutionNoteRecordedEvent[] } | { unavailable: string }> | null = null;
  constructor(private readonly run: RunSnapshot, private readonly ledger: Pick<StateLedger, 'load' | 'events'>) {}

  witness(channel: Exclude<RoleOutputWitnessChannelV1, null>): Promise<WitnessOutcomeV1> {
    switch (channel) {
      case 'run-bound-review-output': return this.reviewOutput();
      case 'run-bound-patch-record': return this.patchRecord();
      case 'run-bound-integration-result': return this.integrationResult();
      case 'run-bound-conflict-surface': return this.conflictSurface();
      case 'run-bound-execution-note': return this.executionNote();
    }
  }

  /** 独立审阅：正式 ReviewWork 把原报告绑定到**本 Run**。 */
  private async reviewOutput(): Promise<WitnessOutcomeV1> {
    const work = this.run.work;
    if (work === undefined || work.kind !== 'review') return { channel: 'run-bound-review-output', unavailable: '本 Run 不是独立审阅运行（没有 ReviewWork 绑定），因此没有审阅原报告可见证' };
    const loaded = await this.ledger.load(work.reviewWorkRef);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'ReviewWork') return { channel: 'run-bound-review-output', unavailable: '正式 ReviewWork ' + work.reviewWorkRef.reviewId + ' 当前不可读取' };
    const snapshot = loaded.snapshot as ReviewWorkSnapshot;
    const output = snapshot.output;
    if (output === null || output === undefined) return { channel: 'run-bound-review-output', unavailable: '正式 ReviewWork ' + snapshot.ref.reviewId + ' 还没有绑定原报告' };
    // 必须绑定到**本 Run**：别的运行的报告不能见证这次运行的产出。
    if (!sameRun(output.runRef, this.run.ref)) return { channel: 'run-bound-review-output', unavailable: 'ReviewWork ' + snapshot.ref.reviewId + ' 绑定的原报告属于另一个运行（' + output.runRef.runId + '），不能见证本 Run' };
    return { channel: 'run-bound-review-output', fact: '正式 ReviewWork ' + snapshot.ref.reviewId + ' 已把原报告绑定到本 Run（reportRef ' + output.reportRef.digest +
      '，摘要 ' + output.reportDigest + '）：这是审阅生命周期原子写入的事实，不是模型自述。' };
  }

  /**
   * 实现结果：本 Run 的 canonical PatchRecord。
   * 先用落账事件按 runRef 找到 patchId（聚合 ref 只有 patchId），再 load canonical 聚合逐字段复核归属。
   */
  private async patchRecord(): Promise<WitnessOutcomeV1> {
    const scan = await this.scanFacts();
    if ('unavailable' in scan) return { channel: 'run-bound-patch-record', unavailable: '无法在账本落账事件里归因本 Run 的产出：' + scan.unavailable };
    const events = scan.patches;
    if (events.length === 0) return { channel: 'run-bound-patch-record', unavailable: '账本里没有 runRef 等于本 Run 的 PatchRecorded 事实（本 Run 没有登记实现结果）' };
    const latest = events[events.length - 1]!;
    const patchId = latest.payload.patchId;
    const loaded = await this.ledger.load(patchRecordRefFor(latest.projectId, patchId));
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'PatchRecord') return { channel: 'run-bound-patch-record', unavailable: '补丁 ' + patchId + ' 的 canonical PatchRecord 当前不可读取' };
    const snapshot = loaded.snapshot as PatchRecordSnapshot;
    const patch = snapshot.patch;
    const mismatch = this.attributionMismatch(patch.runRef, patch.projectId, patch.workspaceId, patch.taskId, patch.planRef);
    if (mismatch !== null) return { channel: 'run-bound-patch-record', unavailable: '补丁 ' + patchId + ' 的 canonical 记录不属于本 Run：' + mismatch };
    return { channel: 'run-bound-patch-record', fact: '本 Run 的 canonical PatchRecord ' + patchId + '（' + patch.kind + '）：' +
      String(patch.changedPaths.length) + ' 条改动路径，工作区版本 ' + String(patch.beforeWorkspaceRevision) + '→' + String(patch.afterWorkspaceRevision) +
      '，补丁正文 ' + patch.bodyRef.digest + '，检查结果 ' + String(patch.checkResults.length) + ' 条，计划版本 ' + String(patch.taskRevision) +
      '，登记于 ' + patch.generatedAt + '；共 ' + String(events.length) + ' 条属于本 Run 的补丁事实。' +
      '该记录由 ControlEngine 的 recordPatch 守卫原子写入（运行已结束、持有活动写租约、改动路径 ⊆ 租约范围、基于当前工作区版本），不是模型自述。' };
  }

  /** 集成结果：本 Run 的 canonical IntegrationResult 记录（聚合按 (project, goal, task) 定位）。 */
  private async integrationResult(): Promise<WitnessOutcomeV1> {
    const found = await this.integrationRecord();
    if ('unavailable' in found) return { channel: 'run-bound-integration-result', unavailable: found.unavailable };
    const record = found.record;
    return { channel: 'run-bound-integration-result', fact: '本 Run 的 canonical IntegrationResult 记录 ' + record.resultId + '：输入 ' + String(record.inputs.length) +
      ' 条，冲突 ' + String(record.conflicts.length) + ' 条，缺口 ' + String(record.gaps.length) + ' 条，工作区版本 ' + String(record.workspaceRevision) +
      '，计划版本 ' + String(record.taskRevision) + '，登记于 ' + record.generatedAt +
      '。该记录由 ControlEngine 的 recordIntegrationResult 守卫落账（输入必须是已接纳的正式证据、冲突无解释且未升级即拒绝），不是模型自述。' };
  }

  /**
   * 冲突报告：同一条集成记录里已经落账的冲突面。
   * 空清单是「机械检测后未发现冲突」的正式结论（Control 的守卫保证冲突存在时必然有 explanation 或 escalate），
   * 因此这里复核的是冲突面的结构完整性，不额外发明判据。
   */
  private async conflictSurface(): Promise<WitnessOutcomeV1> {
    const found = await this.integrationRecord();
    if ('unavailable' in found) return { channel: 'run-bound-conflict-surface', unavailable: found.unavailable };
    const record = found.record;
    for (const conflict of record.conflicts) {
      if (typeof conflict.conflictId !== 'string' || conflict.conflictId.length === 0) return { channel: 'run-bound-conflict-surface', unavailable: '集成记录 ' + record.resultId + ' 的冲突项缺少身份，不能作为冲突报告见证' };
      if (!/^[a-f0-9]{64}$/.test(conflict.conflictKey)) return { channel: 'run-bound-conflict-surface', unavailable: '集成记录 ' + record.resultId + ' 的冲突项缺少有效 conflictKey，不能作为冲突报告见证' };
      if (conflict.kind !== 'outcome_disagreement' || !Array.isArray(conflict.evidence) || conflict.evidence.length === 0) return { channel: 'run-bound-conflict-surface', unavailable: '集成记录 ' + record.resultId + ' 的冲突项缺少机械检测结论或来源证据，不能作为冲突报告见证' };
    }
    // Control 的守卫：冲突存在时必须有解释或升级标记（否则 conflict_unresolved、零写）。这里逐字复核同一条事实。
    if (record.conflicts.length > 0 && record.explanation === null && record.escalate !== true) return { channel: 'run-bound-conflict-surface', unavailable: '集成记录 ' + record.resultId + ' 有 ' + String(record.conflicts.length) + ' 条冲突却没有解释也没有升级标记，不满足正式记录的守卫口径' };
    const detail = record.conflicts.length === 0
      ? '机械检测未发现冲突（输入 ' + String(record.inputs.length) + ' 条已接纳证据，工作区版本 ' + String(record.workspaceRevision) + '）'
      : record.conflicts.map((conflict) => conflict.conflictId + '（' + conflict.obligationId + '/' + conflict.requirementId + '，' + String(conflict.evidence.length) + ' 条来源证据）').join('、');
    return { channel: 'run-bound-conflict-surface', fact: '本 Run 的集成记录 ' + record.resultId + ' 已落账冲突报告：共 ' + String(record.conflicts.length) + ' 条冲突项；' + detail +
      '；escalate=' + String(record.escalate) + '，explanation=' + (record.explanation === null ? 'null' : '已给出') + '。' };
  }

  /** 工作记录：本 Run 的 canonical ExecutionNote（actor 归因靠 note.runRef，落账事件提供 noteId）。 */
  private async executionNote(): Promise<WitnessOutcomeV1> {
    const scan = await this.scanFacts();
    if ('unavailable' in scan) return { channel: 'run-bound-execution-note', unavailable: '无法在账本落账事件里归因本 Run 的产出：' + scan.unavailable };
    const events = scan.notes;
    if (events.length === 0) return { channel: 'run-bound-execution-note', unavailable: '账本里没有 runRef 等于本 Run 的 ExecutionNoteRecorded 事实（本 Run 没有登记工作留痕）' };
    const latest = events[events.length - 1]!;
    const note = latest.payload.note;
    const loaded = await this.ledger.load(executionNoteRefFor(latest.projectId, latest.workspaceId, note.workId, note.noteId));
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'ExecutionNote') return { channel: 'run-bound-execution-note', unavailable: '留痕 ' + note.noteId + ' 的 canonical ExecutionNote 当前不可读取' };
    const record = (loaded.snapshot as ExecutionNoteSnapshot).note;
    const mismatch = this.attributionMismatch(record.runRef, record.projectId, record.workspaceId, null, record.applicableVersions.planRef);
    if (mismatch !== null) return { channel: 'run-bound-execution-note', unavailable: '留痕 ' + note.noteId + ' 的 canonical 记录不属于本 Run：' + mismatch };
    if (record.noFullTranscript !== true || typeof record.bodyRef?.digest !== 'string' || !EXECUTION_NOTE_KINDS.includes(record.kind)) {
      return { channel: 'run-bound-execution-note', unavailable: '留痕 ' + note.noteId + ' 缺少 body-first 正文引用、种类无效或声明了完整对话记录，不满足工作留痕的正式形状' };
    }
    return { channel: 'run-bound-execution-note', fact: '本 Run 的 canonical ExecutionNote ' + record.noteId + '（种类 ' + record.kind + '，工作身份 ' + record.workId +
      '）：摘要与理由已落账，来源引用 ' + String(record.sourceRefs.length) + ' 条，正文 ' + record.bodyRef.digest + '（body-first，noFullTranscript=true），登记于 ' + record.createdAt +
      '；共 ' + String(events.length) + ' 条属于本 Run 的留痕事实。该记录由 ControlEngine 的 recordExecutionNote 守卫落账（作者运行必须已 link 进该工作身份、正文先落 Vault 再登记）。' };
  }

  /** 本 Run 的集成 join 记录（聚合按 (projectId, goalId, run.task.taskId) 定位，并复核 runRef 归属）。 */
  private async integrationRecord(): Promise<{ record: IntegrationTaskResultV1 } | { unavailable: string }> {
    const ref = integrationResultRefFor(this.run.ref.projectId, this.run.ref.goalId, this.run.task.taskId);
    const loaded = await this.ledger.load(ref);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'IntegrationResult') return { unavailable: '账本里没有任务 ' + this.run.task.taskId + ' 的 IntegrationResult 聚合' };
    const snapshot = loaded.snapshot as IntegrationResultSnapshot;
    // 只认 runRef 等于**本 Run** 的记录：同一任务的其他尝试、别的运行的 join 都不能见证本次产出。
    const matches = snapshot.records.filter((record) => sameRun(record.runRef, this.run.ref));
    if (matches.length === 0) return { unavailable: '任务 ' + this.run.task.taskId + ' 的集成记录里没有 runRef 等于本 Run 的条目' };
    const record = matches[matches.length - 1]!;
    const mismatch = this.attributionMismatch(record.runRef, record.projectId, record.workspaceId, record.taskId, record.planRef);
    if (mismatch !== null) return { unavailable: '集成记录 ' + record.resultId + ' 不属于本 Run：' + mismatch };
    return { record };
  }

  /** 归因复核：事实必须逐字段属于本 Run（目标／工作区／任务／计划版本），否则不作为见证。 */
  private attributionMismatch(runRef: RunRef, projectId: string, workspaceId: string, taskId: string | null, planRef: unknown): string | null {
    if (!sameRun(runRef, this.run.ref)) return 'runRef 是 ' + runRef.runId + '，不是本 Run ' + this.run.ref.runId;
    if (projectId !== this.run.ref.projectId) return 'projectId 是 ' + projectId + '，与本 Run 不同';
    if (workspaceId !== this.run.workspaceSnapshot.workspaceId) return 'workspaceId 是 ' + workspaceId + '，与本 Run 冻结的工作区不同';
    if (taskId !== null && taskId !== this.run.task.taskId) return 'taskId 是 ' + taskId + '，与本 Run 的任务不同';
    if (planRef !== null && planRef !== undefined && canonicalJson(planRef as never) !== canonicalJson(this.run.planRef as never)) return 'planRef 与本 Run 的计划版本不同';
    return null;
  }

  /** 一次扫描同时收集两类按 runRef 归因的产出事实；超页上限即如实报「无法见证」。 */
  private scanFacts(): Promise<{ patches: PatchRecordedEvent[]; notes: ExecutionNoteRecordedEvent[] } | { unavailable: string }> {
    this.scan ??= this.runScan();
    return this.scan;
  }

  private async runScan(): Promise<{ patches: PatchRecordedEvent[]; notes: ExecutionNoteRecordedEvent[] } | { unavailable: string }> {
    const patches: PatchRecordedEvent[] = [];
    const notes: ExecutionNoteRecordedEvent[] = [];
    let cursor: CommitCursor | null = null;
    for (let pageIndex = 0; pageIndex < RUN_OUTPUT_SCAN_MAX_PAGES; pageIndex += 1) {
      const page: EventPage = await this.ledger.events({ afterCursor: cursor, limit: RUN_OUTPUT_SCAN_PAGE_SIZE });
      for (const positioned of page.events) {
        const event = positioned.event;
        if (event.eventType === 'PatchRecorded') {
          const recorded = event as PatchRecordedEvent;
          if (recorded.projectId !== this.run.ref.projectId) continue;
          if (sameRun(recorded.payload.runRef, this.run.ref)) patches.push(recorded);
        } else if (event.eventType === 'ExecutionNoteRecorded') {
          const recorded = event as ExecutionNoteRecordedEvent;
          if (recorded.projectId !== this.run.ref.projectId) continue;
          if (sameRun(recorded.payload.note.runRef, this.run.ref)) notes.push(recorded);
        }
      }
      if (!page.hasMore) return { patches, notes };
      if (page.throughCursor === null) return { unavailable: '账本事件页没有推进游标，无法完整归因本 Run 的产出' };
      cursor = page.throughCursor;
    }
    return { unavailable: '账本事件超过扫描上限（' + String(RUN_OUTPUT_SCAN_MAX_PAGES * RUN_OUTPUT_SCAN_PAGE_SIZE) + ' 条），无法完整归因本 Run 的产出' };
  }
}

