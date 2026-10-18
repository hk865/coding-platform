/**
 * K3 L5/L6: the read-only Artifact reads shared by the composition root and the
 * context assembler — the run-start baseline stored inside a prepared manifest
 * bundle (item 10's single decode/degrade), and the full change capture behind a
 * `WorkspaceCaptureV1` reference (L6 item 6a's full classification source).
 *
 * Both never throw: a missing or damaged Artifact degrades to null, exactly as
 * L5's "no baseline" and L6's "capture could not be read" require.
 */
import type { ArtifactRef } from '../../contracts/artifact.js';
import type {
  CapturedPathV1, WorkspaceBaselineV1, WorkspaceChangeCaptureV1,
} from '../../contracts/unknown-call-review.js';

/** The narrow body reader both callers already hold (the record store's `read`). */
export type WorkspaceArtifactReader = {
  read(ref: ArtifactRef): Promise<
    | { status: 'ready'; value: { body: string } }
    | { status: 'rejected'; code: string; reason: string }
  >;
};

export type WorkspaceBaselineBundleRead = {
  manifest: Record<string, unknown>;
  baseline: WorkspaceBaselineV1 | null;
};

/**
 * L5: the prepared manifest at `bundleRef` and its run-start baseline Artifact,
 * or null when the bundle itself cannot be read. A missing/damaged baseline is
 * `{ baseline: null }` with the manifest still returned (the composition root
 * needs `claim.runRef` and `sourceRefs` either way).
 */
export async function readWorkspaceBaselineFromBundle(
  reader: WorkspaceArtifactReader, bundleRef: ArtifactRef,
): Promise<WorkspaceBaselineBundleRead | null> {
  try {
    const stored = await reader.read(bundleRef);
    if (stored.status !== 'ready') return null;
    const manifest = JSON.parse(stored.value.body) as Record<string, unknown>;
    const descriptor = manifest['workspaceBaseline'] as { status?: unknown; ref?: ArtifactRef } | undefined;
    let baseline: WorkspaceBaselineV1 | null = null;
    if (descriptor?.status === 'captured' && descriptor.ref !== undefined) {
      // L5: only the baseline read/decode degrades to null; the manifest was
      // read and parsed above and stays valid even when the baseline is damaged.
      try {
        const baselineStored = await reader.read(descriptor.ref);
        if (baselineStored.status === 'ready') baseline = JSON.parse(baselineStored.value.body) as WorkspaceBaselineV1;
      } catch {
        baseline = null;
      }
    }
    return { manifest, baseline };
  } catch {
    return null;
  }
}

/** L6: the full `changed` list of a captured workspace, or null when it cannot be read. */
export async function readWorkspaceCaptureChanges(
  reader: WorkspaceArtifactReader, captureRef: ArtifactRef,
): Promise<CapturedPathV1[] | null> {
  try {
    const stored = await reader.read(captureRef);
    if (stored.status !== 'ready') return null;
    const capture = JSON.parse(stored.value.body) as WorkspaceChangeCaptureV1;
    return Array.isArray(capture.changed) ? capture.changed : null;
  } catch {
    return null;
  }
}
