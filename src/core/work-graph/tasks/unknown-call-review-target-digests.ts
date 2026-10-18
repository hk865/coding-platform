/**
 * K3 L18: the ONE reader of the current working-tree digest of each review-card
 * target path.
 *
 * The card projection stays pure: the read model and the answerability facts
 * call this helper and pass its result in. It follows the note views'
 * `readCurrentFile` precedent (`views/note-views.ts` ~271-284): only a `ready`
 * read yields a digest; `not_found`, `forbidden`, `capacity`, `unavailable` and
 * a thrown read all mean "not readable" and yield `null`, never a failed card.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceToolsPort } from '../../workspace/ports.js';
import { NOTE_BASIS_FILE_MAX_BYTES } from '../model/note-contracts.js';

/** One read per path per read attempt; the key cannot collide with another attempt entry. */
const DIGEST_CACHE_PREFIX = 'unknown-call-review-digest:';

export const REVIEW_TARGET_FILE_MAX_BYTES = NOTE_BASIS_FILE_MAX_BYTES;

function cacheKeyOf(path: string): string {
  return `${DIGEST_CACHE_PREFIX}${path}`;
}

/**
 * Read the current digest of every distinct path, in the given order. A path
 * already in `cache` (the read model's per-attempt cache) is not read again on
 * the next page. With no workspace seam every digest is `null`, so existing
 * constructions keep compiling and behaving.
 */
export async function readReviewTargetDigests(
  ctx: CoreCallContext,
  workspace: Pick<WorkspaceToolsPort, 'readWorkspace'> | undefined,
  paths: readonly string[],
  cache?: Map<string, unknown>,
): Promise<ReadonlyMap<string, string | null>> {
  const digests = new Map<string, string | null>();
  const workspaceRef = { aggregateType: 'Workspace' as const,
    projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
  for (const path of paths) {
    const key = cacheKeyOf(path);
    const cached = cache?.get(key);
    if (cached !== undefined) {
      digests.set(path, cached as string | null);
      continue;
    }
    let digest: string | null = null;
    if (workspace !== undefined) {
      try {
        const read = await workspace.readWorkspace(ctx, {
          workspace: workspaceRef, path, maxBytes: REVIEW_TARGET_FILE_MAX_BYTES,
          version: { kind: 'working_tree' },
        });
        if (read.status === 'ready') digest = read.value.digest;
      } catch {
        digest = null;
      }
    }
    cache?.set(key, digest);
    digests.set(path, digest);
  }
  return digests;
}
