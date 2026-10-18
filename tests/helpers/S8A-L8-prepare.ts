/**
 * Slice 8 L8 / H4 (book §9 last paragraph; rework-2 row D): the ONE shared
 * preparation path for the later reminder and preparation rows.
 *
 * It reaches the prepared value and its manifest body through the real platform
 * owners only: `runtime.prepareExecution`, then `materials.openArtifact` with
 * `usage: 'historical_explanation'`, then the public body's `input`. It opens no
 * body store, builds no Host configuration, wraps no Role facts and reads no
 * record: every fact is produced by the platform's own code.
 *
 * The reader is the SAME Host context the caller passed in (B§9, ruling 7):
 * `usage: 'historical_explanation'` is what admits a Host historical read, so
 * the prepared manifest is opened exactly as the Host reads other material. No
 * Run identity is invented for the read. Throws when either owner is not ready;
 * rows that assert a failure call the owner directly instead.
 */
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import type { createTargetPlatform } from '../../src/composition/create-platform.js';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

export type PreparedWithMaterials = {
  prepared: PreparedTaskExecution;
  bundleRef: ArtifactRef;
  input: string;
};

export async function prepareExecutionAndArtifact(
  platform: Platform,
  ctx: CoreCallContext,
  runRef: RunRef,
  /** Kept for the callers that still carry the claim binding; the read below
   * uses the Host context, never a work_run identity. */
  _roleBinding: RoleBindingRefV1,
  requestId: string = `s8a-l8-prepare-${runRef.goalId}-${runRef.runId}`,
): Promise<PreparedWithMaterials> {
  const prepared = await platform.runtime.prepareExecution(ctx, { runRef, requestId });
  if (prepared.status !== 'ready') {
    throw new Error(`prepareExecution was not ready: ${JSON.stringify(prepared)}`);
  }
  const bundleRef = prepared.value.envelope.bundleRef;
  const artifact = await platform.materials.openArtifact(ctx, {
    ref: bundleRef, usage: 'historical_explanation',
  });
  if (artifact.status !== 'ready') {
    throw new Error(`the prepared manifest was not readable: ${JSON.stringify(artifact)}`);
  }
  const parsed = JSON.parse(artifact.value.body) as { input?: unknown };
  if (typeof parsed.input !== 'string') throw new Error('the prepared manifest body has no string input');
  return { prepared: prepared.value, bundleRef, input: parsed.input };
}
