/**
 * RE2 support: read the tool result the Kernel persisted, through the public
 * Runtime history page only (never a Runtime-internal decoder, never the
 * database).
 *
 * Builds: `readRLStoredToolResult` (public `readSessionHistory` +
 * `sessionRecordSchema`), `cancelRLRun` (the public control submit/deliver
 * path) and the literal cap reports the rows use.
 * Rows: RL-30 … RL-36.
 */
import { expect } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionHistoryEntry, SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { sessionRecordSchema, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import type { S2BBe1PlatformFixture } from './S2B-be1-platform-fixture.js';
import { rlSandbox } from './RL-kernel-sandbox-double.js';

function isKernelRecordBody(body: SessionHistoryEntry['body']): body is { encoding: 'kernel_session_record_json'; text: string } {
  return typeof body === 'object' && body !== null && 'encoding' in body
    && (body as { encoding?: unknown }).encoding === 'kernel_session_record_json'
    && typeof (body as { text?: unknown }).text === 'string';
}

export async function readRLStoredToolResult(
  port: Pick<SessionOperationsPort, 'readSessionHistory'>,
  ctx: CoreCallContext,
  sessionRef: SessionRef,
  callId: string,
): Promise<ToolResult | undefined> {
  const history = await port.readSessionHistory(ctx, { sessionRef, afterCursor: null, throughCursor: null, limit: 200 });
  if (history.status !== 'ready') throw new Error('the Session history was not readable: ' + JSON.stringify(history));
  for (const item of history.value.items) {
    if (!isKernelRecordBody(item.body)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(item.body.text); } catch { continue; }
    const record = sessionRecordSchema.safeParse(parsed);
    if (!record.success || record.data.recordType !== 'agent.event') continue;
    const event = record.data.payload.event;
    if (event.type === 'tool.completed' || event.type === 'tool.failed' || event.type === 'tool.cancelled') {
      if (event.payload.callId === callId) return event.payload.result;
    }
  }
  return undefined;
}

/** The JSON output part of a tool result. */
export function rlJsonPart(result: ToolResult | undefined): Record<string, unknown> | undefined {
  const part = result?.output.find(entry => entry.kind === 'json');
  return part?.kind === 'json' ? part.value as Record<string, unknown> : undefined;
}

/**
 * Cancel the Run at `runs[index]` through the public control entry while the
 * command is still running (the RL-30 (f) / RL-31 overlay path). The double's
 * `execute` settles on the resulting abort.
 */
export async function cancelRLRun(
  fixture: S2BBe1PlatformFixture,
  index: number,
  requestId: string,
): Promise<TaskExecutionRecord> {
  const ref: RunRef = fixture.runs[index]!.ref;
  const prepared = await fixture.platform.runtime.prepareExecution(fixture.ctx, { runRef: ref, requestId: `${requestId}-prepare` });
  if (prepared.status !== 'ready') throw new Error(`RL cancel prepare failed: ${JSON.stringify(prepared)}`);
  const running = fixture.platform.runtime.startRun(fixture.ctx, { prepared: prepared.value,
    consumerId: `${requestId}-driver`, requestId: `${requestId}-start` });
  // The command must be dispatched (and the double waiting) before the cancel.
  await expect.poll(() => rlSandbox.commands.length, { timeout: 5_000, interval: 20 }).toBeGreaterThan(0);
  const read = await fixture.platform.executions.readExecution(fixture.ctx, ref);
  if (read.status === 'ready') {
    const pin = { ref, revision: read.value.run.revision };
    const submitted = await fixture.platform.controls.submitControl(fixture.ctx, {
      input: { runRef: ref, kind: 'cancel', reason: `${requestId} operator cancel` },
      meta: { requestId: `${requestId}-cancel`, expected: [pin] },
    });
    if (submitted.status === 'committed') {
      await fixture.platform.runtime.deliverControl(fixture.ctx, { intentRef: submitted.value.intent.ref });
    }
  }
  const started = await running;
  if (started.status !== 'ready') throw new Error(`RL cancel start failed: ${JSON.stringify(started)}`);
  const observed = await fixture.platform.runtime.observeRun(fixture.ctx, { runRef: ref });
  if (observed.status !== 'ready') throw new Error(`RL cancel observe failed: ${JSON.stringify(observed)}`);
  return observed.value;
}
