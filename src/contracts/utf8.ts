/**
 * F-083 (K3 B3 rework 9): the ONE pure UTF-8 truncation, shared by the
 * continuation brief's declared-form text, the script-expansion display text and
 * the CRR declared-form text.
 * 取末尾的那一种（`utf8Tail`、`streamTail`）也在这里：检查基线和 Run 步骤的命令输出共用。
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

/** 文字末尾不超过 `maxBytes` 字节的一段，不切开一个字。 */
export function utf8Tail(text: string, maxBytes: number): string {
  const chars = Array.from(text);
  let start = chars.length;
  let bytes = 0;
  while (start > 0) {
    const size = utf8ByteLength(chars[start - 1]!);
    if (bytes + size > maxBytes) break;
    bytes += size;
    start -= 1;
  }
  return chars.slice(start).join('');
}

/**
 * lead 11-17 裁定 5：Kernel 每路输出只收前 32 KiB，超过的部分丢掉；这时取到的只是前段的末尾，要让批准者知道。
 * 真正保留进程输出末尾要改 Kernel（走受管补丁流程），记进待办。
 * 检查基线和 Run 步骤的命令输出（P1）都用这一条。
 */
export const TRUNCATED_MARK = '（输出超过上限，这里只是前段的末尾）';

/** 一路进程输出的末尾 `maxBytes` 字节；Kernel 已截过的，前面带 `TRUNCATED_MARK`（标记的字节从 `maxBytes` 里扣）。 */
export function streamTail(stream: { text: string; truncated: boolean }, maxBytes: number): string {
  if (!stream.truncated) return utf8Tail(stream.text, maxBytes);
  return TRUNCATED_MARK + utf8Tail(stream.text, maxBytes - utf8ByteLength(TRUNCATED_MARK));
}
