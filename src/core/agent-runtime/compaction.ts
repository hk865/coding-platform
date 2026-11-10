/**
 * Compaction between two turns of one line (slice-K2-SPEC L10–L13, L16, L18–L20).
 *
 * At the start of a turn that continues its own Session history, before the turn's `sessionContext` is built, a
 * compaction record right after the cursor is reused; otherwise this line's own Kernel records decide whether the
 * history is too long. Old successful tool results become stubs first; only when that does not bring the estimate
 * under the target does one summary call, in a temporary Kernel Session, write a summary. The original records never
 * change, and the platform keeps no compaction fact of its own: the Kernel record is the fact.
 * `wouldCompactNext` is the same judgment, read-only, for the "too long" readers: a line whose next turn compacts
 * first is not handed off.
 */
import { appendCompactionRecord } from '../../../vendor/coding-agent/dist/public-api.js';
import type {
  AppendCompactionRecordInput, AppendCompactionRecordResult, HookPort,
} from '../../../vendor/coding-agent/dist/public-api.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { CoreError, ReadResult } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { ModelCallAccess, RunRef } from '../../contracts/dispatch.js';
import { messageOf } from '../../contracts/error-message.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { SECRETARY_HANDOFF_INPUT_TOKENS } from '../work-graph/model/request-contracts.js';
import type { KernelStoreRegistry } from './kernel-store-locator.js';
import { RuntimeModelCallRejected } from './model-call-access.js';
import { runObservedModel, type ObservedModelRunOptions } from './observed-model-run.js';
import {
  createSessionHistoryCursorOwner, readRecordAfterCursor, scanCompactionHistory, type CompactionHistoryScan,
} from './session-operations.js';

export type CompactionRatios = { triggerRatio: number; targetRatio: number; tailRatio: number };
/** The defaults of the Host startup `runtime.compaction`; the startup parse fills each absent ratio from here. */
export const COMPACTION_DEFAULTS: CompactionRatios = { triggerRatio: 0.4, targetRatio: 0.2, tailRatio: 0.5 };

/** Tokens per JSON character: the saved characters and every turn's size use this one factor. */
const TOKENS_PER_CHAR = 0.29;
/** What a stub keeps of one result's JSON characters; only the rest counts as saved. */
const STUB_ALLOWANCE = 600;
/** L19 `over_cap`: the summary's output ceiling. */
const SUMMARY_MAX_TOKENS = 8192;
/** L19: the six section headings the summary prompt asks for, in order; the sources are not checked. */
const SUMMARY_SECTIONS = ['## 目标和验收义务', '## 用户原话和要求', '## 做过的决定和依据', '## 没解决的事',
  '## 试过什么、结果如何', '## 来源'] as const;
/** L13: the read-back of a turn with no Work RunRef (a Query turn, or a Work claim that is not found). */
const NO_READ_BACK = '原文在本线的会话历史里，本线现在没有读回入口';

export type CompactionDecision =
  | { kind: 'skip' }
  | { kind: 'stubs'; boundary: number; savedChars: number }
  | { kind: 'summary'; boundary: number; savedChars: number };

export type CompactionTurn = {
  endPosition: number;
  runId: string;
  interrupted: boolean;
  /** This turn's records in the current view, JSON characters × 0.29; compaction records belong to no turn. */
  sizeTokens: number;
  /** Σ max(0, output JSON characters − 600) over this turn's successful tool results. */
  savedChars: number;
};
export type CompactionFacts = {
  /** The just-ended turn's last reported input tokens. */
  lastInput: number | null;
  /** Oldest first: the complete turns after the latest compacted summary, stubbed ones included (for the read-back). */
  turns: CompactionTurn[];
  /** The latest successful compacted record's view; a failed record changes no view. */
  view: { summaryThrough: number; stubsThrough: number } | null;
  /** The just-ended turn started on a failed compaction record (its `contextBasis.throughPosition`). */
  startedWithFailed: boolean;
};

/** The Kernel run id a Work Run's start fixes; the read-back matches a turn to its RunRef by the same rule. */
export function workKernelRunIdOf(runRef: RunRef): string {
  return 'krun-' + sha256Hex(canonicalJson(runRef as never));
}

/**
 * L10/L11: the one pure decision. Trigger on the just-ended turn's input; no second compaction once a compacted view
 * already reached the handoff threshold; the tail keeps the newest countable turn whatever its size and every older
 * one while the tail budget (`tailRatio × targetRatio × W`) holds, and the first turn that does not fit is the
 * boundary. Only results newly inside the stubs count as saved, so the estimate errs towards a summary.
 */
