import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';

/** Atomic file replacement only. Callers own serialization, ordering and their
 * recovery protocol; this helper never changes a domain record or replays work. */
export async function writeAtomicFile(path: string, content: string): Promise<void> {
  const temporary = path + '.' + randomUUID();
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
