/**
 * The platform's knowledge operations (`platform.knowledge`): only the project's `KnowledgeLines` reach a line and
 * only its write dependencies reach the queue, the leases, the index and the snapshots. A conflict a reconciliation
 * finds asks the modules' region advisers here, whichever trigger reconciled (a recovery's included). The person's
 * recoveries and the read of a notice's recovery items are here too, the git status and commit of a line's
 * knowledge directory, and R6's mark of a checkout another project already had.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, SessionRef } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import {
  ARCHITECTURE_FILE_PATH, MODULES_DIRECTORY, type KnowledgeProblemKindV1, type KnowledgeProblemV1, type ReconcileResult,
} from '../../../contracts/knowledge.js';
import { truncateUtf8, utf8ByteLength } from '../../../contracts/utf8.js';
import { isPos, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { KnowledgeOpsPort } from '../model/knowledge-ops.js';
import { lineRefKey, type KnowledgeLines, type KnowledgeWriteDeps, type LineKnowledge } from '../model/line-knowledge.js';
import { hostSystemContext } from '../model/platform-check-context.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { knowledgeConflictQuestion } from '../state/exploration-followup.js';
import { withKnowledgeLeases } from './knowledge-write.js';
import { conflictNoticeOf, reconcileKnowledgeLine, withSnapshots } from './reconcile.js';
import { recoverKnowledgeItem, recoveryItemsOf } from './recover.js';

/** [2C1-17], KC-1 G1: what a conflict's repair round uses; wired where `platform.knowledge` is published. */
export type KnowledgeConflictAsks = {
  /** Each module's (project view) effective region adviser and its region, read once; null when none. */
  regionAdvisersOf(ctx: CoreCallContext, projectId: string, moduleIds: readonly string[]):
    Promise<ReadResult<ReadonlyMap<string, { session: SessionRef; region: ModuleRef } | null>>>;
  /** Opens (a retry replays) the `knowledge_conflict` follow-up of one notice: `explorationFollowUp.begin`. */
  beginConflictRepair(ctx: CoreCallContext, input: { workspaceId: string; noticeId: string; regions: ModuleRef[]; text: string }):
    Promise<WriteResult<unknown>>;
  /** The mailbox's text bound for this sender: a request's text is cut to it (b2 Astra 2). */
  readonly maxTextBytes: number;
};

/** The one sender of every conflict repair round: the mailbox keys a send by its sender and workspace too. */
const KNOWLEDGE_CONFLICT_ACTOR = { kind: 'system' as const, id: 'knowledge-conflict' };
const REPAIR_HEAD = '知识文件里有几处问题，每一处只交给一位区域参谋：';
const REPAIR_INSTRUCTION = '请只处理交给你这个区域的那几处：用 propose_architecture_revision 提一份架构修订。这一轮以上次采用的架构为底（文件读不出也能提）；平台不会自动合并，也不会改这些文件；人在卡上批准后由平台按修订把架构文件整张写回，读不出的文件和多余的同号文件会被改回或删掉。';
const omittedPlaces = (count: number): string => `（还有 ${count} 处没列出）`;
/**
 * KC-3 (121-106 ②, ruling Q2): the kinds a repair round is opened for; every other kind only notifies. A bad file
 * counts only for `architecture.json` and a module file (a note is not a repair target).
 */
const REPAIRED: ReadonlySet<KnowledgeProblemKindV1> = new Set<KnowledgeProblemKindV1>(
  ['path_claimed_by_two_modules', 'duplicate_module_id', 'dangling_reference', 'bad_file']);
const repaired = (place: KnowledgeProblemV1): boolean => REPAIRED.has(place.kind) && (place.kind !== 'bad_file'
  || place.files[0]!.path === ARCHITECTURE_FILE_PATH || place.files[0]!.path.startsWith(`${MODULES_DIRECTORY}/`));

/**
 * `localOnly`: the person's "architecture and notes stay local" of a checkout (`LineRef.repoKey`), the Host's setting; a
 * platform built without a Host says false.
 */