export function compactionBasis(
  facts: CompactionFacts, windowTokens: number, ratios: CompactionRatios,
): CompactionDecision {
  const last = facts.lastInput;
  if (last === null || last < ratios.triggerRatio * windowTokens) return { kind: 'skip' };
  if (facts.view !== null && last >= Math.min(SECRETARY_HANDOFF_INPUT_TOKENS, Math.floor(0.8 * windowTokens))) {
    return { kind: 'skip' };
  }
  const stubsThrough = facts.view?.stubsThrough ?? 0;
  // An interrupted Turn does not enter the model history; its end can never be the boundary.
  const counted = facts.turns.filter(turn => !turn.interrupted && turn.endPosition > stubsThrough);
  if (counted.length < 2) return { kind: 'skip' };
  const tailBudget = Math.floor(ratios.tailRatio * ratios.targetRatio * windowTokens);
  let used = counted.at(-1)!.sizeTokens;
  let boundary = 0;
  for (let index = counted.length - 2; index >= 0; index -= 1) {
    const turn = counted[index]!;
    if (used + turn.sizeTokens > tailBudget) {
      boundary = turn.endPosition;
      break;
    }
    used += turn.sizeTokens;
  }
  if (boundary === 0) return { kind: 'skip' };
  const savedChars = counted.filter(turn => turn.endPosition <= boundary)
    .reduce((sum, turn) => sum + turn.savedChars, 0);
  const estimate = last - Math.floor(savedChars * TOKENS_PER_CHAR);
  return { kind: estimate <= ratios.targetRatio * windowTokens ? 'stubs' : 'summary', boundary, savedChars };
}

/**
 * The facts of one backward read (`scanCompactionHistory`, which reads the Kernel records): each turn's size in the
 * current view and the characters its stubs save.
 */
function factsOf(scan: CompactionHistoryScan): CompactionFacts {
  const newest = scan.turns[0];
  const stubsThrough = scan.view?.stubsThrough ?? 0;
  return {
    lastInput: newest?.lastInput ?? null,
    turns: [...scan.turns].reverse().map(turn => {
      const savedChars = turn.resultChars.reduce((sum, chars) => sum + Math.max(0, chars - STUB_ALLOWANCE), 0);
      return { endPosition: turn.endPosition, runId: turn.runId, interrupted: turn.interrupted, savedChars,
        // A stubbed turn's results are stubs in the current view.
        sizeTokens: (turn.endPosition <= stubsThrough ? turn.chars - savedChars : turn.chars) * TOKENS_PER_CHAR };
    }),
    view: scan.view,
    startedWithFailed: newest?.basisThrough != null && scan.failedAt.has(newest.basisThrough),
  };
}

export type CompactionWriteResult =
  | { status: 'compacted'; position: number }
  | { status: 'not_compacted' }
  | { status: 'rejected'; code: 'unavailable'; reason: string };

export type SummaryCallResult =
  | { kind: 'ok'; text: string; outputTokens: number | null }
  | { kind: 'busy_or_aborted' }
  | { kind: 'failed' };

const NOT_COMPACTED: CompactionWriteResult = { status: 'not_compacted' };

type CompactionRecordContent = Pick<AppendCompactionRecordInput, 'outcome' | 'stubs' | 'summary' | 'failure'>;

/** L19: the first failed check of a returned summary, or null. The sources section only has to exist (R3). */
function summaryFailure(text: string, outputTokens: number | null): string | null {
  if (outputTokens === null || text.trim().length === 0) return 'summary_call_failed';
  const lines = new Set(text.split('\n').map(line => line.trim()));
  const missing = SUMMARY_SECTIONS.findIndex(heading => !lines.has(heading));
  if (missing >= 0) return `section_missing:${String(missing + 1)}`;
  return outputTokens > SUMMARY_MAX_TOKENS ? 'over_cap' : null;
}

/**
 * L12: the compaction at a turn's start. The record's position, written or reused, is the turn's history boundary
 * (`compacted`); `not_compacted` keeps the cursor; `unavailable` (a Kernel read or the head probe failed) means the
 * turn does not start, as a failed boundary read does.
 */
