/**
 * The platform's knowledge operations (`platform.knowledge`): only the project's `KnowledgeLines` reach a line and
 * only its write dependencies reach the queue, the leases, the index and the snapshots. A conflict a reconciliation
 * finds asks the modules' region advisers here, whichever trigger reconciled (a recovery's included). The person's
 * recoveries and the read of a notice's recovery items are here too, the git status and commit of a line's
 * knowledge directory, and R6's mark of a checkout another project already had.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { KnowledgeConflictV1, ReconcileResult } from '../../../contracts/knowledge.js';
import { utf8ByteLength } from '../../../contracts/utf8.js';
import { isPos, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { SessionMessageCommandPort } from '../model/communication-contracts.js';
import type { KnowledgeOpsPort } from '../model/knowledge-ops.js';
import { lineRefKey, type KnowledgeLines, type LineKnowledge } from '../model/line-knowledge.js';
import { hostSystemContext } from '../model/platform-check-context.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { withKnowledgeLeases } from './knowledge-write.js';
import { conflictNoticeOf, reconcileKnowledgeLine } from './reconcile.js';
import { recoverKnowledgeItem, recoveryItemsOf } from './recover.js';

/** [2C1-17]: what a conflict's requests to the region advisers use; wired where `platform.knowledge` is published. */
export type KnowledgeConflictAsks = {
  /** Each module's (project view) effective region adviser by the last catalog the records adopted, read once; null when none. */
  regionAdvisersOf(ctx: CoreCallContext, projectId: string, moduleIds: readonly string[]):
    Promise<ReadResult<ReadonlyMap<string, SessionRef | null>>>;
  readonly sendMessage: SessionMessageCommandPort['sendMessage'];
  /** The mailbox's text bound for this sender: a request's text is cut to it (b2 Astra 2). */
  readonly maxTextBytes: number;
};

/** The one sender of every conflict request: the mailbox keys a send by its sender and workspace too. */
const KNOWLEDGE_CONFLICT_ACTOR = { kind: 'system' as const, id: 'knowledge-conflict' };
const CONFLICT_REASONS: Record<KnowledgeConflictV1['kind'], string> = {
  duplicate_module_id: '两个模块文件写了同一个模块号',
  path_claimed_by_two_modules: '同一个路径被两个模块认领',
  dangling_reference: '引用了不存在的模块',
};
const REQUEST_INSTRUCTION = '请核对这些文件，用 propose_architecture_revision 提一份架构修订来解决。平台不会自动合并，也不会改这些文件。';
const omittedPaths = (count: number): string => `（还有 ${count} 条路径没列出）`;

/**
 * `localOnly`: the person's "architecture and notes stay local" of a checkout (`LineRef.repoKey`), the Host's setting; a
 * platform built without a Host says false.
 */
