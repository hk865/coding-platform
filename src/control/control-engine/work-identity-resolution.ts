/**
 * RW-13 ControlEngine 入口：任务工作身份的**权威只读解析**（零写入，无新聚合、无新事件种类）。
 *
 * ── 为什么解析面在 ControlEngine（唯一权威）─────────────────────────────────────
 *   1. 身份是 Control 的持久事实（WorkContextBinding 由 ControlEngine.WorkRecordPort 建立，
 *      StateLedger 原子提交）。读它的权威答案必须由持有该事实的 Module 给出，不能由派发面
 *      自算、也不能由投影自定——否则同一段工作会因「谁问」而得到不同答案。
 *   2. 解析只消费**既有 canonical 事实**：账本里的 WorkContextBound 事件 + 按 ref load 的
 *      当前快照。不新增索引表、不新增第二份状态、不新增命令；重启后重新扫描得到同一结论。
 *      依赖方向也因此不变：ControlEngine 只依赖 StateLedger（ModuleDependencyDAG）。
 *   3. 为什么用事件扫描而不是投影：ControlEngine 不能依赖 ReadModelIndex（依赖方向是
 *      ReadModelIndex → ControlEngine）；账本事件本身就是 canonical 事实，扫描可重建。
 *      同仓既有先例：autonomous-rework.ts 的 scanGoalChangeFacts 用同一手法重建预算与拒绝事实。
 *   （ReadModel 的已完成工作视图方向相反、允许依赖 ControlEngine，它直接复用本文件的
 *     纯选择规则 dedupeTaskWorks，见 src/data/read-model-index/read-model-index.ts。）
 *
 * ── 一个任务一个身份：多条候选时的确定性唯一答案 ─────────────────────────────────
 * 正常账本里 (goalId, taskId) 恰好一条 task 身份。RW-13 之前可能留下两条（派发面按推导规则
 * 又建了一条），这是历史不一致，不是新事实：
 *   1. **显式声明的身份优先于推导兜底身份**。推导 id 只是「没有既存身份时」的兜底规则，
 *      不是身份的唯一来源；workId 不等于推导 id 的绑定只可能来自别的主体对同一任务的显式声明，
 *      它代表这个任务。派发面因此也复用它（不会为同一任务再造第三条）。
 *   2. 同一档内取**账本顺序最早**的一条（先建立的持久事实优先）。
 *   3. 落选的身份**不改名、不删除**：它仍是不可变历史事实，可按 workId 用 workContextView
 *      直接读取；解析面只是回答「哪个 workId 代表这个任务」，不做任何写入。
 *   4. 同名同 id 的情况根本不会出现冲突（workId 相同就是同一条身份）。
 *
 * ── 解析上限（明确边界）─────────────────────────────────────────────────────────
 * 单次解析最多扫描 TASK_WORK_IDENTITY_MAX_SCAN_PAGES × TASK_WORK_IDENTITY_SCAN_PAGE_SIZE
 * = 200 × 1000 = 200000 条账本事件（与同仓 RW-04 的事件扫描上限同量级）。超过上限即返回
 * unavailable：**读不完整就不能证明「这个任务没有既存身份」**，调用方必须失败，不得凭推导 id
 * 硬写，也不得把不完整的候选集当成完整答案。
 */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { EventPage, StateLedger } from '../../contracts/ledger.js';
import type { WorkContextBindingSnapshot, WorkContextBoundEvent, WorkContextRef } from '../../contracts/context-continuity.js';
import { workContextRefFor } from '../../contracts/context-continuity.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import {
  isDerivedWorkIdFor,
  type TaskWorkIdentityAuthority,
  type TaskWorkIdentityCandidate,
  type TaskWorkIdentityQuery,
  type TaskWorkIdentityResolution,
  type WorkIdentityScope,
} from '../../contracts/task-work-identity.js';

/** 事件扫描分页大小（与 RW-04 一致）。 */
export const TASK_WORK_IDENTITY_SCAN_PAGE_SIZE = 1000;
/** 事件扫描页数上限：200 × 1000 = 200000 条；超过即视为读不完整（unavailable）。 */
export const TASK_WORK_IDENTITY_MAX_SCAN_PAGES = 200;

