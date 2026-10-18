/**
 * F-083 (K3 B3 rework 9): the ONE pure UTF-8 truncation, shared by the
 * continuation brief's declared-form text, the script-expansion display text and
 * the CRR declared-form text.
 *
 * A cut is always on a whole Unicode code point, so the result is at most
 * `maxBytes` UTF-8 bytes and never contains a split character. It is pure: no
 * clock, store, platform or runtime.
 */
const ENCODER = new TextEncoder();

/** The UTF-8 byte length of `text`. */
export function utf8ByteLength(text: string): number {
  return ENCODER.encode(text).length;
}

/**
 * Cut `text` to at most `maxBytes` UTF-8 bytes without splitting a code point.
 * A character that would cross the boundary is dropped whole; the trailing
 * bytes are never filled with a replacement character.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  let used = 0;
  let cut = '';
  for (const character of text) {
    const bytes = utf8ByteLength(character);
    if (used + bytes > maxBytes) break;
    used += bytes;
    cut += character;
  }
  return cut;
}
