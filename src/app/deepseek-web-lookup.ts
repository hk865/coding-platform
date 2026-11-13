/**
 * The Host-process adapter for DeepSeek's official Search & Fetch endpoints.
 *
 * One adapter belongs to one bound model: the bearer key and the bound base
 * address are captured here and never appear in an argument, a result, an error
 * text, a log or a URL. The requested page travels only in the JSON body, and
 * the request always targets the bound address's origin. Upstream error bodies
 * are never read or relayed.
 */
import { rejected } from '../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import { isRecord } from '../contracts/validation/common.js';
import type { WebLookupPort, WebSearchHitV1 } from '../core/agent-runtime/web-lookup-tools.js';

const SEARCH_LABEL = 'DeepSeek 搜索接口';
const FETCH_LABEL = 'DeepSeek 抓取接口';

/** The fixed status mapping: the reason carries the status code and never upstream text. */
function webLookupRejectionOf(status: number, label: string): CoreRejection {
  if (status === 400 || status === 413) return rejected('invalid', `${label} 说参数不对（HTTP ${status}）`);
  if (status === 401) return rejected('unavailable', `${label} 不认这个模型的密钥（HTTP 401），到设置页检查`);
  if (status === 402) return rejected('unavailable', 'DeepSeek 账户余额不足（HTTP 402）');
  if (status === 403) return rejected('forbidden', `${label} 按 DeepSeek 的安全策略拒绝了这个网址（HTTP 403）`);
  if (status === 404) return rejected('not_found', `${label} 回 404：网址不可用、站点不允许、内容类型不支持，或这个地址没有该接口`);
  if (status === 429) return rejected('busy', `${label} 限速（HTTP 429），稍后再试`);
  if (status >= 300 && status < 400)
    return rejected('unavailable', `${label} 回了重定向（HTTP ${status}）；这个工具不跟随重定向，以免密钥头被带到别的地址`);
  return rejected('unavailable', `${label} 暂时不可用（HTTP ${status}），稍后可以重试`);
}

const webLookupUnreadable = (label: string): CoreRejection => rejected('unavailable', `${label} 回的内容认不出`);

function hitOf(value: unknown): WebSearchHitV1 | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== 'string' || typeof value.url !== 'string' || typeof value.summary !== 'string') return null;
  const siteName = value.site_name;
  const date = value.date;
  if (siteName !== undefined && siteName !== null && typeof siteName !== 'string') return null;
  if (date !== undefined && date !== null && typeof date !== 'string') return null;
  return {
    title: value.title,
    url: value.url,
    summary: value.summary,
    siteName: siteName ?? null,
    date: date ?? null,
  };
}

export function createDeepSeekWebLookup(config: {
  apiKey: string;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}): WebLookupPort {
  async function webLookupPost(path: string, body: unknown, label: string, signal: AbortSignal): Promise<ReadResult<unknown>> {
    let response: Response;
    try {
      response = await config.fetch(new URL(path, config.baseUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        // A redirect would carry the bearer header to an address the binding did
        // not choose; refuse it instead of following.
        redirect: 'error',
      });
    } catch {
      return rejected('unavailable', `连不上 ${label}`);
    }
    if (!response.ok) return webLookupRejectionOf(response.status, label);
    try {
      return { status: 'ready', value: await response.json() };
    } catch {
      return webLookupUnreadable(label);
    }
  }

  return {
    async search(input, signal) {
      const result = await webLookupPost('/v1/tools/search', {
        query: input.query,
        ...(input.count === undefined ? {} : { count: input.count }),
      }, SEARCH_LABEL, signal);
      if (result.status !== 'ready') return result;
      if (!isRecord(result.value) || !Array.isArray(result.value.results)) return webLookupUnreadable(SEARCH_LABEL);
      const results: WebSearchHitV1[] = [];
      let omitted = 0;
      for (const entry of result.value.results) {
        const hit = hitOf(entry);
        if (hit === null) {
          omitted += 1;
          continue;
        }
        results.push(hit);
      }
      return { status: 'ready', value: { results, omitted } };
    },

    async fetch(input, signal) {
      const result = await webLookupPost('/v1/tools/fetch', { url: input.url }, FETCH_LABEL, signal);
      if (result.status !== 'ready') return result;
      if (!isRecord(result.value) || typeof result.value.content !== 'string') return webLookupUnreadable(FETCH_LABEL);
      return {
        status: 'ready',
        value: {
          title: typeof result.value.title === 'string' ? result.value.title : '',
          content: result.value.content,
        },
      };
    },
  };
}