export type TaskWorkIdentityReadDeps = {
  ledger: Pick<StateLedger, 'events' | 'load'>;
};

/**
 * 解析某任务已存在的工作身份。这是**唯一权威**的答案来源：
 *   - 派发面（DispatchEngine.ensureWorkIdentity）用它实现「先解析、后建立」；
 *   - 已完成工作视图用它把一个任务的多条历史身份归并成一条（下一跳经 dedupeTaskWorks）。
 */
export async function resolveTaskWorkIdentity(
  deps: TaskWorkIdentityReadDeps,
  query: TaskWorkIdentityQuery,
): Promise<TaskWorkIdentityResolution> {
  if (query.projectId.length === 0 || query.workspaceId.length === 0 || query.goalId.length === 0 || query.taskId.length === 0) {
    return { status: 'unavailable', reason: '解析查询不完整：projectId/workspaceId/goalId/taskId 都必须是明确的本地 id' };
  }
  // 读失败（账本抛错、页游标不推进、超过扫描上限）一律是 unavailable：调用方必须失败。
  // 异常不向上抛给派发循环——那会绕过「可证明未启动」的既有失败路径。
  let scan: Awaited<ReturnType<typeof scanTaskWorkCandidates>>;
  try {
    scan = await scanTaskWorkCandidates(deps.ledger, query);
  } catch (err) {
    return { status: 'unavailable', reason: '账本事件不可读：' + (err instanceof Error ? err.message : String(err)) };
  }
  if (scan.status === 'incomplete') return { status: 'unavailable', reason: scan.reason };

  const scope: WorkIdentityScope = { projectId: query.projectId, workspaceId: query.workspaceId, goalId: query.goalId };
  const selected = selectTaskWorkIdentity(scope, query.taskId, scan.candidates);
  if (selected === null) return { status: 'absent' };

  // 候选来自建立时的事件 payload；这里按 ref 读一次当前快照，保证返回的是**当前** canonical 绑定
  // （linkedRunRefs／revision 可能已被后续 link 推进）。读不到即视为不可读：不猜、不硬写。
  let loaded: Awaited<ReturnType<typeof deps.ledger.load>>;
  try {
    loaded = await deps.ledger.load(selected.workContextRef);
  } catch (err) {
    return { status: 'unavailable', reason: '任务 ' + query.taskId + ' 的身份快照不可读：' + (err instanceof Error ? err.message : String(err)) };
  }
  if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'WorkContextBinding') {
    return { status: 'unavailable', reason: '任务 ' + query.taskId + ' 的身份 ' + selected.workContextRef.workId + ' 在账本里读不到当前快照' };
  }
  const snapshot = loaded.snapshot as WorkContextBindingSnapshot;
  const binding = snapshot.binding;
  // 复读后再核对一次范围：解析出的身份必须描述**同一个 (项目, 工作区, 目标, 任务)** 的 task 工作。
  if (binding.workKind !== 'task' || binding.projectId !== query.projectId || binding.workspaceId !== query.workspaceId
      || binding.goalId !== query.goalId || binding.taskId !== query.taskId) {
    return { status: 'unavailable', reason: '任务 ' + query.taskId + ' 的候选身份在复读后与查询范围不一致，拒绝给出可能命错的身份' };
  }
  const authority: TaskWorkIdentityAuthority = isDerivedWorkIdFor(scope, query.taskId, binding.workId) ? 'derived' : 'declared';
  return {
    status: 'resolved',
    workContextRef: snapshot.ref,
    revision: snapshot.revision,
    binding,
    authority,
    candidateCount: scan.candidates.length,
  };
}

/**
 * RW-13 唯一权威的身份选择规则（纯函数，无 IO）：从同一任务的候选里选出代表这条工作的身份。
 * 候选顺序 = 账本提交顺序（调用方保证：事件扫描天然按 cursor 递增；投影按折叠顺序）。
 *   - 0 条 → null（该任务还没有身份，调用方可以按推导规则建立）；
 *   - 有显式声明的身份 → 取其中账本顺序最早的一条；
 *   - 全是推导兜底身份（理论上只可能有一条）→ 取账本顺序最早的一条。
 */
