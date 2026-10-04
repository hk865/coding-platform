/**
 * Task E change stream, browser side: the server-sent events framing of
 * `src/ui/api/sse.ts` that the page uses instead of EventSource (which cannot
 * send the token header). Line ends, chunk boundaries, comments, fields, the
 * persistent id buffer, and UTF-8 split across network chunks.
 * Pure Node test: no DOM, no network, no Host.
 */
import { describe, expect, it } from 'vitest';
import { createSseParser, readSse } from '../../src/ui/api/sse.js';
import type { SseMessage } from '../../src/ui/api/sse.js';

function collect(initialLastEventId?: string) {
  const messages: SseMessage[] = [];
  const parser = createSseParser(message => messages.push(message), initialLastEventId);
  return { messages, parser };
}

/** One chunk per pull, then the end (or the failure) once every chunk was read. */
function bodyOf(chunks: Uint8Array[], failure?: Error): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk !== undefined) controller.enqueue(chunk);
      else if (failure === undefined) controller.close();
      else controller.error(failure);
    },
  });
}

describe('SSE parser', () => {
  it('dispatches event, id and data on a blank line, with `message` as the default name', () => {
    const { messages, parser } = collect();
    parser.push('event: ready\nid: c0000000042\ndata: {"cursor":"c0000000042"}\n\n');
    parser.push('data: plain\n\n');
    expect(messages).toEqual([
      { event: 'ready', data: '{"cursor":"c0000000042"}', lastEventId: 'c0000000042' },
      { event: 'message', data: 'plain', lastEventId: 'c0000000042' },
    ]);
    expect(parser.lastEventId()).toBe('c0000000042');
  });

  it('joins data lines with a newline and strips exactly one leading space', () => {
    const { messages, parser } = collect();
    parser.push('data:a\ndata:  b\ndata\n\n');
    expect(messages.map(message => message.data)).toEqual(['a\n b\n']);
  });

  it('accepts LF, CRLF and CR line ends, and a CR ending one chunk with the LF starting the next is one line end', () => {
    const { messages, parser } = collect();
    parser.push('data: a\r');
    parser.push('\ndata: b\n\n');
    parser.push('data: c\r\n\r\ndata: d\r\rdata: e\n\n');
    expect(messages.map(message => message.data)).toEqual(['a\nb', 'c', 'd', 'e']);
  });

  it('dispatches across arbitrary chunk boundaries exactly once', () => {
    const text = 'event: change\nid: c0000000007\ndata: {"kinds":["tasks"]}\n\n: hb\n\nevent: reset\ndata: {}\n\n';
    for (let size = 1; size <= text.length; size += 1) {
      const { messages, parser } = collect();
      for (let index = 0; index < text.length; index += size) parser.push(text.slice(index, index + size));
      expect(messages, `chunk size ${size}`).toEqual([
        { event: 'change', data: '{"kinds":["tasks"]}', lastEventId: 'c0000000007' },
        { event: 'reset', data: '{}', lastEventId: 'c0000000007' },
      ]);
    }
  });

  it('ignores comments, retry and unknown fields, and an id containing NUL', () => {
    const { messages, parser } = collect();
    parser.push(': heartbeat\nretry: 10\nfoo: bar\nid: c0000000001\ndata: x\n\nid: bad\u0000id\ndata: y\n\n');
    expect(messages).toEqual([
      { event: 'message', data: 'x', lastEventId: 'c0000000001' },
      { event: 'message', data: 'y', lastEventId: 'c0000000001' },
    ]);
  });

  it('keeps the id buffer for events without an id and starts from a carried-over id', () => {
    const { messages, parser } = collect('c0000000009');
    parser.push('data: first\n\nid: c0000000010\ndata: second\n\ndata: third\n\n');
    expect(messages.map(message => message.lastEventId)).toEqual(['c0000000009', 'c0000000010', 'c0000000010']);
  });

  it('does not dispatch an event without data and resets the event name after every blank line', () => {
    const { messages, parser } = collect();
    parser.push('event: change\n\ndata: later\n\n');
    expect(messages).toEqual([{ event: 'message', data: 'later', lastEventId: '' }]);
  });

  it('drops one leading BOM only', () => {
    const { messages, parser } = collect();
    parser.push('﻿data: a\n\n');
    parser.push('﻿data: b\n\n');
    expect(messages.map(message => message.data)).toEqual(['a']);
  });
});

describe('readSse', () => {
  it('decodes UTF-8 split inside a character, reports every chunk and discards an unterminated last event', async () => {
    const bytes = new TextEncoder().encode('data: 变化\n\n: hb\n\ndata: cut');
    const { messages, parser } = collect();
    let chunks = 0;
    // `变` occupies bytes 6..8: the first chunk ends inside it.
    await readSse(bodyOf([bytes.slice(0, 7), bytes.slice(7, 13), bytes.slice(13)]), parser, () => { chunks += 1; });
    expect(chunks).toBe(3);
    expect(messages).toEqual([{ event: 'message', data: '变化', lastEventId: '' }]);
  });

  it('rejects when reading fails, after delivering what arrived before', async () => {
    const { messages, parser } = collect();
    const failure = new Error('connection reset');
    await expect(readSse(bodyOf([new TextEncoder().encode('data: before\n\n')], failure), parser, () => undefined))
      .rejects.toBe(failure);
    expect(messages.map(message => message.data)).toEqual(['before']);
  });

  it('cancels the stream and rethrows when a listener throws', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: boom\n\n')); },
      cancel() { cancelled = true; },
    });
    const parser = createSseParser(() => { throw new Error('listener failed'); });
    await expect(readSse(body, parser, () => undefined)).rejects.toThrow('listener failed');
    expect(cancelled).toBe(true);
  });
});
