/**
 * Task E test helper: read a real `text/event-stream` response body frame by
 * frame. Only the test side parses here; the product client has its own parser.
 * A comment-only block (the heartbeat) is returned as `{ comment: true }`.
 */
import {
  CHANGES_SUFFIX,
  CORE_API_PREFIX,
  LAST_EVENT_ID_HEADER,
  PLATFORM_TOKEN_HEADER,
} from '../../src/app/core-http-types.js';

export type StreamFrame = {
  comment: boolean;
  event: string | null;
  id: string | null;
  data: unknown;
};

export type OpenedStream = {
  response: Response;
  /** Next frame; null when the stream ended. Rejects after `timeoutMs`. */
  next(timeoutMs?: number): Promise<StreamFrame | null>;
  /** Next non-comment frame. */
  nextEvent(timeoutMs?: number): Promise<StreamFrame | null>;
  /** Resolves true when no frame arrives within `ms`. */
  quiet(ms: number): Promise<boolean>;
  abort(): void;
};

function parseBlock(block: string): StreamFrame {
  const lines = block.split('\n');
  if (lines.every(line => line.startsWith(':'))) return { comment: true, event: null, id: null, data: null };
  let event: string | null = null;
  let id: string | null = null;
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  return { comment: false, event, id, data: data.length === 0 ? null : JSON.parse(data.join('\n')) };
}

/** Wrap a stream response; one pending read is shared so a timed-out wait never
 * drops the chunk that arrives later. */
export function readFrames(response: Response, controller: AbortController): OpenedStream {
  const body = response.body;
  if (body === null) throw new Error('the change stream has no body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  let done = false;

  async function next(timeoutMs = 3_000): Promise<StreamFrame | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const separator = buffer.indexOf('\n\n');
      if (separator >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        return parseBlock(block);
      }
      if (done) return null;
      pending ??= reader.read();
      const remaining = deadline - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), Math.max(0, remaining)); });
      let chunk: ReadableStreamReadResult<Uint8Array> | 'timeout';
      try { chunk = await Promise.race([pending, timedOut]); }
      catch { done = true; pending = null; return null; }
      finally { clearTimeout(timer); }
      if (chunk === 'timeout') throw new Error(`no stream frame within ${timeoutMs} ms`);
      pending = null;
      if (chunk.done) { done = true; continue; }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  return {
    response,
    next,
    async nextEvent(timeoutMs = 3_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const frame = await next(Math.max(1, deadline - Date.now()));
        if (frame === null || !frame.comment) return frame;
      }
    },
    async quiet(ms) {
      try { await next(ms); return false; } catch { return true; }
    },
    abort() { controller.abort(); },
  };
}

/** Open `GET /api/real/core/changes` on `origin` (no trailing slash needed). */
export async function openChangeStream(
  origin: string, token: string, lastEventId?: string,
): Promise<OpenedStream> {
  const controller = new AbortController();
  const headers: Record<string, string> = { [PLATFORM_TOKEN_HEADER]: token, accept: 'text/event-stream' };
  if (lastEventId !== undefined) headers[LAST_EVENT_ID_HEADER] = lastEventId;
  const response = await fetch(new URL(CORE_API_PREFIX + CHANGES_SUFFIX, origin), { headers, signal: controller.signal });
  if (response.status !== 200) {
    const text = await response.text().catch(() => '');
    throw new Error(`the change stream answered ${response.status}: ${text}`);
  }
  return readFrames(response, controller);
}

/** Poll `predicate` until it holds or `timeoutMs` passes. */
export async function until(predicate: () => boolean, timeoutMs = 3_000, stepMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise(resolve => setTimeout(resolve, stepMs));
  }
}
