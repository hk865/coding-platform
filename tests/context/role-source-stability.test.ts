import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { WorkspaceSourceIndexReader } from '../../src/data/workspace-reader/role-source-reader.js';
import { selectCodeMaterial } from '../../src/data/context-compiler/role-source-index.js';
import type { RoleSourceIndexRequestV1 } from '../../src/contracts/role-material-channels.js';

const request: RoleSourceIndexRequestV1 = {
  schemaVersion: 1, projectId: 'p', workspaceId: 'w', declaredTools: ['read'],
  workspaceRevision: 1, maxEntries: 10, maxExcerptFiles: 2, maxExcerptBytes: 1024, pathPrefix: 'src',
};
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'role-source-stability-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/a.ts'), 'export const a = 1;');
  return { root, reader: new WorkspaceSourceIndexReader({ rootFor: () => root }) };
}
describe('bounded role source stability', () => {
  it('returns the same bounded content when the source is stable', async () => {
    const { reader } = await fixture();
    const result = await reader.readSourceIndex(request);
    expect(result.status).toBe('sourced');
    if (result.status === 'sourced') expect(result.excerpts.map(item => item.content)).toEqual(['export const a = 1;']);
  });
  it.each(['change', 'delete'] as const)('rejects a selected file that changes after its first read: %s', async action => {
    const { root, reader } = await fixture();
    const original = WorkspaceSandbox.prototype.read;
    let first = true;
    vi.spyOn(WorkspaceSandbox.prototype, 'read').mockImplementation(async function (this: WorkspaceSandbox, ...args) {
      const value = await original.apply(this, args);
      if (first) {
        first = false;
        if (action === 'change') await writeFile(join(root, 'src/a.ts'), 'export const a = 2;');
        else await rm(join(root, 'src/a.ts'));
      }
      return value;
    });
    expect(await reader.readSourceIndex(request)).toMatchObject({ status: 'unavailable', message: expect.stringContaining('stale') });
  });
  it('rejects a changed inventory even when no excerpts were requested', async () => {
    const { root, reader } = await fixture();
    const original = WorkspaceSandbox.prototype.listFiles;
    let first = true;
    vi.spyOn(WorkspaceSandbox.prototype, 'listFiles').mockImplementation(async function (this: WorkspaceSandbox, ...args) {
      const value = await original.apply(this, args);
      if (first) { first = false; await writeFile(join(root, 'src/b.ts'), 'export const b = 2;'); }
      return value;
    });
    expect(await reader.readSourceIndex({ ...request, maxExcerptFiles: 0 })).toMatchObject({ status: 'unavailable', message: expect.stringContaining('stale') });
  });
  it('checks canonical revision again after source I/O', async () => {
    let revision = 1;
    const result = await selectCodeMaterial({
      ledger: { load: async ref => ({ status: 'found', snapshot: { ref, revision } } as never) },
      sourceIndex: { readSourceIndex: async () => {
        revision = 2;
        return { status: 'sourced', provenance: { workspace: 'w' }, entries: [{ path: 'src/a.ts' }], entryCount: 1, truncated: false, excerpts: [], excerptNotes: [] };
      } },
    }, {
      scope: { projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 't', runId: 'r' },
      planRef: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan' },
      workspaceSnapshot: { workspaceId: 'w', revision: 1 },
      permissions: { tools: ['read'], writeScope: [], policyRevision: '1' },
    } as Parameters<typeof selectCodeMaterial>[1], null);
    expect(result).toMatchObject({ status: 'unavailable', message: expect.stringContaining('stale') });
  });
});
