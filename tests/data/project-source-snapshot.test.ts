import { expect, it } from 'vitest';
import type { ProjectSourceAccess } from '../../src/core/workspace/project-source-index.js';
import { captureProjectSource } from '../../src/core/workspace/project-source-snapshot.js';

const signal = () => new AbortController().signal;

function memorySource(initial: Record<string, string> = { 'src/value.ts': 'export const value = 1;' }) {
  const files = new Map(Object.entries(initial));
  const denied = new Set<string>();
  const reads: string[] = [];
  let commit = 'a'.repeat(40);
  const access: ProjectSourceAccess = {
    allowed: path => !denied.has(path),
    inventory: async () => ({ paths: [...files.keys()], truncated: false }),
    sourceIdentity: async () => ({ workspace: 'snapshot-tests', commit }),
    read: async path => {
      reads.push(path);
      const content = files.get(path);
      if (content === undefined || denied.has(path)) throw Error('source unavailable');
      return { content };
    },
  };
  return { access, files, denied, reads, setCommit: (next: string) => { commit = next; } };
}

it('captures only readable project inputs and keeps an earlier capture unchanged', async () => {
  const project = memorySource({
    'src/value.ts': 'export const value = 1;',
    'tsconfig.json': '{"include":["src/**/*.ts"]}',
    'private/secret.ts': 'export const secret = "private";',
    '.git/internal.ts': 'export const internal = true;',
    '../outside.ts': 'export const outside = true;',
    'notes.md': 'not a source input',
  });
  project.denied.add('private/secret.ts');
  const before = await captureProjectSource(project.access, signal());
  expect([...before.files.keys()]).toEqual(['/workspace/src/value.ts', '/workspace/tsconfig.json']);
  expect(project.reads).toEqual(['src/value.ts', 'tsconfig.json']);
  expect(before.identity).toEqual({ workspace: 'snapshot-tests', commit: 'a'.repeat(40) });

  project.files.set('src/value.ts', 'export const value = 2;');
  project.files.set('src/added.ts', 'export const added = true;');
  const after = await captureProjectSource(project.access, signal());
  expect(after.snapshot).not.toBe(before.snapshot);
  expect(before.files.get('/workspace/src/value.ts')?.content).toBe('export const value = 1;');
  expect(before.files.has('/workspace/src/added.ts')).toBe(false);
  expect(after.files.get('/workspace/src/value.ts')?.digest).not.toBe(before.files.get('/workspace/src/value.ts')?.digest);
});

it('uses a stable manifest identity and detects HEAD, inventory, contents, and permission changes', async () => {
  const project = memorySource({ 'src/a.ts': 'export const a = 1;', 'src/b.ts': 'export const b = 2;' });
  const original = await captureProjectSource(project.access, signal());
  project.access.inventory = async () => ({ paths: ['src/b.ts', 'src/a.ts', 'src/a.ts'], truncated: false });
  expect((await captureProjectSource(project.access, signal())).snapshot).toBe(original.snapshot);

  project.setCommit('b'.repeat(40));
  expect((await captureProjectSource(project.access, signal())).snapshot).not.toBe(original.snapshot);
  project.setCommit('a'.repeat(40));
  project.files.set('src/a.ts', 'export const a = 3;');
  expect((await captureProjectSource(project.access, signal())).snapshot).not.toBe(original.snapshot);
  project.files.set('src/a.ts', 'export const a = 1;');
  project.access.inventory = async () => ({ paths: ['src/a.ts'], truncated: false });
  expect((await captureProjectSource(project.access, signal())).snapshot).not.toBe(original.snapshot);
  project.access.inventory = async () => ({ paths: [...project.files.keys()], truncated: false });
  project.denied.add('src/b.ts');
  const restricted = await captureProjectSource(project.access, signal());
  expect(restricted.snapshot).not.toBe(original.snapshot);
  expect(restricted.files.has('/workspace/src/b.ts')).toBe(false);
  project.denied.clear();
  expect((await captureProjectSource(project.access, signal())).snapshot).toBe(original.snapshot);
});

it.each(['incomplete_inventory', 'binary_source', 'read_failure'] as const)(
  'rejects %s instead of publishing a partial capture', async failure => {
    const project = memorySource();
    if (failure === 'incomplete_inventory') project.access.inventory = async () => ({ paths: ['src/value.ts'], truncated: true });
    if (failure === 'binary_source') project.files.set('src/value.ts', 'export const value = "\0";');
    if (failure === 'read_failure') project.access.read = async () => { throw Error('read denied'); };
    await expect(captureProjectSource(project.access, signal())).rejects.toThrow();
    if (failure === 'incomplete_inventory') expect(project.reads).toEqual([]);
  },
);

it('does not publish a capture cancelled before entry or during its final file read', async () => {
  const project = memorySource();
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(captureProjectSource(project.access, cancelled.signal)).rejects.toThrow();

  const interrupted = new AbortController();
  const read = project.access.read;
  project.access.read = async (path, maxBytes) => {
    const result = await read(path, maxBytes);
    interrupted.abort();
    return result;
  };
  await expect(captureProjectSource(project.access, interrupted.signal)).rejects.toThrow();
  project.access.read = read;
  const recovered = await captureProjectSource(project.access, signal());
  expect(recovered.files.get('/workspace/src/value.ts')?.content).toBe('export const value = 1;');
});

it('owns its identity even when the host reuses a mutable identity record', async () => {
  const project = memorySource();
  const identity = { workspace: 'shared-host-record', commit: 'a'.repeat(40) };
  project.access.sourceIdentity = async () => identity;
  const first = await captureProjectSource(project.access, signal());
  identity.commit = 'b'.repeat(40);
  const second = await captureProjectSource(project.access, signal());
  expect(first.identity.commit).toBe('a'.repeat(40));
  expect(second.identity.commit).toBe('b'.repeat(40));
  expect(second.snapshot).not.toBe(first.snapshot);
});