export async function compactionAtStart(input: {
  ctx: CoreCallContext;
  session: SessionRecord;
  cursor: number;
  windowTokens: number;
  ratios: CompactionRatios;
  kernelStores: KernelStoreRegistry;
  now: () => string;
  /** The RunRefs of this line's Work claims, in the line's workspace; absent gives every stub the fixed read-back. */
  readWorkRunRefs?: (ctx: CoreCallContext, session: SessionRef) => Promise<ReadResult<readonly RunRef[]>>;
  summarize: (boundary: number, cursor: number) => Promise<SummaryCallResult>;
}): Promise<CompactionWriteResult> {
  const { ctx, session, cursor } = input;
  const unavailable = (reason: string): CompactionWriteResult =>
    rejected('unavailable', `the compaction at the turn start failed: ${reason}`);
  const owner = createSessionHistoryCursorOwner({ kernelStores: input.kernelStores });
  let facts: CompactionFacts;
  try {
    // R20: a compaction record based on the cursor is this turn's own (a lost start, a resumed Turn): it is reused.
    // Any other record there (a Turn closed after such a record is not one) means no compaction now.
    const first = await readRecordAfterCursor(owner, session, cursor, ctx.signal);
    if (first !== null) {
      return first.compactionBasedOn === cursor ? { status: 'compacted', position: first.position } : NOT_COMPACTED;
    }
    facts = factsOf(await scanCompactionHistory(owner, { session, cursor,
      minNewestInput: input.ratios.triggerRatio * input.windowTokens, signal: ctx.signal }));
  } catch (error) {
    return unavailable(`this line's Kernel history could not be read: ${messageOf(error)}`);
  }
  const decision = compactionBasis(facts, input.windowTokens, input.ratios);
  if (decision.kind === 'skip') return NOT_COMPACTED;
  let content: CompactionRecordContent;
  if (decision.kind === 'stubs') {
    // L13/R24: every history turn after the summary up to the boundary gets its read-back again, stubbed or not.
    const runRefs = new Map<string, RunRef>();
    if (input.readWorkRunRefs !== undefined) {
      const read = await input.readWorkRunRefs(ctx, { projectId: session.ref.projectId, sessionId: session.ref.sessionId });
      if (read.status !== 'ready') return unavailable('the Work claims of this line could not be read');
      for (const runRef of read.value) runRefs.set(workKernelRunIdOf(runRef), runRef);
    }
    const readBack = Object.fromEntries(facts.turns
      .filter(turn => !turn.interrupted && turn.endPosition <= decision.boundary)
      .map(turn => {
        const runRef = runRefs.get(turn.runId);
        return [turn.runId, runRef === undefined ? NO_READ_BACK
          : `look_graph ${canonicalJson({ mode: 'history', runRef } as never)}`];
      }));
    content = { outcome: 'compacted', stubs: { throughPosition: decision.boundary, readBack }, summary: null, failure: null };
  } else {
    const called = await input.summarize(decision.boundary, cursor);
    // R23: a refused permit (a person's pause or cancel) or an aborted call is no compaction failure; nothing is written.
    if (called.kind === 'busy_or_aborted') return NOT_COMPACTED;
    const failure = called.kind === 'ok' ? summaryFailure(called.text, called.outputTokens) : 'summary_call_failed';
    // R24: a summary record carries no stubs; the Kernel keeps no older stubs under it.
    content = called.kind === 'ok' && failure === null
      ? { outcome: 'compacted', stubs: null, summary: { throughPosition: decision.boundary, text: called.text }, failure: null }
      : { outcome: 'failed', stubs: null, summary: null, failure: { reason: failure ?? 'summary_call_failed' } };
  }
  let appended: { probed: false; reason: string } | { probed: true; result: AppendCompactionRecordResult };
  try {
    appended = await input.kernelStores.withStore(session.kernel.adapterId, async store => {
      let revision: number;
      try {
        revision = (await store.get(session.kernel.kernelSessionId, { signal: ctx.signal })).revision;
      } catch (error) {
        return { probed: false as const, reason: messageOf(error) };
      }
      return { probed: true as const, result: await appendCompactionRecord(store, { sessionId: session.kernel.kernelSessionId,
        expectedRevision: revision, at: input.now(), basedOnPosition: cursor, ...content }) };
    });
  } catch (error) {
    appended = { probed: false, reason: messageOf(error) };
  }
  if (!appended.probed) return unavailable(`the Kernel Session head could not be read: ${appended.reason}`);
  // R8: every other answer (conflict, unreadable, not_idle, invalid) leaves this turn uncompacted.
  return appended.result.status === 'appended' ? { status: 'compacted', position: appended.result.position } : NOT_COMPACTED;
}

