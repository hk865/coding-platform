import { toolSchema as z, type ToolDefinition } from '../../../vendor/coding-agent/dist/public-api.js';
import { REVIEWER_MATERIAL_PAGE_MAX_BYTES, type ReviewerRuntimeAccess } from '../../contracts/reviewer-context.js';
import { artifactPointerExists } from '../../contracts/validation/artifact-pointer.js';

const effects = { sideEffect: 'none' as const, changedPaths: [], workspaceRevision: null, artifactRefs: [] };

type MaterialPage = Awaited<ReturnType<ReviewerRuntimeAccess['readMaterial']>>;
const completeOriginal = (page: MaterialPage) => page.offset === 0 && page.complete && page.nextOffset === page.totalBytes && Buffer.byteLength(page.content, 'utf8') === page.totalBytes;
function withCitationChecks(page: MaterialPage, pointers: string[] | undefined) {
  if (!pointers) return page;
  const unavailable = (reason: string) => ({ ...page, citationChecks: { status: 'unavailable', reason } });
  if (!completeOriginal(page)) return unavailable('A complete original from offset zero is required; partial pages cannot prove a location absent.');
  const checked = { ...page, citationChecks: { status: 'checked', results: pointers.map(pointer => ({ pointer, exists: artifactPointerExists(page.content, pointer) })) } };
  if (Buffer.byteLength(JSON.stringify(checked), 'utf8') > 60 * 1024) return unavailable('Requested citation results exceed this tool response budget; check fewer locations.');
  return checked;
}

/** Convenience locations only; Assessment still validates the original body.
 * Breadth-first traversal keeps top-level siblings ahead of deep report trees. */
function withCitationLocations(page: Awaited<ReturnType<ReviewerRuntimeAccess['readMaterial']>>) {
  if (!completeOriginal(page)) return page;
  const citationLocations: Array<{ kind: 'artifact-section'; pointer: string }> = [];
  let citationLocationsTruncated = false;
  let root: unknown;
  try { root = JSON.parse(page.content); } catch { root = null; }
  const queue: Array<{ value: unknown; pointer: string; depth: number }> = [{ value: root, pointer: '', depth: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = queue[cursor]!;
    if (node.pointer.length > 2048) { citationLocationsTruncated = true; continue; }
    const location = { kind: 'artifact-section' as const, pointer: node.pointer };
    const proposed = [...citationLocations, location];
    // Reserve space for the tool envelope beneath its existing 64 KiB limit.
    if (proposed.length > 256 || Buffer.byteLength(JSON.stringify(proposed), 'utf8') > 8192 ||
        Buffer.byteLength(JSON.stringify({ ...page, citationLocations: proposed, citationLocationsTruncated: false }), 'utf8') > 60 * 1024) {
      citationLocationsTruncated = true;
      break;
    }
    citationLocations.push(location);
    if (node.value !== null && typeof node.value === 'object') {
      const entries = Object.entries(node.value);
      if (node.depth >= 8) { if (entries.length) citationLocationsTruncated = true; continue; }
      for (const [key, value] of entries) {
        queue.push({ value, pointer: `${node.pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth: node.depth + 1 });
      }
    }
  }
  // Never truncate original content to make room for a convenience index.
  if (!citationLocations.length) return page;
  return { ...page, citationLocations, citationLocationsTruncated };
}

/** The model selects only entries in its authorized packet. It cannot supply an
 * owner, Run, grant or arbitrary ArtifactRef to widen the read capability. */
export function createReviewerMaterialTools(access: ReviewerRuntimeAccess, assertCurrent: () => Promise<void>): ToolDefinition[] {
  const inputSchema = z.object({
    materialId: z.string().min(1).max(1024),
    offset: z.number().int().min(0).default(0),
    maxBytes: z.number().int().min(1).max(REVIEWER_MATERIAL_PAGE_MAX_BYTES).default(16384),
    citationPointers: z.array(z.string().max(2048)).min(1).max(32).optional(),
  }).strict();
  return [{
    name: 'read_material',
    description: 'Read an exact original report from the authorized review packet by materialId. Returns bounded UTF-8 byte pages and the original artifact digest. Complete originals may include bounded citationLocations relative to the original artifact root, never the tool wrapper; read the content, not just this index. Before final submission, pass proposed artifact-section pointers in citationPointers to check their exact existence. Check results do not prove relevance or truth; unavailable is not false. Continue from nextOffset until complete; unavailable or stale material cannot be treated as reviewed.',
    inputSchema, effectClass: 'read_only', requiredCapabilities: ['workspace_read'],
    defaultTimeoutMs: 10000, outputLimitBytes: 64 * 1024, independentReadOnly: true,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call, options) => {
      const cancelled = () => ({ schemaVersion: 1 as const, callId: call.callId, status: 'cancelled' as const, reason: 'Review cancelled', output: [], effects });
      if (options.signal.aborted) return cancelled();
      try {
        const input = inputSchema.parse(call.arguments);
        const matches = access.packet.materials.filter(material => material.materialId === input.materialId);
        if (matches.length !== 1) throw Error('The material is not uniquely listed in this review packet');
        await assertCurrent();
        const value = await access.readMaterial({ ref: matches[0]!.ref, offset: input.offset, maxBytes: input.maxBytes });
        await assertCurrent();
        if (options.signal.aborted) return cancelled();
        return { schemaVersion: 1, callId: call.callId, status: 'success', output: [{ kind: 'json', value: withCitationLocations(withCitationChecks(value, input.citationPointers)) }], effects } as never;
      } catch (error) {
        if (options.signal.aborted) return cancelled();
        return { schemaVersion: 1, callId: call.callId, status: 'error', error: { code: 'execution_failed', message: error instanceof Error ? error.message : 'Review material unavailable', retryable: false }, output: [], effects };
      }
    } },
  }];
}
