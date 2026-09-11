import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectSourceAccess } from '../../src/data/workspace-reader/project-source-index.js';
import { readSourceIdentity } from '../../src/data/workspace-reader/source-identity.js';

/** Real filesystem inventory/read adapter, matching the public source-access seam. */
export function filesystemSourceAccess(root: string): ProjectSourceAccess {
  return {
    allowed: path => !path.split('/').some(part => part.startsWith('.')),
    read: async (path, maxBytes) => { const content = await readFile(join(root, path), 'utf8'); if (Buffer.byteLength(content) > maxBytes) throw Error('file too large'); return { content }; },
    inventory: async () => ({ paths: (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile() && !entry.parentPath.split(/[\\/]/).includes('.git')).map(entry => join(entry.parentPath, entry.name).slice(root.length + 1).replaceAll('\\', '/')), truncated: false }),
    sourceIdentity: () => readSourceIdentity(root, root),
  };
}
