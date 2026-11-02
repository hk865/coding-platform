import type { ContextPreviewResult, ModelClientPort, ModelRequest, ModelEvent } from '../../../vendor/coding-agent/dist/public-api.js';
import { createHash } from 'node:crypto';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
export { DEFAULT_RUNTIME_BUDGET, validateRuntimeBudget, type RuntimeBudget } from '../../contracts/runtime-budget.js';
export type InputTokenMeasurement = { tokens: number; method: 'model_tokenizer' | 'conservative_utf8_estimate'; tokenizer: string };
export type ModelInputCounter = { count(request: ModelRequest): InputTokenMeasurement | Promise<InputTokenMeasurement> };
export type MeterEntry = { requestId: string; reservedInput: number; reservedOutput: number; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; status: 'reserved' | 'reported' | 'unknown';
  inputMeasurement?: InputTokenMeasurement; inputBytes?: number; inputDigest?: string; contextWindowTokens?: number };
export type MeasuredModelRequest = {
  outgoing: ModelRequest; output: number; inputBytes: number;
  measurement: InputTokenMeasurement; fits: boolean;
};

export class BudgetExceeded extends Error {}
export class ContextCapacityExceeded extends Error {
  constructor(readonly detail: { input: InputTokenMeasurement; outputReserve: number; contextWindow: number; inputBytes: number; inputDigest: string }) {
    super(`单次 Context 容量不足：输入 ${detail.input.tokens}（${detail.input.method}）＋响应预留 ${detail.outputReserve} 超过窗口 ${detail.contextWindow}；需重新选材，模型尚未调用。`);
  }
}

/**
 * The narrow persistent Query/model budget. `tokenBudget: null` imposes NO
 * cumulative token cap and is NOT 0/Infinity; an explicit positive integer is a
 * real cumulative constraint. The deadline is independent and always checked
 * first. This deliberately does not widen the Work `TaskBudgetV1`.
 */
export type ModelTokenBudget = { tokenBudget: number | null; deadline: string | null };

/**
 * The persistent Run deadline is an absolute instant on the trusted Host clock.
 * A missing clock cannot silently drop the constraint: the driver always supplies
 * the same `now()` it meters with, so a pinned deadline without it is refused.
 */
export function taskBudgetDeadlineRemaining(taskBudget: ModelTokenBudget | null | undefined, now: (() => string) | null): number | null {
  if (taskBudget === null || taskBudget === undefined || taskBudget.deadline === null) return null;
  if (now === null) throw new Error('unsupported: enforcing the persistent task deadline requires the trusted now() clock');
  const currentMs = Date.parse(now());
  const deadlineMs = Date.parse(taskBudget.deadline);
  if (!Number.isFinite(currentMs) || !Number.isFinite(deadlineMs)) throw new Error('the persistent task deadline is not an ISO instant');
  return Math.max(0, deadlineMs - currentMs);
}