export function createKnowledgeOps(lines: KnowledgeLines, asks: KnowledgeConflictAsks,
  localOnly: (repoKey: string) => boolean): KnowledgeOpsPort {
  const reconcile: KnowledgeOpsPort['reconcile'] = async (ctx, workspaceId, trigger) => {
    const line = await lines.line(ctx, workspaceId);
    if (line.status !== 'ready') return storeFailureToRejection(line);
    // A project read that fails skips only the project-level merge check (its own lines report their reads).
    const project = await lines.project(ctx);
    const result = await reconcileKnowledgeLine(lines.write, line.value, trigger,
      project.status === 'ready' ? project.value : null);
    if (result.status === 'ready') await openConflictRepair(asks, lines.write, ctx, line.value, result.value);
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
    // KC-1 G3: the places rows are this project's snapshots; another project's notice id reads none here.
    async problems(ctx, input) {
      if (!isRecord(input) || !nonEmpty(input.noticeId)) return rejected('invalid', 'input must be { noticeId: a non-empty string }');
      return withSnapshots(lines.write, ctx.projectId, async snapshots => {
        const rows = snapshots.readProblems(input.noticeId);
        return rows.length === 0 ? { status: 'not_found' } : { status: 'ready', value: { problems: rows } };
      });
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
 * [2C1-17], KC-1 G1, KC-3: a round with a path claimed by two modules, a duplicate module id, a dangling reference or
 * a bad architecture or module file opens (or replays) one `knowledge_conflict` follow-up for the region advisers
 * those places are handed to; the round's other places stay in the notice only (121-106 ②, ruling Q2). The sender is
 * fixed on the reconciled workspace and the follow-up's key is the notice id, so the same problems open it once
 * whichever trigger reconciled. No adviser (the notice tells the person, [2C1-17]) or a read that fails (the next
 * round opens it) opens nothing. Nothing is merged, no file is changed and no card is made.
 */
async function openConflictRepair(asks: KnowledgeConflictAsks, write: KnowledgeWriteDeps, ctx: CoreCallContext,
  line: LineKnowledge, result: ReconcileResult): Promise<void> {
  const notice = conflictNoticeOf(line.projectId, result.lineRef, result.issues, result.conflicts);
  const places = result.problems.filter(repaired);
  if (notice === null || places.length === 0) return;
  const sender = hostSystemContext({ ...ctx, workspaceId: line.scope.workspaceId }, KNOWLEDGE_CONFLICT_ACTOR);
  // Ruling Q1: a bad file names no module, so it goes with the first module a duplicate or dangling place of this
  // notice names (4-7's rule), else the smallest module of the catalog the records last adopted; none, not handed.
  const named = places.filter(place => place.kind === 'duplicate_module_id' || place.kind === 'dangling_reference')
    .map(place => place.moduleIds[0]!).sort();
  let badFileModule = named[0] ?? null;
  if (badFileModule === null && places.some(place => place.kind === 'bad_file')) {
    const recorded = await write.recordedArchitecture(line.projectId);
    if (recorded.status !== 'ready') return;
    badFileModule = recorded.value?.catalog.modules.map(module => module.ref.moduleId).sort()[0] ?? null;
  }
  // 4-7: one place is handed to the adviser of its first module (sorted), never to every module it names.
  const firstOf = (place: KnowledgeProblemV1): string | null => place.kind === 'bad_file' ? badFileModule : place.moduleIds[0]!;
  const advisers = await asks.regionAdvisersOf(sender, line.projectId,
    [...new Set(places.flatMap(place => firstOf(place) ?? []))]);
  if (advisers.status !== 'ready') return;
  const given = places.flatMap(place => {
    const first = firstOf(place);
    const adviser = first === null ? null : advisers.value.get(first);
    return adviser === null || adviser === undefined ? [] : [{ place, region: adviser.region }];
  });
  if (given.length === 0) return;
  const regions = [...new Map(given.map(entry => [entry.region.moduleId, entry.region])).values()]
    .sort((left, right) => left.moduleId < right.moduleId ? -1 : left.moduleId > right.moduleId ? 1 : 0);
  const bound = asks.maxTextBytes - Math.max(...regions.map(region => utf8ByteLength(knowledgeConflictQuestion(region, ''))));
  await asks.beginConflictRepair(sender, { workspaceId: line.scope.workspaceId, noticeId: notice.noticeId, regions,
    text: conflictRepairText(given, bound) });
  // `committed` (opened or replayed) and `idempotency_conflict` (the same notice already opened on another pin or
  // region) are both handled; every other rejection asks again next round.
}

/**
 * b2 Astra 2: the repair round's text within its bound. The head, each place's line in order and the instruction stay;
 * a place line that does not fit is left out whole and counted, and when not even the first fits it is cut with
 * `truncateUtf8` and ends in “……” (the round still says what to do).
 */
function conflictRepairText(given: readonly { place: KnowledgeProblemV1; region: ModuleRef }[], maxBytes: number): string {
  const lines = given.map(({ place, region }) =>
    `- 交给区域 ${region.moduleId}：${place.reason}（文件：${place.files.map(file => file.path).join('、')}）`);
  for (let kept = lines.length; kept > 0; kept -= 1) {
    const omitted = kept === lines.length ? [] : [omittedPlaces(lines.length - kept)];
    const text = [REPAIR_HEAD, ...lines.slice(0, kept), ...omitted, REPAIR_INSTRUCTION].join('\n');
    if (utf8ByteLength(text) <= maxBytes) return text;
  }
  const omitted = lines.length > 1 ? [omittedPlaces(lines.length - 1)] : [];
  const headroom = maxBytes - utf8ByteLength([REPAIR_HEAD, ...omitted, REPAIR_INSTRUCTION].join('\n')) - 1
    - utf8ByteLength('……');
  return [REPAIR_HEAD, `${truncateUtf8(lines[0]!, Math.max(0, headroom))}……`, ...omitted, REPAIR_INSTRUCTION].join('\n');
}