/** R10/L16: whether this line's next turn would compact first. Read-only; a read failure, or a just-ended turn that
 * started on a failed compaction, answers false (today's handoff). */
export async function wouldCompactNext(input: {
  ctx: CoreCallContext;
  session: SessionRecord;
  windowTokens: number;
  ratios: CompactionRatios;
  kernelStores: KernelStoreRegistry;
}): Promise<boolean> {
  const owner = createSessionHistoryCursorOwner({ kernelStores: input.kernelStores });
  try {
    const boundary = await owner.completedBoundary({ session: input.session, signal: input.ctx.signal });
    if (boundary.status !== 'resolved' || boundary.cursor === null) return false;
    const facts = factsOf(await scanCompactionHistory(owner, { session: input.session, cursor: boundary.position,
      minNewestInput: input.ratios.triggerRatio * input.windowTokens, signal: input.ctx.signal }));
    return !facts.startedWithFailed && compactionBasis(facts, input.windowTokens, input.ratios).kind !== 'skip';
  } catch {
    return false;
  }
}

/** The options a turn's one model loop shares with its summary call: all but the nine per-turn fields (R34). */
export type SummaryCallOptions = Omit<ObservedModelRunOptions, 'executionIdentity' | 'input' | 'sessionId'
  | 'sessionContext' | 'controlHooks' | 'inputSupply' | 'toolGroupBarrier' | 'onKernelExited' | 'onResourcesClosed'>
  & { modelCalls: ModelCallAccess };

/** L18: the summary call's only hook refuses every tool call. */
const BLOCK_ALL_TOOLS: HookPort = {
  hookId: 'k2-summary-block-tools', point: 'before_tool', priority: 0,
  async execute() {
    return { point: 'before_tool' as const, kind: 'block' as const, reason: '摘要调用不执行工具' };
  },
};

/**
 * L18: one summary call for this turn. A new temporary Kernel Session continues this line's history up to `boundary`
 * with the view at `cursor`, on this turn's model, prompt, tools, meter and permits; the permit binds this turn's input
 * digest. The line's own Session gets no Turn. A refused permit ends the call at once instead of the Kernel's retries.
 */
export async function runSummaryCall(input: {
  options: SummaryCallOptions;
  kernelStores: KernelStoreRegistry;
  session: SessionRecord;
  boundary: number;
  cursor: number;
  /** The frozen summary prompt; rendered inside the call so a set frozen without it fails the call only. */
  text: () => string;
  /** This turn's input digest (Work: the Run's input binding; Query: the manifest's). */
  inputDigest: string;
  newId: () => string;
  now: () => string;
}): Promise<SummaryCallResult> {
  const { options } = input;
  const own = new AbortController();
  const signal = AbortSignal.any([options.signal, own.signal]);
  let refused: CoreError | null = null;
  const modelCalls: ModelCallAccess = {
    bind: binding => options.modelCalls.bind(binding),
    async beforeCall(call) {
      try {
        await options.modelCalls.beforeCall({ ...call, contextInputDigest: input.inputDigest });
      } catch (error) {
        if (error instanceof RuntimeModelCallRejected) {
          refused = error.code;
          own.abort();
        }
        throw error;
      }
    },
  };
  const stopped = (): SummaryCallResult =>
    refused === 'busy' || options.signal.aborted ? { kind: 'busy_or_aborted' } : { kind: 'failed' };
  const before = options.meter.entries.length;
  try {
    const sessionId = input.newId();
    await input.kernelStores.withStore(input.session.kernel.adapterId, store =>
      store.create({ sessionId, recordId: `session:${sessionId}`, createdAt: input.now() }, { signal }));
    const result = await runObservedModel({
      ...options, modelCalls, signal, sessionId, input: input.text(),
      sessionContext: { version: 1, mode: 'session_history', sourceSessionId: input.session.kernel.kernelSessionId,
        throughPosition: input.boundary, viewPosition: input.cursor },
      controlHooks: [BLOCK_ALL_TOOLS],
    });
    if (refused !== null || signal.aborted) return stopped();
    const final = result.state.transcript.findLast(entry => entry.kind === 'assistant_message');
    if (result.state.status !== 'completed' || final?.kind !== 'assistant_message') return { kind: 'failed' };
    const last = options.meter.entries.length > before ? options.meter.entries.at(-1) : undefined;
    return { kind: 'ok', text: final.message.content, outputTokens: last?.outputTokens ?? null };
  } catch {
    return stopped();
  }
}