/** One durable account can wrap multiple clients; reservations include incomplete requests. */
export class ModelBudget {
  readonly entries: MeterEntry[] = [];
  exhausted = false;
  /** The last retryable provider failure, kept to replay when a retry is blocked by budget. */
  private lastRetryableProviderError: Extract<ModelEvent, { type: 'error' }> | null = null;
  /**
   * B2 adds the persistent Run's own cumulative constraint. It is optional so
   * every existing component keeps its exact behavior. When present, every model
   * request re-checks the pinned absolute deadline and the cumulative token
   * budget BEFORE the provider stream starts; the reservation of an incomplete
   * (unknown-usage) request is never freed, so a later request cannot borrow it.
   */
  constructor(readonly limits: RuntimeBudget, private readonly persist: (entries: MeterEntry[]) => Promise<void>,
    private readonly counter?: ModelInputCounter, readonly taskBudget: ModelTokenBudget | null = null,
    private readonly now: (() => string) | null = null) {}
  totals() { return this.entries.reduce((a, e) => ({ input: a.input + (e.inputTokens ?? e.reservedInput), output: a.output + (e.outputTokens ?? e.reservedOutput) }), { input: 0, output: 0 }); }
  /** The persistent absolute deadline is re-checked at the real provider
   * boundary (and again after any awaited admission) so a hook/commit that
   * crosses the deadline still makes zero provider calls. */
  assertTaskDeadline(): void {
    if (this.taskBudget === null) return;
    const remaining = taskBudgetDeadlineRemaining(this.taskBudget, this.now);
    if (remaining !== null && remaining <= 0) {
      this.exhausted = true;
      throw new BudgetExceeded('持久任务截止时间已到，未发送下一次请求');
    }
  }
  /** Pre-provider persistent-budget check. `inputReserve`/`outputReserve` are the
   * exact reservations this call will make; reserved (unknown) usage stays counted. */
  assertTaskBudgetAdmissible(inputReserve: number, outputReserve: number): void {
    if (this.taskBudget === null) return;
    this.assertTaskDeadline();
    // `tokenBudget: null` is the explicit no-cumulative-cap default; the real
    // deadline above stays enforced and no Infinity/0 sentinel is invented.
    if (this.taskBudget.tokenBudget === null) return;
    const totals = this.totals();
    if (totals.input + totals.output + inputReserve + outputReserve > this.taskBudget.tokenBudget) {
      this.exhausted = true;
      throw new BudgetExceeded('持久任务累计 Token 预算不足，未发送下一次请求');
    }
  }
  /**
   * MR (lead ruling 2026-11-02): a retry the budget refuses is not a new protocol
   * failure. Replay the last retryable provider error under the refused request's
   * own id as non-retryable and mark the account exhausted, so the Runner stops at
   * once with the model-service code and the person handles the budget when
   * continuing. A first request with no previous failure returns null (the old
   * throw stays).
   */
  private budgetBlockedRetry(requestId: string): ModelEvent | null {
    const previous = this.lastRetryableProviderError;
    if (previous === null) return null;
    this.exhausted = true;
    return { schemaVersion: 1, requestId, sequence: 1, type: 'error', error: { ...previous.error, retryable: false } };
  }
  /**
   * The one side-effect-free measurement shared by `preview`, `wrap` and the
   * request facts: the output cap, the complete final request (with that cap),
   * its input count and whether the pair fits the context window. It pushes no
   * entry, persists nothing and does not mark the meter exhausted. `totals` is
   * captured by the caller when the measurement must share one account snapshot
   * (the real reservation does).
   */
  private async measure(request: Readonly<ModelRequest>, totals = this.totals()): Promise<MeasuredModelRequest> {
    const output = Math.min(request.maxOutputTokens ?? this.limits.perResponseTokens, this.limits.perResponseTokens, this.limits.outputTokens === null ? Infinity : this.limits.outputTokens - totals.output);
    const outgoing = { ...request, maxOutputTokens: output };
    // Count the complete final request, including system/tool schemas and
    // tool history. Estimates and provider-reported usage remain separate.
    const inputBytes = Buffer.byteLength(JSON.stringify(outgoing), 'utf8');
    const measurement = this.counter ? await this.counter.count(outgoing) : { tokens: inputBytes + 4096, method: 'conservative_utf8_estimate' as const, tokenizer: 'unavailable; UTF-8 reservation only' };
    if (!Number.isSafeInteger(measurement.tokens) || measurement.tokens < 0 || !['model_tokenizer', 'conservative_utf8_estimate'].includes(measurement.method)) throw Error('输入 Token 计量无效；模型尚未调用');
    return { outgoing, output, inputBytes, measurement,
      fits: measurement.tokens + output <= this.limits.contextWindowTokens };
  }
  /**
   * Ruling 21: the Kernel's context selection measures through this method.
   * The next preview reads the same account's `totals()`, so the reserve follows
   * cumulative output (PC-15). The real reservation stays in `wrap`.
   */
  async preview(request: ModelRequest): Promise<ContextPreviewResult> {
    const { outgoing, output, measurement, fits } = await this.measure(request);
    return { outgoing, inputTokens: measurement.tokens, outputReserve: output, fits };
  }
  /**
   * `beforeReserve` receives the exact measurement this call reserves from, just
   * before the entry is pushed, so the request facts take the same cap and count
   * and no outer copy of the formula exists.
   */
  wrap(client: ModelClientPort, beforeReserve?: (measured: MeasuredModelRequest) => void): ModelClientPort {
    const self = this;
    return { async *stream(request, options) {
      const totals = self.totals();
      const measured = await self.measure(request, totals);
      const { outgoing, output, inputBytes, measurement, fits } = measured;
      const input = measurement.tokens;
      if ((self.limits.maxRequests !== null && self.entries.length >= self.limits.maxRequests) || (self.limits.inputTokens !== null && totals.input + input > self.limits.inputTokens) || output <= 0) {
        const blocked = self.budgetBlockedRetry(request.requestId);
        if (blocked !== null) { yield blocked; return; }
        self.exhausted = true; throw new BudgetExceeded('累计调用预算不足，未发送下一次请求');
      }
      // The persistent Run budget is a stronger cumulative guard than the
      // Kernel's post-usage maxTotalTokens: refuse the reservation first.
      try {
        self.assertTaskBudgetAdmissible(input, output);
      } catch (error) {
        if (!(error instanceof BudgetExceeded)) throw error;
        const blocked = self.budgetBlockedRetry(request.requestId);
        if (blocked !== null) { yield blocked; return; }
        throw error;
      }
      const inputDigest = createHash('sha256').update(JSON.stringify(outgoing)).digest('hex');
      if (!fits) throw new ContextCapacityExceeded({ input: measurement, outputReserve: output, contextWindow: self.limits.contextWindowTokens, inputBytes, inputDigest });
      beforeReserve?.(measured);
      const entry: MeterEntry = { requestId: request.requestId, reservedInput: input, reservedOutput: output, inputTokens: null, outputTokens: null, cachedInputTokens: null, status: 'reserved', inputMeasurement: measurement, inputBytes, inputDigest, contextWindowTokens: self.limits.contextWindowTokens };
      self.entries.push(entry); await self.persist(self.entries);
      let usage: Extract<ModelEvent, { type: 'usage_snapshot' }>['usage'] | undefined;
      let providerFailed = false;
      try {
        for await (const event of client.stream(outgoing, options)) {
          if (event.type === 'usage_snapshot') usage = event.usage;
          if (event.type === 'error' && event.error.retryable) self.lastRetryableProviderError = event;
          else if (event.type === 'completed') self.lastRetryableProviderError = null;
          if (['error', 'cancelled', 'truncated'].includes(event.type)) providerFailed = true;
          yield event;
        }
      } finally {
        if (usage) { entry.inputTokens = usage.inputTokens; entry.outputTokens = usage.outputTokens; entry.cachedInputTokens = usage.cachedInputTokens; entry.status = 'reported'; }
        else entry.status = 'unknown';
        await self.persist(self.entries);
      }
      if (providerFailed) return;
      const next = self.totals();
      if ((!usage && (self.limits.inputTokens !== null || self.limits.outputTokens !== null)) || (self.limits.inputTokens !== null && next.input > self.limits.inputTokens) || (self.limits.outputTokens !== null && next.output > self.limits.outputTokens)) { self.exhausted = true; throw new BudgetExceeded('用量未知或预算已耗尽，停止后续请求'); }
    } };
  }
}
