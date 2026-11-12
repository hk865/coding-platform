/**
 * The platform's knowledge operations (`platform.knowledge`): only the project's `KnowledgeLines` reach a line and
 * only its write dependencies reach the queue, the leases, the index and the snapshots. A conflict a reconciliation
 * finds asks the modules' region advisers here, whichever trigger reconciled (a recovery's included). The person's
 * recoveries and the read of a notice's recovery items are here too.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { KnowledgeConflictV1, ReconcileResult } from '../../../contracts/knowledge.js';
import { isPos, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { SessionMessageCommandPort } from '../model/communication-contracts.js';
import type { KnowledgeOpsPort } from '../model/knowledge-ops.js';
import type { KnowledgeLines, LineKnowledge } from '../model/line-knowledge.js';
import { hostSystemContext } from '../model/platform-check-context.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { conflictNoticeOf, reconcileKnowledgeLine } from './reconcile.js';
import { recoverKnowledgeItem, recoveryItemsOf } from './recover.js';

/** [2C1-17]: what a conflict's requests to the region advisers use; wired where `platform.knowledge` is published. */
export type KnowledgeConflictAsks = {
  /** Each module's (project view) effective region adviser by the last catalog the records adopted, read once; null when none. */
  regionAdvisersOf(ctx: CoreCallContext, projectId: string, moduleIds: readonly string[]):
    Promise<ReadResult<ReadonlyMap<string, SessionRef | null>>>;
  readonly sendMessage: SessionMessageCommandPort['sendMessage'];
};

/** The one sender of every conflict request: the mailbox keys a send by its sender and workspace too. */
const KNOWLEDGE_CONFLICT_ACTOR = { kind: 'system' as const, id: 'knowledge-conflict' };
const CONFLICT_REASONS: Record<KnowledgeConflictV1['kind'], string> = {
  duplicate_module_id: '两个模块文件写了同一个模块号',
  path_claimed_by_two_modules: '同一个路径被两个模块认领',
  dangling_reference: '引用了不存在的模块',
};

export function createKnowledgeOps(lines: KnowledgeLines, asks: KnowledgeConflictAsks): KnowledgeOpsPort {
  const reconcile: KnowledgeOpsPort['reconcile'] = async (ctx, workspaceId, trigger) => {
    const line = await lines.line(ctx, workspaceId);
    if (line.status !== 'ready') return storeFailureToRejection(line);
    const result = await reconcileKnowledgeLine(lines.write, line.value, trigger);
    if (result.status === 'ready') await askRegionAdvisers(asks, ctx, line.value, result.value);
    return result;
  };
  return {
    reconcile,
    // The route hands the request's input over as it came: it is checked here.
    async recover(ctx, input) {
      if (!isRecord(input) || !nonEmpty(input.noticeId) || !isPos(input.itemNo)) {
        return rejected('invalid', 'input must be { noticeId: a non-empty string, itemNo: an integer from 1 }');
      }
      // The reconciliation after a recovery goes through `reconcile` here, so its conflicts ask the advisers too.
      return recoverKnowledgeItem(lines, ctx, input.noticeId, input.itemNo,
        workspaceId => reconcile(ctx, workspaceId, 'recovery'));
    },
    async recoveryItems(ctx, input) {
      if (!isRecord(input) || !nonEmpty(input.noticeId)) return rejected('invalid', 'input must be { noticeId: a non-empty string }');
      return recoveryItemsOf(lines.write, ctx.projectId, input.noticeId);
    },
  };
}

/**
 * [2C1-17]: each module in a conflict asks its region adviser to settle it: a system `action_request` that needs a
 * reply, with the paths and why, naming `propose_architecture_revision`. The sender is fixed on the reconciled
 * workspace and the request id is the (adviser, module, notice), so the same problems ask each adviser once whichever
 * trigger reconciled. No adviser (the notice tells the person) or an adviser read that fails (the next round asks
 * again) sends nothing. Nothing is merged, no file is changed and no card is made.
 */
async function askRegionAdvisers(asks: KnowledgeConflictAsks, ctx: CoreCallContext, line: LineKnowledge,
  result: ReconcileResult): Promise<void> {
  const notice = conflictNoticeOf(line.projectId, result.lineRef, result.issues, result.conflicts);
  if (notice === null || result.conflicts.length === 0) return;
  const sender = hostSystemContext({ ...ctx, workspaceId: line.scope.workspaceId }, KNOWLEDGE_CONFLICT_ACTOR);
  const moduleIds = [...new Set(result.conflicts.map(conflict => conflict.moduleId))];
  const advisers = await asks.regionAdvisersOf(sender, line.projectId, moduleIds);
  if (advisers.status !== 'ready') return;
  for (const moduleId of moduleIds) {
    const adviser = advisers.value.get(moduleId) ?? null;
    if (adviser === null) continue;
    const listed = result.conflicts.filter(conflict => conflict.moduleId === moduleId)
      .map(conflict => `- ${CONFLICT_REASONS[conflict.kind]}（${conflict.kind}）：${conflict.paths.join('、')}`);
    const text = [`知识文件里的模块 ${moduleId} 有冲突：`, ...listed,
      '请核对这些文件，用 propose_architecture_revision 提一份架构修订来解决。平台不会自动合并，也不会改这些文件。'].join('\n');
    const identity = { adviser, moduleId, noticeId: notice.noticeId };
    await asks.sendMessage(sender, {
      input: { recipient: adviser, text, intent: 'action_request', needsReply: true },
      meta: { requestId: `knowledge-conflict:${sha256Hex(canonicalJson(identity as unknown as JsonValue))}`, expected: [] },
    });
  }
}