export function createKnowledgeOps(lines: KnowledgeLines, asks: KnowledgeConflictAsks,
  localOnly: (repoKey: string) => boolean): KnowledgeOpsPort {
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
    // [2C2-08]: the line only through the project's lines, so a workspace not registered in it is refused there.
    async status(ctx, workspaceId) {
      const line = await lines.line(ctx, workspaceId);
      if (line.status !== 'ready') return storeFailureToRejection(line);
      const status = await line.value.status();
      if (status.status !== 'ready') return storeFailureToRejection(status);
      const { branch, dirty, files } = status.value;
      return { status: 'ready', value: { branch, dirty, files, localOnly: localOnly(line.value.line.repoKey) } };
    },
    // [2C2-07], [2C2-08]: in the write queue and the checkout's lease, like any knowledge write; the route hands the
    // input over as it came, so the message is checked here.
    async commit(ctx, input) {
      const invalid = rejected('invalid', 'input must be { message?: a string or null }');
      if (!isRecord(input) || !nonEmpty(input.workspaceId)) return invalid;
      const message: unknown = input.message;
      if (message !== undefined && message !== null && typeof message !== 'string') return invalid;
      const line = await lines.line(ctx, input.workspaceId);
      if (line.status !== 'ready') return storeFailureToRejection(line);
      if (localOnly(line.value.line.repoKey)) return rejected('forbidden', '架构图和注记设置为只留在本机');
      const write = lines.write;
      const committed = await write.queue.run(ctx.projectId, [line.value.line.folder], async () => {
        const leased = await withKnowledgeLeases(write, [line.value], () => line.value.commit(message ?? null));
        return leased.status === 'ready' ? leased.value : leased;
      });
      if (committed.status !== 'ready') return storeFailureToRejection(committed);
      // After the queue and the lease are let go (the reconciliation takes its own): the index takes the committed
      // files and their snapshots go. Its failure leaves the commit as it is.
      await reconcile(ctx, input.workspaceId, 'after_commit').catch(() => undefined);
      return committed;
    },
    // [2C2-11]: in the write queue, since the writes index the same line.
    async markJoinedCheckout(ctx, workspaceId) {
      const line = await lines.line(ctx, workspaceId);
      if (line.status !== 'ready') return storeFailureToRejection(line);
      const lineRef = lineRefKey(line.value.scope, line.value.line);
      const write = lines.write;
      return write.queue.run(ctx.projectId, [line.value.line.folder], async () => {
        try {
          const index = write.indexOf(ctx.projectId);
          const marked = index.transaction(tx => {
            const notes = index.listFiles(lineRef).filter(file => file.kind === 'note');
            for (const note of notes) {
              tx.setNoteState(lineRef, note.blobSha,
                { verifyState: 'needs_verification', verifyReason: 'joined_existing_checkout' });
            }
            return notes.length;
          });
          return { status: 'ready' as const, value: { marked } };
        } catch (error) {
          return storeFailureToRejection(error);
        }
      });
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
    const text = conflictRequestText(moduleId, result.conflicts.filter(conflict => conflict.moduleId === moduleId),
      asks.maxTextBytes);
    const identity = { adviser, moduleId, noticeId: notice.noticeId };
    await asks.sendMessage(sender, {
      input: { recipient: adviser, text, intent: 'action_request', needsReply: true },
      meta: { requestId: `knowledge-conflict:${sha256Hex(canonicalJson(identity as unknown as JsonValue))}`, expected: [] },
    });
  }
}

/**
 * b2 Astra 2: one request's text within the mailbox's bound. The module, each conflict's reason (one per kind) and the
 * instruction always stay; the paths go in whole, in order, while they fit, and a reason that left some out says how
 * many. Each reason line keeps room for the widest such note, so the text never passes `maxBytes`.
 */
function conflictRequestText(moduleId: string, conflicts: readonly KnowledgeConflictV1[], maxBytes: number): string {
  const head = `知识文件里的模块 ${moduleId} 有冲突：`;
  const reasonLine = (conflict: KnowledgeConflictV1): string => `- ${CONFLICT_REASONS[conflict.kind]}（${conflict.kind}）：`;
  const widest = omittedPaths(conflicts.reduce((sum, conflict) => sum + conflict.paths.length, 0));
  let left = maxBytes - utf8ByteLength([head, ...conflicts.map(conflict => reasonLine(conflict) + widest),
    REQUEST_INSTRUCTION].join('\n'));
  const listed = conflicts.map(conflict => {
    const shown: string[] = [];
    for (const path of conflict.paths) {
      const cost = utf8ByteLength(shown.length === 0 ? path : `、${path}`);
      if (cost > left) break;
      left -= cost;
      shown.push(path);
    }
    const omitted = conflict.paths.length - shown.length;
    return `${reasonLine(conflict)}${shown.join('、')}${omitted === 0 ? '' : omittedPaths(omitted)}`;
  });
  return [head, ...listed, REQUEST_INSTRUCTION].join('\n');
}
