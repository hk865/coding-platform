import { createHash } from 'node:crypto';
import { readdir, readFile, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../contracts/fingerprint.js';
import type { CandidateWorkspaceSourcePort } from '../../contracts/verification-source.js';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const ignored = new Set(['.git', '.platform-runtime', 'node_modules', 'dist', 'coverage', 'test-results', '.cache']);
/** The existing candidate digest scope, shared by labelled source comparisons. */
export function candidateWorkspaceIncludesPath(path: string): boolean {
  return !path.split('/').some(part => ignored.has(part));
}
export type CandidateWorkspaceGitEntry = { path: string; mode: string; sha1: string; sha256: string };
function gitEntry(path: string, mode: string, body: Buffer): CandidateWorkspaceGitEntry {
  const header = 'blob ' + body.length + '\0';
  return { path, mode,
    sha1: createHash('sha1').update(header).update(body).digest('hex'),
    sha256: createHash('sha256').update(header).update(body).digest('hex'),
  };
}
function ensure(value: unknown, message: string): asserts value {
  if (!value)
    throw Error(message);
}
/** Hash actual contents, never invent a numeric Workspace revision from a hash. */
async function candidateWorkspaceSnapshot(root: string, includeGitEntries = false): Promise<{ digest: string; files: string[]; gitEntries: CandidateWorkspaceGitEntry[] }> {
  const hash = createHash('sha256');
  const files: string[] = [];
  const gitEntries: CandidateWorkspaceGitEntry[] = [];
  let count = 0,
    bytes = 0;
  async function walk(dir: string, prefix: string) {
    for (const name of (await readdir(dir)).sort()) {
      if (ignored.has(name))
        continue;
      const path = prefix ? prefix + '/' + name : name,
        absolute = join(dir, name),
        stat = await lstat(absolute);
      ensure(++count <= 60000, '工作区文件过多，无法冻结候选');
      if (stat.isSymbolicLink()) {
        files.push(path);
        const target = await readlink(absolute);
        hash.update(canonicalJson([path, 'link', target]));
        if (includeGitEntries) gitEntries.push(gitEntry(path, '120000', Buffer.from(target)));
      }
      else if (stat.isDirectory())
        await walk(absolute, path);
      else if (stat.isFile()) {
        files.push(path);
        bytes += stat.size;
        ensure(bytes <= 512 * 1024 * 1024, '工作区超出候选快照上限');
        const body = await readFile(absolute);
        hash.update(canonicalJson([path, stat.mode & 511, digest(body)]));
        if (includeGitEntries) gitEntries.push(gitEntry(path, stat.mode & 0o100 ? '100755' : '100644', body));
      }
      else
        throw Error('工作区包含不支持的特殊文件');
    }
  }
  ensure(!(await lstat(root)).isSymbolicLink(), '候选工作区不能是链接');
  await walk(root, '');
  return { digest: hash.digest('hex'), files, gitEntries };
}

/** WorkspaceReader owns the candidate-specific ignore, ordering and byte identity rules. */
export class CandidateWorkspaceReader implements CandidateWorkspaceSourcePort {
  async digest(root: string): Promise<string> {
    return (await candidateWorkspaceSnapshot(root)).digest;
  }
  /** Same traversal/hash rules with its observed path inventory; not a diff. */
  snapshot(root: string): Promise<{ digest: string; files: string[]; gitEntries: CandidateWorkspaceGitEntry[] }> {
    return candidateWorkspaceSnapshot(root, true);
  }
}
