/**
 * Slice 8D rework spec §11.5 item 7: every exception caught and recorded at the
 * capture boundary reads `<type>: <first 200 characters>`; it is never just the
 * bare message, and the 200-character cut applies to the message part.
 */
import { expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceAccessFactory, WorkspaceReadAccess } from '../../src/core/workspace/access.js';
import { CaptureRegistry } from '../../src/core/workspace/capture.js';
import { DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 's8d-capture-error', workspaceId: 'main' };
const files = new Map([['src/lib.rs', 'pub fn lib() {}\n']]);

function access(): WorkspaceReadAccess {
  return {
    workspace, workspaceRevision: 1, workspaceIdentity: 's8d-capture-error-root',
    authorization: { subjectKey: 'host:s8d-capture-error', permissionRevision: 'p1', allowsRead: path => files.has(path) },
    listFiles: async () => ({ paths: [...files.keys()], truncated: false }),
    read: async path => {
      const content = files.get(path);
      if (content === undefined) throw Error('path outside readable scope');
      return { content, revision: 'r1', byteLength: Buffer.byteLength(content) };
    },
    sourceIdentity: async () => ({ workspace: 's8d-capture-error', commit: null }),
    release: async () => {},
  };
}

const actor = { kind: 'system' as const, id: 's8d-capture-error-reader' };
const context: CoreCallContext = {
  projectId: workspace.projectId, workspaceId: workspace.workspaceId,
  principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
  signal: new AbortController().signal,
};

it('S8D-CAPTURE-ERR-01 records an exception as its type plus the first 200 message characters', async () => {
  const registry = new CaptureRegistry({
    access: { open: async (): ReturnType<WorkspaceAccessFactory['open']> => ({ status: 'ready', value: access() }) },
    now: () => '2026-10-17T00:00:00.000Z',
    limits: DEFAULT_WORKSPACE_LIMITS,
    providers: [{
      language: 'rust',
      claims: path => path.endsWith('.rs'),
      extractImports: async () => { throw new TypeError('e'.repeat(250)); },
    }],
  });
  try {
    const captured = await registry.captureObservation(context, { workspace, workspaceRevision: 1, provider: 'typescript' });
    expect(captured.status).toBe('ready');
    if (captured.status !== 'ready') return;
    const graph = await registry.captureFileGraph(context, { capture: captured.value.ref });
    expect(graph.status).toBe('ready');
    if (graph.status !== 'ready') return;
    expect(graph.value.languages).toEqual([
      { language: 'rust', files: 1, parsed: 0, edges: 'failed',
        reason: 'TypeError: ' + 'e'.repeat(200), notes: [], issues: [], issueCount: 0, complete: false },
    ]);
  } finally {
    await registry.close();
  }
});
