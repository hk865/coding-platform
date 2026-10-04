/**
 * Server-sent events framing for the task E change stream. The page reads the
 * stream with fetch() + ReadableStream instead of EventSource, because
 * EventSource cannot send the `x-platform-token` header. No DOM, no timers.
 *
 * The parser follows the HTML event-stream rules: lines end in CRLF, LF or CR
 * (a CR that ends one chunk and the LF that starts the next are one line end);
 * a leading BOM is dropped; `:` lines are comments; `data` lines are joined with
 * `\n`; `id` sets the last event id unless it contains NUL and persists across
 * events; `retry` and unknown fields are ignored; a blank line dispatches, an
 * event without data is not dispatched, and an unterminated event at the end of
 * the stream is discarded. The default event name is `message`.
 */

export type SseMessage = { event: string; data: string; lastEventId: string };

export type SseParser = {
  /** Feed decoded text; complete events are dispatched synchronously. */
  push(text: string): void;
  /** The last event id buffer (persists across events). */
  lastEventId(): string;
};

const LINE_END = /\r\n?|\n/g;

/** `initialLastEventId` carries the id buffer over from an earlier connection. */
export function createSseParser(onMessage: (message: SseMessage) => void, initialLastEventId = ''): SseParser {
  let pending = '';
  let started = false;
  let skipLf = false;
  let eventType = '';
  let data = '';
  let lastEventId = initialLastEventId;

  const dispatch = (): void => {
    const type = eventType;
    eventType = '';
    if (data === '') return;
    const message: SseMessage = { event: type === '' ? 'message' : type, data: data.slice(0, -1), lastEventId };
    data = '';
    onMessage(message);
  };

  const processLine = (line: string): void => {
    if (line === '') { dispatch(); return; }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventType = value;
    else if (field === 'data') data += `${value}\n`;
    else if (field === 'id' && !value.includes('\u0000')) lastEventId = value;
  };

  return {
    push(text: string): void {
      if (text.length === 0) return;
      if (!started) {
        started = true;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      if (skipLf) {
        skipLf = false;
        if (text.startsWith('\n')) text = text.slice(1);
      }
      pending += text;
      // Split first, then process: a throwing listener can never make a line run twice.
      const lines: string[] = [];
      let position = 0;
      LINE_END.lastIndex = 0;
      for (let match = LINE_END.exec(pending); match !== null; match = LINE_END.exec(pending)) {
        lines.push(pending.slice(position, match.index));
        position = LINE_END.lastIndex;
        if (match[0] === '\r' && position === pending.length) skipLf = true;
      }
      pending = pending.slice(position);
      for (const line of lines) processLine(line);
    },
    lastEventId: () => lastEventId,
  };
}

/**
 * Read a response body into the parser until it ends. `onChunk` runs for every
 * received chunk (a heartbeat comment counts as activity). Resolves when the
 * stream ends; rejects when reading fails (including an abort), after
 * cancelling the reader.
 */
export async function readSse(body: ReadableStream<Uint8Array>, parser: SseParser, onChunk: () => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk();
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  }
}
