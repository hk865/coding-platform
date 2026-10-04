/// <reference lib="dom" />

import type { CoreRouteSuffix } from '../../app/core-http-types.js';
import type {
  HostSettingsPort,
  SettingsResponse,
  SettingsRoute,
  SettingsRoutes,
} from '../../app/host-settings-types.js';
import { token } from './auth.js';
import { SETTINGS_API_PREFIX, UI_CORE_API_PREFIX, UI_PLATFORM_TOKEN_HEADER } from './protocol.js';
import { record } from '../state/values.js';

// ---------------------------------------------------------------------------
// Host transport
// ---------------------------------------------------------------------------

export type CallOutcome =
  | { kind: 'response'; status: number; payload: unknown }
  | { kind: 'network'; reason: string };

export async function callCore(route: CoreRouteSuffix, body: unknown): Promise<CallOutcome> {
  try {
    const response = await fetch(UI_CORE_API_PREFIX + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [UI_PLATFORM_TOKEN_HEADER]: token },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    return { kind: 'response', status: response.status, payload };
  } catch (error) {
    return { kind: 'network', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Read the payload of a real HTTP response; a network outcome has none. */
export function payloadOf(outcome: CallOutcome): unknown {
  return outcome.kind === 'response' ? outcome.payload : null;
}

export function outcomeProblem(outcome: CallOutcome): string | null {
  if (outcome.kind === 'network') return `网络结果不确定：${outcome.reason}。原请求已保留，可重试同一请求。`;
  if (outcome.status === 403) return '连接已失效，请刷新页面重新连接。';
  return null;
}

export function outcomeRejectionReason(payload: unknown): string {
  const envelope = record(payload);
  return envelope.status === 'rejected' && typeof envelope.reason === 'string' ? envelope.reason : '命令未提交';
}

/** A valid `SettingsResponse` rejected carried by a non-2xx body. The exact
 * code/reason is preserved rather than flattened to a generic HTTP failure. */
function asRejectedResponse(payload: unknown): Extract<SettingsResponse<unknown>, { status: 'rejected' }> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (value.status !== 'rejected' || typeof value.reason !== 'string') return null;
  const allowed = ['invalid', 'forbidden', 'not_found', 'unavailable', 'unsupported'];
  const code = typeof value.code === 'string' && allowed.includes(value.code)
    ? value.code as 'invalid' | 'forbidden' | 'not_found' | 'unavailable' | 'unsupported'
    : 'unavailable';
  return { status: 'rejected', code, reason: value.reason };
}

/** The frozen DTO is the whole body: every route POSTs its `input` verbatim to
 * `/api/real/settings/{route}` with the same per-page token header as every
 * other workbench request. A non-2xx answer is parsed first: when the Host
 * returned a valid `SettingsResponse` rejected, its exact code/reason is
 * preserved instead of being flattened to a generic HTTP failure. A Host that
 * lacks the capability therefore shows the actual reason it reported. */
export function createHostSettingsPort(): HostSettingsPort {
  return {
    async call<K extends SettingsRoute>(
      route: K,
      input: SettingsRoutes[K]['input'],
    ): Promise<SettingsResponse<SettingsRoutes[K]['value']>> {
      try {
        const response = await fetch(SETTINGS_API_PREFIX + route, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [UI_PLATFORM_TOKEN_HEADER]: token },
          body: JSON.stringify(input),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const rejected = asRejectedResponse(payload);
          if (rejected !== null) return rejected as SettingsResponse<SettingsRoutes[K]['value']>;
          return {
            status: 'rejected',
            code: response.status === 404 ? 'unsupported' : 'unavailable',
            reason: `设置接口 ${route} 失败（HTTP ${response.status}）。`,
          };
        }
        if (payload === null) {
          return { status: 'rejected', code: 'unavailable', reason: `设置接口 ${route} 返回了无法解析的响应。` };
        }
        return payload as SettingsResponse<SettingsRoutes[K]['value']>;
      } catch (error) {
        return {
          status: 'rejected',
          code: 'unavailable',
          reason: `设置接口 ${route} 连接失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
