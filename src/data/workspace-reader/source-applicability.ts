import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { validMaterialSourcePin, validMaterialSourceSet } from '../../contracts/material-access.js';
import type { MaterialSourceCaptureResult, MaterialSourcePinV1, MaterialSourceScope, MaterialSourceSetV1, SourceApplicabilityPort } from '../../contracts/material-access.js';
import type { ProjectSourceAccess } from './project-source-index.js';

type Query = MaterialSourceScope & { sourceSet: MaterialSourceSetV1 };
const validPath = (path: string) => typeof path === 'string' && !!path && !/[\\:\0]/.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..');
const selected = (path: string, roots: string[]) => roots.some(root => root === '.' || path === root || path.startsWith(root + '/'));
const unavailable = (message: string): MaterialSourceCaptureResult => ({ status: 'unavailable', issues: [message] });

/** Source identity over the host's permission-checked file inventory. Source code,
 * configuration, and Git history are never executed. The manifest includes every
 * readable file in the explicit selection, including additions and deletions.
 * Two equal observations detect changes during capture; this is not an atomic
 * multi-file snapshot or a replacement for a Workspace lease. */
export class WorkspaceSourceApplicability implements SourceApplicabilityPort {
  constructor(private readonly resolve: (scope: MaterialSourceScope) => ProjectSourceAccess | null | Promise<ProjectSourceAccess | null>) {}

  async capture(query: Query, signal: AbortSignal = new AbortController().signal): Promise<MaterialSourceCaptureResult> {
    if (!query || typeof query.projectId !== 'string' || !query.projectId || typeof query.workspaceId !== 'string' || !query.workspaceId || !validMaterialSourceSet(query.sourceSet) || query.sourceSet.kind !== 'workspace_paths') {
      return { status: 'rejected', issues: ['invalid source scope or source set'] };
    }
    try {
      signal.throwIfAborted();
      const access = await this.resolve({ projectId: query.projectId, workspaceId: query.workspaceId });
      if (!access) return unavailable('source identity capability is unavailable for this Project/Workspace');
      const first = await this.observe(query, access, signal);
      const second = await this.observe(query, access, signal);
      if (canonicalJson(first) !== canonicalJson(second)) return { status: 'stale', issues: ['source changed during capture'] };
      return { status: 'sourced', pin: first };
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : 'source identity could not be read');
    }
  }

  private async observe(query: Query, access: ProjectSourceAccess, signal: AbortSignal): Promise<MaterialSourcePinV1> {
    const identity = await access.sourceIdentity();
    const inventory = await access.inventory(signal);
    if (inventory.truncated || inventory.paths.length > 60000) throw Error('source inventory is incomplete or exceeds 60000 files');
    if (inventory.paths.some(path => !validPath(path))) throw Error('source inventory contains an unsafe path');
    const paths = [...new Set(inventory.paths)].filter(path => selected(path, query.sourceSet.paths) && access.allowed(path)).sort();
    for (const root of query.sourceSet.paths) if (root !== '.' && !paths.some(path => selected(path, [root]))) throw Error('selected source path is unavailable or outside readable scope: ' + root);
    const files: Array<{ path: string; digest: string; bytes: number }> = [];
    let total = 0;
    for (const path of paths) {
      signal.throwIfAborted();
      if (!access.allowed(path)) throw Error('source permission changed during capture');
      const { content } = await access.read(path, 2 * 1024 * 1024);
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > 2 * 1024 * 1024 || content.includes('\0')) throw Error('source is binary or exceeds 2 MiB: ' + path);
      total += bytes;
      if (total > 128 * 1024 * 1024) throw Error('source selection exceeds 128 MiB; choose narrower paths');
      files.push({ path, digest: sha256Hex(content), bytes });
    }
    const pin: MaterialSourcePinV1 = { schemaVersion: 1, projectId: query.projectId, workspaceId: query.workspaceId,
      sourceSet: structuredClone(query.sourceSet), identity, manifestDigest: sha256Hex(canonicalJson({ schemaVersion: 1, identity, files })) };
    if (!validMaterialSourcePin(pin)) throw Error('source identity capability returned an invalid identity');
    return pin;
  }
}

/** Re-read the trusted provider and compare the full scope, selection and source
 * identity. Merely repeating an old sourceDigest or manifestDigest cannot pass. */
export async function materialSourcePinIsCurrent(port: SourceApplicabilityPort | undefined, pin: MaterialSourcePinV1 | undefined, scope: MaterialSourceScope): Promise<boolean> {
  if (!port || !validMaterialSourcePin(pin) || pin.projectId !== scope.projectId || pin.workspaceId !== scope.workspaceId) return false;
  try {
    const current = await port.capture({ ...scope, sourceSet: pin.sourceSet });
    return current.status === 'sourced' && validMaterialSourcePin(current.pin) && canonicalJson(current.pin) === canonicalJson(pin);
  } catch { return false; }
}
