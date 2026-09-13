import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { canonicalJson } from '../../contracts/fingerprint.js';
import type { SourceApplicabilityPort } from '../../contracts/material-access.js';

type Limits = { maxEntries: number; maxBytes: number; maxDepth: number };
const defaults: Limits = { maxEntries: 60000, maxBytes: 512 * 1024 * 1024, maxDepth: 128 };
const sameIdentity = (a: { dev: number; ino: number }, b: { dev: number; ino: number }) => a.dev === b.dev && a.ino === b.ino;
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }

/** Unlike code-change fingerprints, exploration covers all regular files without ignored directories. */
export async function explorationSourceDigest(root: string, limits: Limits = defaults): Promise<string> {
  ensure(Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0), '探索来源摘要资源上限无效');
  const hash = createHash('sha256').update('exploration-source-v1\n');
  let entries = 0, totalBytes = 0;
  async function walk(directory: FileHandle, prefix: string, depth: number): Promise<void> {
    ensure(depth <= limits.maxDepth, '探索来源目录深度超出摘要上限');
    const beforeDirectory = await directory.stat(), capability = '/proc/self/fd/' + directory.fd;
    ensure(beforeDirectory.isDirectory(), '探索来源必须是普通目录');
    for (const name of (await readdir(capability)).sort()) {
      ensure(++entries <= limits.maxEntries, '探索来源文件条目超出摘要上限');
      const relative = prefix ? prefix + '/' + name : name, child = capability + '/' + name, before = await lstat(child);
      if (before.isSymbolicLink()) {
        // The read tool rejects symlinks. Bind the link entry without following its target.
        const target = await readlink(child), after = await lstat(child);
        ensure(sameIdentity(before, after) && before.mtimeMs === after.mtimeMs && before.size === after.size, '探索来源链接在读取期间改变：' + relative);
        hash.update(canonicalJson([relative, 'symlink-unreadable', target])); continue;
      }
      ensure(before.isDirectory() || before.isFile(), '探索来源包含不支持的特殊文件：' + relative);
      const handle = await open(child, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (before.isDirectory() ? constants.O_DIRECTORY : 0));
      try {
        const opened = await handle.stat(); ensure(sameIdentity(before, opened) && before.isDirectory() === opened.isDirectory(), '探索来源条目在打开期间改变：' + relative);
        if (opened.isDirectory()) {
          hash.update(canonicalJson([relative, 'directory', opened.mode & 511]));
          await walk(handle, relative, depth + 1);
        } else {
          ensure(opened.isFile(), '探索来源条目不是普通文件：' + relative);
          ensure(totalBytes + opened.size <= limits.maxBytes, '探索来源内容超出摘要字节上限');
          const content = createHash('sha256'), buffer = Buffer.alloc(65536); let size = 0;
          for (;;) {
            const read = await handle.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break;
            totalBytes += read.bytesRead; size += read.bytesRead;
            ensure(totalBytes <= limits.maxBytes, '探索来源内容超出摘要字节上限'); content.update(buffer.subarray(0, read.bytesRead));
          }
          const after = await handle.stat();
          ensure(size === opened.size && opened.size === after.size && opened.mtimeMs === after.mtimeMs && opened.ctimeMs === after.ctimeMs, '探索来源文件在读取期间改变：' + relative);
          hash.update(canonicalJson([relative, 'file', opened.mode & 511, content.digest('hex')]));
        }
        const named = await lstat(child); ensure(sameIdentity(opened, named), '探索来源路径在读取期间改变：' + relative);
      } finally { await handle.close(); }
    }
    const afterDirectory = await directory.stat();
    ensure(beforeDirectory.mtimeMs === afterDirectory.mtimeMs && beforeDirectory.ctimeMs === afterDirectory.ctimeMs, '探索来源目录在读取期间改变：' + (prefix || '.'));
  }
  const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const original = await directory.stat(); await walk(directory, '', 0);
    const current = await lstat(root); ensure(current.isDirectory() && sameIdentity(original, current), '探索来源根目录在读取期间改变');
    return hash.digest('hex');
  } finally { await directory.close(); }
}

/** Host-bound source capability for the complete exploration tree. The stored
 * legacy digest keeps its original byte/entry semantics; every capture reads
 * the real tree twice and never trusts a digest supplied by the consumer. */
export class ExplorationSourceApplicability implements SourceApplicabilityPort {
  constructor(private readonly rootFor: (projectId: string, workspaceId: string) => string) {}
  async capture(query: Parameters<SourceApplicabilityPort['capture']>[0], signal?: AbortSignal): ReturnType<SourceApplicabilityPort['capture']> {
    if (query.sourceSet?.kind !== 'workspace_paths' || query.sourceSet.paths.length !== 1 || query.sourceSet.paths[0] !== '.') return { status: 'rejected', issues: ['exploration requires the complete workspace source set'] };
    try {
      signal?.throwIfAborted();
      const root = this.rootFor(query.projectId, query.workspaceId);
      const first = await explorationSourceDigest(root);
      signal?.throwIfAborted();
      const second = await explorationSourceDigest(root);
      signal?.throwIfAborted();
      if (first !== second) return { status: 'stale', issues: ['exploration source changed during capture'] };
      return { status: 'sourced', pin: { schemaVersion: 1, projectId: query.projectId, workspaceId: query.workspaceId,
        sourceSet: { kind: 'workspace_paths', paths: ['.'] }, identity: { workspace: 'exploration-source-v1:' + root, commit: null }, manifestDigest: first } };
    } catch { return { status: 'unavailable', issues: ['exploration source could not be read completely'] }; }
  }
}
