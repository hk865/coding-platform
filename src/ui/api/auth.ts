/// <reference lib="dom" />
/** The page token: read once from the document meta tag and kept in page memory only. */

import { UI_PLATFORM_TOKEN_META_NAME } from './protocol.js';

export const token = typeof document === 'undefined' ? '' : readToken();

function readToken(): string {
  const meta = document.querySelector(`meta[name="${UI_PLATFORM_TOKEN_META_NAME}"]`);
  return meta?.getAttribute('content')?.trim() ?? '';
}
