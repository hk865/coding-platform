/**
 * xws2p: the ONE project-path grammar shared by WorkGraph, the notes and the UI.
 *
 * A project path is a workspace-relative path of the MAIN workspace written
 * bare, or a path of another workspace carrying the fixed `/@ws:` prefix plus
 * the `encodeURIComponent`-encoded workspace id. The prefix begins with `/`, so
 * the Kernel's absolute-path refusal and the old relative-path checks both
 * reject it as a real workspace file; it only ever exists in project-level
 * payloads (catalog module paths, note anchors, link evidence).
 *
 * The workspace id is decoded first and the canonical prefix is encoded back
 * (`%77s2` and `ws2` are one id), so duplicate checks and anchor keys see one
 * string. A main-workspace prefix (or an alias of it) is not a second spelling:
 * it is refused on the request side and is a damaged record on the stored side.
 */
export const WORKSPACE_PROJECT_PATH_PREFIX = '/@ws:' as const;

export type ParsedProjectPathV1 = { workspaceId: string | null; path: string };

/** The workspace-relative path grammar (formerly `note-anchors.isSafeRelativePath`). */
export function isSafeWorkspaceRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  if (/[\\:\0]/.test(value)) return false;
  const segments = value.split('/');
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

type PrefixParts = { encodedId: string; relative: string | null };

/** Split a prefixed path at the first `/`; `relative: null` is the workspace root. */
function prefixParts(path: string): PrefixParts | null {
  if (!path.startsWith(WORKSPACE_PROJECT_PATH_PREFIX)) return null;
  const after = path.slice(WORKSPACE_PROJECT_PATH_PREFIX.length);
  const slash = after.indexOf('/');
  if (slash < 0) return { encodedId: after, relative: null };
  return { encodedId: after.slice(0, slash), relative: after.slice(slash + 1) };
}

function decodedIdOf(encodedId: string): string | null {
  if (encodedId.length === 0) return null;
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

/** Project-path grammar: a safe relative path, the single `.`, or the prefixed form. */
export function isSafeProjectPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  const parts = prefixParts(value);
  if (parts === null) return value === '.' || isSafeWorkspaceRelativePath(value);
  const id = decodedIdOf(parts.encodedId);
  if (id === null || id.length === 0) return false;
  // A bare prefix is the workspace root; a trailing `/` has an empty relative part and is refused.
  return parts.relative === null || isSafeWorkspaceRelativePath(parts.relative);
}

/**
 * The ONE parse of a stored/declared project path. A prefixed path names that
 * workspace (decoded id); a bare path is the main workspace (`null`). The
 * relative part is normalized (a leading `./` is dropped). An ill-formed
 * prefix is an internal invariant failure: user input passes `isSafeProjectPath`
 * first, so it throws rather than guessing.
 */
export function splitWorkspacePath(path: string): ParsedProjectPathV1 {
  const parts = prefixParts(path);
  if (parts === null) return { workspaceId: null, path: normalizeProjectPath(path) };
  const id = decodedIdOf(parts.encodedId);
  if (id === null || id.length === 0 || (parts.relative !== null && parts.relative.length === 0)) {
    throw new Error(`invalid workspace project path: ${path}`);
  }
  return { workspaceId: id, path: parts.relative === null ? '.' : normalizeProjectPath(parts.relative) };
}

function canonicalPrefix(workspaceId: string): string {
  return WORKSPACE_PROJECT_PATH_PREFIX + encodeURIComponent(workspaceId);
}

function relativePathOf(path: string): string {
  let value = path;
  while (value.startsWith('./')) value = value.slice(2);
  return value;
}

/**
 * The one normalization before a duplicate check, a key or a write: the id is
 * decoded and re-encoded canonically and the relative part loses its leading
 * `./`. No core `normalizePath` copy.
 */
export function normalizeProjectPath(path: string): string {
  const parts = prefixParts(path);
  if (parts === null) return relativePathOf(path);
  const id = decodedIdOf(parts.encodedId);
  if (id === null || id.length === 0 || (parts.relative !== null && parts.relative.length === 0)) {
    throw new Error(`invalid workspace project path: ${path}`);
  }
  const prefix = canonicalPrefix(id);
  const relative = parts.relative === null ? '.' : relativePathOf(parts.relative);
  return relative === '.' ? prefix : `${prefix}/${relative}`;
}

/**
 * The write-side qualifier. A prefixed path keeps its own workspace (the alias
 * is written back canonically); a bare request path joins the requesting
 * workspace. The main workspace stays bare. A prefix naming the main workspace
 * (or an alias of it) is refused, never read as a second spelling.
 */
export function qualifyProjectPath(workspaceId: string, path: string,
  mainWorkspaceId: string | null): string {
  const parsed = splitWorkspacePath(path);
  if (parsed.workspaceId === mainWorkspaceId) {
    throw new Error('the main workspace path must not carry a workspace prefix');
  }
  const target = parsed.workspaceId ?? workspaceId;
  if (target === mainWorkspaceId) return parsed.path;
  if (parsed.path === '.') return canonicalPrefix(target);
  return `${canonicalPrefix(target)}/${parsed.path}`;
}

/**
 * A request path: qualify to the requesting workspace, then normalize. A
 * main-workspace prefix or alias is refused here (the caller passed user
 * input, not a stored record).
 */
export function normalizeRequestProjectPath(requestWorkspaceId: string, path: string,
  mainWorkspaceId: string | null): string {
  // The `normalizeProjectPath` leading-`./` rule comes first, so `./src/a.ts`
  // and `src/a.ts` are one request; the grammar then rejects `..`, an empty
  // segment, a drive or a malformed prefix before qualification.
  const normalized = normalizeProjectPath(path);
  if (!isSafeProjectPath(normalized)) throw new Error(`invalid request project path: ${path}`);
  return qualifyProjectPath(requestWorkspaceId, normalized, mainWorkspaceId);
}

/**
 * A stored path resolves to its own workspace; a bare path is the MAIN
 * workspace, never the caller's. A main-workspace prefix is a damaged record
 * and throws (the record's writer refused it).
 */
export function resolveStoredProjectPath(path: string, mainWorkspaceId: string):
  { workspaceId: string; path: string } {
  const parsed = splitWorkspacePath(path);
  if (parsed.workspaceId === mainWorkspaceId) {
    throw new Error('the main workspace path must not carry a workspace prefix');
  }
  return { workspaceId: parsed.workspaceId ?? mainWorkspaceId, path: parsed.path };
}

/**
 * Display is the last step: the main workspace keeps its bare path and another
 * workspace shows `<decoded id>/<relative>` (the root shows `<id>`). The raw
 * `/@ws:` text never reaches a DTO.
 */
export function displayProjectPath(path: string): string {
  const parsed = splitWorkspacePath(path);
  if (parsed.workspaceId === null) return parsed.path;
  return parsed.path === '.' ? parsed.workspaceId : `${parsed.workspaceId}/${parsed.path}`;
}
