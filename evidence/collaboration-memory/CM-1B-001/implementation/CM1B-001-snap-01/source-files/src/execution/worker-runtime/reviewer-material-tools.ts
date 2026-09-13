import { toolSchema as z, type ToolDefinition } from '../../../vendor/coding-agent/dist/public-api.js';
import { REVIEWER_MATERIAL_PAGE_MAX_BYTES, type ReviewerRuntimeAccess } from '../../contracts/reviewer-context.js';

const effects = { sideEffect: 'none' as const, changedPaths: [], workspaceRevision: null, artifactRefs: [] };

/** The model selects only entries in its authorized packet. It cannot supply an
 * owner, Run, grant or arbitrary ArtifactRef to widen the read capability. */
export function createReviewerMaterialTools(access: ReviewerRuntimeAccess, assertCurrent: () => Promise<void>): ToolDefinition[] {
  const inputSchema = z.object({
    materialId: z.string().min(1).max(1024),
    offset: z.number().int().min(0).default(0),
    maxBytes: z.number().int().min(1).max(REVIEWER_MATERIAL_PAGE_MAX_BYTES).default(16384),
  }).strict();
  return [{
    name: 'read_material',
    description: 'Read an exact original report from the authorized review packet by materialId. Returns bounded UTF-8 byte pages and the original artifact digest. Continue from nextOffset until complete; unavailable or stale material cannot be treated as reviewed.',
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
        return { schemaVersion: 1, callId: call.callId, status: 'success', output: [{ kind: 'json', value }], effects } as never;
      } catch (error) {
        if (options.signal.aborted) return cancelled();
        return { schemaVersion: 1, callId: call.callId, status: 'error', error: { code: 'execution_failed', message: error instanceof Error ? error.message : 'Review material unavailable', retryable: false }, output: [], effects };
      }
    } },
  }];
}
