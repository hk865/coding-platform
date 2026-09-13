import { ArtifactVault } from '../../src/data/artifact-vault/artifact-vault.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { RuntimeContextAccess } from '../../src/data/context-compiler/runtime-context.js';

/** Standalone permission/lifecycle fixtures need an owned bundle; product-path tests use the real compiler. */
export async function storeRuntimeTestBundle(envelope: TaskEnvelopeV1): Promise<RuntimeContextAccess> {
  const vault = new ArtifactVault();
  const body = JSON.stringify({
    schemaVersion: 1, projectId: envelope.projectId, workspaceId: envelope.workspaceId, goalId: envelope.goalId, taskId: envelope.taskId,
    runRef: envelope.runRef, attemptRef: envelope.attemptRef, planRef: envelope.planRef, workspaceSnapshot: envelope.workspaceSnapshot,
    sources: envelope.sourceRefs, budget: envelope.budget, permissions: envelope.permissions, roleBinding: envelope.roleBinding,
    task: { title: 'Standalone local runtime test', obligations: [] }, dependencies: [],
  });
  const stored = await vault.put({ body, contentType: 'application/json', sourceRefs: envelope.sourceRefs, ownerRef: envelope.runRef, requestedAt: new Date().toISOString() });
  if (stored.status !== 'stored') throw Error('Test bundle could not be stored');
  envelope.bundleRef = stored.ref;
  return { vault };
}
