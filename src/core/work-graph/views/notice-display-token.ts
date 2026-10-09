/**
 * Slice 5 §2.8/§4.1: the read-only notice display-page token (F46).
 *
 * The token binds Workspace/category/filter/caller/read-watermark/full after key
 * so `markNoticesSeen` can prove that exactly this page was really returned. The
 * key is created ONCE by composition (32 random bytes) and injected here; `state`
 * and `configuration` never hold it, and it is never persisted or read from Host
 * credentials. Wire: `base64url(UTF8(canonicalJson(payload))) + '.' +
 * lowercase HMAC-SHA256 hex`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  NoticeDisplayTokenPayloadV1,
  NoticeDisplayTokenPort,
} from '../model/decision-contracts.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shape-check of the parsed body, so a forged/garbled payload never decodes. */
function asPayload(value: unknown): NoticeDisplayTokenPayloadV1 | null {
  if (!isRecord(value) || value['schemaVersion'] !== 1) return null;
  if (!isRecord(value['workspace']) || !isRecord(value['operator'])) return null;
  if (typeof value['sourceCursor'] !== 'string') return null;
  if (!Array.isArray(value['categories']) || !Array.isArray(value['returnedKeys'])) return null;
  if (!isRecord(value['seenThrough'])) return null;
  return value as unknown as NoticeDisplayTokenPayloadV1;
}

/** Builds the in-process display-token codec from the composition-injected key. */
export function createNoticeDisplayToken(key: Uint8Array): NoticeDisplayTokenPort {
  const secret = Buffer.from(key);
  const mac = (encoded: string): Buffer =>
    createHmac('sha256', secret).update(encoded, 'utf8').digest();

  return {
    issue(payload: NoticeDisplayTokenPayloadV1): string {
      const encoded = Buffer.from(canonicalJson(payload as unknown as JsonValue), 'utf8').toString('base64url');
      return `${encoded}.${mac(encoded).toString('hex')}`;
    },
    verify(token: string): NoticeDisplayTokenPayloadV1 | null {
      const separator = token.indexOf('.');
      if (separator <= 0 || separator === token.length - 1) return null;
      const encoded = token.slice(0, separator);
      const presented = Buffer.from(token.slice(separator + 1), 'hex');
      const expected = mac(encoded);
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
      try {
        return asPayload(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
      } catch {
        return null;
      }
    },
  };
}