export function selectTaskWorkIdentity(
  scope: WorkIdentityScope,
  taskId: string,
  candidates: readonly TaskWorkIdentityCandidate[],
): TaskWorkIdentityCandidate | null {
  if (candidates.length === 0) return null;
  const declared = candidates.filter((candidate) => !isDerivedWorkIdFor(scope, taskId, candidate.binding.workId));
  const pool = declared.length > 0 ? declared : candidates;
  return pool[0] ?? null;
}

/**
 * 把一个范围内的多条绑定按「一个任务一个身份」归并：每个 (goalId, taskId) 只保留权威那一条，
 * 其余原样丢弃**仅用于展示**（账本事实不动，仍可按 workId 直接读取）。
 * 非任务工作（workKind !== 'task' 或 taskId === null）原样通过：本规则只回答任务身份。
 * 输入顺序被保留（视图原有的排序与稳定性不变），因此两套存储后端得到同一结果。
 */
export function dedupeTaskWorks<T extends { ref: WorkContextRef; binding: import('../../contracts/context-continuity.js').WorkContextBindingV1 }>(
  works: readonly T[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const work of works) {
    const binding = work.binding;
    if (binding.workKind !== 'task' || binding.taskId === null || binding.goalId === null) continue;
    const key = canonicalJson([binding.projectId, binding.workspaceId, binding.goalId, binding.taskId]);
    const rows = groups.get(key);
    if (rows === undefined) groups.set(key, [work]);
    else rows.push(work);
  }
  const dropped = new Set<T>();
  for (const rows of groups.values()) {
    const first = rows[0];
    if (first === undefined || rows.length < 2) continue;
    const selected = selectTaskWorkIdentity(
      { projectId: first.binding.projectId, workspaceId: first.binding.workspaceId, goalId: first.binding.goalId ?? '' },
      first.binding.taskId ?? '',
      rows.map((row) => ({ workContextRef: row.ref, binding: row.binding })),
    );
    if (selected === null) continue;
    for (const row of rows) if (row.ref.workId !== selected.workContextRef.workId) dropped.add(row);
  }
  return dropped.size === 0 ? [...works] : works.filter((work) => !dropped.has(work));
}

/** 扫账本事件，收集该任务的全部 task 工作身份候选（按账本顺序）。 */
async function scanTaskWorkCandidates(
  ledger: Pick<StateLedger, 'events'>,
  query: TaskWorkIdentityQuery,
): Promise<{ status: 'complete'; candidates: TaskWorkIdentityCandidate[] } | { status: 'incomplete'; reason: string }> {
  const candidates: TaskWorkIdentityCandidate[] = [];
  let cursor: CommitCursor | null = null;
  for (let pageIndex = 0; pageIndex < TASK_WORK_IDENTITY_MAX_SCAN_PAGES; pageIndex += 1) {
    const page: EventPage = await ledger.events({ afterCursor: cursor, limit: TASK_WORK_IDENTITY_SCAN_PAGE_SIZE });
    for (const positioned of page.events) {
      if (positioned.event.eventType !== 'WorkContextBound') continue;
      const event = positioned.event as WorkContextBoundEvent;
      if (event.projectId !== query.projectId || event.workspaceId !== query.workspaceId) continue;
      const binding = event.payload.binding;
      // 只认 task 工作；goalId／taskId 精确匹配，因此不同目标或不同工作区不会互相命中。
      if (binding.workKind !== 'task' || binding.goalId !== query.goalId || binding.taskId !== query.taskId) continue;
      candidates.push({
        workContextRef: workContextRefFor(event.projectId, event.workspaceId, event.aggregateId),
        binding,
      });
    }
    if (!page.hasMore) return { status: 'complete', candidates };
    if (page.throughCursor === null) {
      return { status: 'incomplete', reason: '账本事件页没有推进游标：无法证明该任务没有既存身份，不按推导 id 硬写' };
    }
    cursor = page.throughCursor;
  }
  return {
    status: 'incomplete',
    reason:
      '账本事件超过扫描上限（' + String(TASK_WORK_IDENTITY_MAX_SCAN_PAGES * TASK_WORK_IDENTITY_SCAN_PAGE_SIZE) +
      ' 条）：无法证明该任务没有既存身份，不按推导 id 硬写',
  };
}
