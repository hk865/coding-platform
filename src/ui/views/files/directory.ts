import type { CoreScope } from '../../../app/core-http-types.js';
import { callCore } from '../../api/http.js';
import { list } from '../../components/html.js';
import type { ScopeState } from '../../state/scope-state.js';
import { record } from '../../state/values.js';
import { renderScopeIfSelected } from '../../state/workbench.js';

// ---------------------------------------------------------------------------
// UI-directory-inventory: bounded path enumeration decoupled from text capture.
//
// The ordinary file tree must not depend on a `source/capture`: `files/list`
// enumerates bounded paths (a binary or oversized member is listed by path) and
// the page keeps its OWN local projection per exact scope+prefix. It never mixes
// with the formal `source/query` page and never calls `source/capture`. A reply
// is attributed by the scope+generation frozen before the request, so a stale
// reply can never overwrite a newer refresh or another prefix.
// ---------------------------------------------------------------------------
export type DirectoryInventoryState = {
  /** The exact scope the listing was requested under (frozen before the await). */
  scope: CoreScope;
  /** The exact directory prefix this list belongs to; '' is the workspace root. */
  prefix: string;
  /** The request generation last issued for this scope+prefix. */
  generation: number;
  paths: string[];
  partial: boolean;
  /** Local display window over `paths`; "show more" grows it by one page. */
  visibleCount: number;
  loading: boolean;
  error: string | null;
  /** A failed refresh keeps this PREFIX's previous paths and marks them stale. */
  stale: boolean;
  loaded: boolean;
};

export type DirectoryInventoryReply =
  | { status: 'ready'; value: { paths: string[]; partial: boolean } }
  | { status: 'rejected'; code: string; reason?: string };

export type DirectoryInventorySend = (
  request: { scope: CoreScope; prefix: string; generation: number },
) => Promise<DirectoryInventoryReply>;

/** The fixed local page size of "show more"; it is a display window over one
 * already-enumerated list, never a server cursor or a second cache. */
export const DIRECTORY_INVENTORY_PAGE_SIZE = 100;

/**
 * The real directory-inventory entry. It freezes the exact scope+prefix+request
 * generation before the first await and stores the pending state under its own
 * prefix, so:
 *   - opening a NEW prefix creates its own list instead of being rejected
 *     against an older prefix;
 *   - a same-prefix refresh bumps the generation, so every older in-flight reply
 *     is discarded when it finally lands;
 *   - only a failure keeps the previous list, flagged stale under its own
 *     scope+prefix, and never blends a different prefix into it.
 * It issues no request when a loaded list is opened again without `refresh`.
 */
export async function ensureDirectory(
  directories: Map<string, DirectoryInventoryState>,
  scope: CoreScope,
  prefix: string,
  refresh: boolean,
  send: DirectoryInventorySend,
): Promise<DirectoryInventoryState | null> {
  const previous = directories.get(prefix) ?? null;
  if (!refresh && previous !== null && previous.loaded && previous.error === null) return previous;
  const frozenScope: CoreScope = { projectId: scope.projectId, workspaceId: scope.workspaceId };
  const generation = (previous?.generation ?? 0) + 1;
  directories.set(prefix, {
    scope: frozenScope, prefix, generation,
    paths: previous?.paths ?? [], partial: previous?.partial ?? false,
    visibleCount: previous?.visibleCount ?? 0,
    loading: true, error: null, stale: false, loaded: previous?.loaded ?? false,
  });
  const reply = await send({ scope: frozenScope, prefix, generation });
  const current = directories.get(prefix) ?? null;
  // A newer request for this prefix already replaced the entry; the old reply
  // must not land.
  if (current === null || current.generation !== generation) return current;
  if (reply.status === 'ready') {
    directories.set(prefix, {
      ...current,
      paths: [...reply.value.paths],
      partial: reply.value.partial,
      // A successful (re)enumeration resets the local window to its first page.
      visibleCount: Math.min(reply.value.paths.length, DIRECTORY_INVENTORY_PAGE_SIZE),
      loading: false, error: null, stale: false, loaded: true,
    });
  } else {
    directories.set(prefix, {
      ...current, loading: false, error: reply.reason ?? reply.code,
      stale: current.paths.length > 0,
    });
  }
  return directories.get(prefix) ?? null;
}

/** Reveal the next local page of the SAME already-enumerated list. It appends
 * to the visible window, never replaces the rows, and never issues a request. */
export function showMoreDirectoryInventory(state: DirectoryInventoryState): DirectoryInventoryState {
  return { ...state, visibleCount: Math.min(state.paths.length, state.visibleCount + DIRECTORY_INVENTORY_PAGE_SIZE) };
}

/** The real browser transport for one frozen inventory request: it goes to the
 * Host `files/list` route and never to `source/capture`. */
async function sendDirectoryRequest(request: { scope: CoreScope; prefix: string; generation: number }): Promise<DirectoryInventoryReply> {
  const outcome = await callCore('files/list', {
    scope: request.scope,
    input: request.prefix.length === 0 ? {} : { prefix: request.prefix },
  });
  if (outcome.kind === 'network') {
    return { status: 'rejected', code: 'unavailable', reason: '连接中断，未收到回执。' };
  }
  if (outcome.status === 403) {
    return { status: 'rejected', code: 'forbidden', reason: '连接已失效，请刷新页面重新连接。' };
  }
  const envelope = record(outcome.payload);
  if (envelope.status === 'ready') {
    const value = record(envelope.value);
    return { status: 'ready', value: {
      paths: list(value.paths).filter((path): path is string => typeof path === 'string'),
      partial: value.partial === true,
    } };
  }
  return { status: 'rejected', code: typeof envelope.code === 'string' ? envelope.code : 'unavailable',
    reason: typeof envelope.reason === 'string' ? envelope.reason : '目录列出失败。' };
}

/** Open or refresh one directory page through the real entry: it renders the
 * in-place loading state before the await and the settled state after it. It
 * never touches a text capture. */
export async function loadDirectory(scope: ScopeState, prefix: string, refresh: boolean): Promise<void> {
  const pending = ensureDirectory(scope.directories, scope.config.scope, prefix, refresh, sendDirectoryRequest);
  renderScopeIfSelected(scope);
  await pending;
  renderScopeIfSelected(scope);
}

/** Normalize the user's directory input for the `files/list` prefix. Empty,
 * `'.'`, `'/'` and `'./'` all mean the workspace ROOT (omit the prefix); any
 * other value is passed through with only a leading `./` and trailing `/`
 * removed. The Host still applies its strict relative-path/read-scope rule, so
 * the page never widens or rewrites a path itself. */
export function normalizeDirectoryInput(raw: string): string {
  let value = raw.trim();
  if (value === '' || value === '.' || value === '/' || value === './') return '';
  if (value.startsWith('./')) value = value.slice(2);
  value = value.replace(/\/+$/, '');
  return value === '.' ? '' : value;
}
