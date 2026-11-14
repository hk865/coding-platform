/**
 * B06: the one Runtime reader of the witness facts. It pages the subject Run's
 * original history, decodes and reduces the fixed Turn with the shared Kernel
 * pair, and returns the final text and the successful read set. It only reads.
 */
import { messageOf } from '../../contracts/error-message.js';
import { isRecord } from '../../contracts/validation/common.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WitnessFacts, WitnessReadSet } from '../../contracts/verification.js';
import type { WitnessFactsRequest } from '../work-graph/model/witness-facts-contracts.js';
import type { GraphExecutionHistoryReadPort } from './execution-history-contracts.js';
import { decodeKernelEntry, finalAssistantMessageOf, reduceTurnFromStart } from './kernel-turn-facts.js';
import type { DecodedKernelRecord } from './kernel-turn-facts.js';

/** The one exit for unreadable facts: the port has no rejection channel. */
function unknownWitnessFacts(reason: string): WitnessFacts {
  return { report: { state: 'unknown', reason }, reads: { state: 'unknown', reason } };
}

/** `read_source`'s success JSON: `output[0].value.path`; anything else is null (that call is not a read). */
function sourceReadPathOf(output: readonly unknown[]): string | null {
  const part = output[0];
  if (!isRecord(part) || part['kind'] !== 'json' || !isRecord(part['value'])) return null;
  const path = part['value']['path'];
  return typeof path === 'string' ? path : null;
}

/**
 * The Turn's successful reads in history order, `tool.started` paired with
 * `tool.completed` by callId: native `read` takes `arguments.path`;
 * `read_source` counts only when its success JSON names the same path. Search,
 * listing and symbol tools are not reads. Paths are kept as written.
 */
export function successfulReadPathsOf(decoded: readonly DecodedKernelRecord[]): string[] {
  const started = new Map<string, { name: string; path: string }>();
  const paths: string[] = [];
  for (const item of decoded) {
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.type === 'tool.started') {
      const call = (event.payload as { call: { callId: string; name: string; arguments: Record<string, unknown> } }).call;
      const path = call.arguments['path'];
      if (typeof path === 'string') started.set(call.callId, { name: call.name, path });
      continue;
    }
    if (event.type !== 'tool.completed') continue;
    const completed = event.payload as { callId: string; result: { status: string; output: readonly unknown[] } };
    const call = started.get(completed.callId);
    if (call === undefined || completed.result.status !== 'success') continue;
    if (call.name === 'read') { paths.push(call.path); continue; }
    if (call.name === 'read_source' && sourceReadPathOf(completed.result.output) === call.path) paths.push(call.path);
  }
  return paths;
}

/**
 * `WitnessFactsPort.read`: pages from `afterCursor: null` until `nextCursor`
 * is null (the reader re-proves later pages); the first page's identity is
 * checked against the binding. A non-ready page, a damaged entry, a missing
 * `turn.started` or a throw makes both facts `unknown`. The final text is
 * `present` only when non-blank, and is never trimmed.
 */
export async function readWitnessFacts(
  deps: { graphHistory: GraphExecutionHistoryReadPort },
  ctx: CoreCallContext,
  request: WitnessFactsRequest,
): Promise<WitnessFacts> {
  const { runRef, kernel } = request;
  const decoded: DecodedKernelRecord[] = [];
  try {
    let afterCursor: string | null = null;
    for (;;) {
      const page = await deps.graphHistory.readTaskExecutionHistory(ctx, { runRef, afterCursor, limit: 200 });
      if (page.status !== 'ready') {
        return unknownWitnessFacts(page.status === 'not_found' || page.status === 'not_ready'
          ? `the execution history is ${page.status}`
          : page.reason);
      }
      if (afterCursor === null
        && (page.value.executionIdentity.runId !== kernel.runId || page.value.executionIdentity.turnId !== kernel.turnId)) {
        return unknownWitnessFacts('the execution history page names another Run or Turn');
      }
      for (const entry of page.value.items) {
        const item = decodeKernelEntry(entry);
        if (item === null) return unknownWitnessFacts('a raw history entry is damaged or not a Kernel Session record');
        decoded.push(item);
      }
      if (page.value.nextCursor === null) break;
      afterCursor = page.value.nextCursor;
    }
    const state = reduceTurnFromStart(decoded, kernel);
    if (state === null) return unknownWitnessFacts('the fixed turn.started record is not in the Run history');
    const reads: WitnessReadSet = { state: 'known', paths: successfulReadPathsOf(decoded) };
    const outcome = state.outcome ?? null;
    if (outcome === null || outcome.kind !== 'completed') {
      // `absent` is kept for a completed Turn whose final message is missing or blank.
      return { report: { state: 'unknown', reason: 'the reduced Turn has no completed outcome to name a final message' }, reads };
    }
    const message = finalAssistantMessageOf(state, outcome.finalMessageId);
    if (message === null || message.message.content.trim().length === 0) return { report: { state: 'absent' }, reads };
    return { report: { state: 'present', text: message.message.content }, reads };
  } catch (error) {
    return unknownWitnessFacts(`the execution history could not be read or reduced: ${messageOf(error)}`);
  }
}
