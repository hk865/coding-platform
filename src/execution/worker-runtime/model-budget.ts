import type { ModelClientPort, ModelRequest, ModelEvent } from '../../../vendor/coding-agent/dist/public-api.js';
import { createHash } from 'node:crypto';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
export { DEFAULT_RUNTIME_BUDGET, validateRuntimeBudget, type RuntimeBudget } from '../../contracts/runtime-budget.js';
export type InputTokenMeasurement = { tokens: number; method: 'model_tokenizer' | 'conservative_utf8_estimate'; tokenizer: string };
export type ModelInputCounter = { count(request: ModelRequest): InputTokenMeasurement | Promise<InputTokenMeasurement> };
export type MeterEntry = { requestId: string; reservedInput: number; reservedOutput: number; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; status: 'reserved' | 'reported' | 'unknown';
  inputMeasurement?: InputTokenMeasurement; inputBytes?: number; inputDigest?: string; contextWindowTokens?: number };
export class BudgetExceeded extends Error {}
export class ContextCapacityExceeded extends Error {
  constructor(readonly detail: { input: InputTokenMeasurement; outputReserve: number; contextWindow: number; inputBytes: number; inputDigest: string }) {
    super(`单次 Context 容量不足：输入 ${detail.input.tokens}（${detail.input.method}）＋响应预留 ${detail.outputReserve} 超过窗口 ${detail.contextWindow}；需重新选材，模型尚未调用。`);
  }
}
/** One durable account can wrap multiple clients; reservations include incomplete requests. */
export class ModelBudget {
  readonly entries: MeterEntry[] = [];
  exhausted = false;
  constructor(readonly limits: RuntimeBudget, private readonly persist: (entries: MeterEntry[]) => Promise<void>, private readonly counter?: ModelInputCounter) {}
  totals() { return this.entries.reduce((a, e) => ({ input: a.input + (e.inputTokens ?? e.reservedInput), output: a.output + (e.outputTokens ?? e.reservedOutput) }), { input: 0, output: 0 }); }
  wrap(client: ModelClientPort): ModelClientPort {
    const self = this;
    return { async *stream(request, options) {
      const totals = self.totals();
      const output = Math.min(request.maxOutputTokens ?? self.limits.perResponseTokens, self.limits.perResponseTokens, self.limits.outputTokens === null ? Infinity : self.limits.outputTokens - totals.output);
      const outgoing = { ...request, maxOutputTokens: output };
      // Count the complete final request, including system/tool schemas and
      // tool history. Estimates and provider-reported usage remain separate.
      const inputBytes = Buffer.byteLength(JSON.stringify(outgoing), 'utf8');
      const measurement = self.counter ? await self.counter.count(outgoing) : { tokens: inputBytes + 4096, method: 'conservative_utf8_estimate' as const, tokenizer: 'unavailable; UTF-8 reservation only' };
      if (!Number.isSafeInteger(measurement.tokens) || measurement.tokens < 0 || !['model_tokenizer', 'conservative_utf8_estimate'].includes(measurement.method)) throw Error('输入 Token 计量无效；模型尚未调用');
      const input = measurement.tokens;
      if ((self.limits.maxRequests !== null && self.entries.length >= self.limits.maxRequests) || (self.limits.inputTokens !== null && totals.input + input > self.limits.inputTokens) || output <= 0) { self.exhausted = true; throw new BudgetExceeded('累计调用预算不足，未发送下一次请求'); }
      const inputDigest = createHash('sha256').update(JSON.stringify(outgoing)).digest('hex');
      if (input + output > self.limits.contextWindowTokens) throw new ContextCapacityExceeded({ input: measurement, outputReserve: output, contextWindow: self.limits.contextWindowTokens, inputBytes, inputDigest });
      const entry: MeterEntry = { requestId: request.requestId, reservedInput: input, reservedOutput: output, inputTokens: null, outputTokens: null, cachedInputTokens: null, status: 'reserved', inputMeasurement: measurement, inputBytes, inputDigest, contextWindowTokens: self.limits.contextWindowTokens };
      self.entries.push(entry); await self.persist(self.entries);
      let usage: Extract<ModelEvent, { type: 'usage_snapshot' }>['usage'] | undefined;
      let providerFailed = false;
      try {
        for await (const event of client.stream(outgoing, options)) {
          if (event.type === 'usage_snapshot') usage = event.usage;
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
