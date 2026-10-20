/** Test-only temporary workspace helper.
 *
 * The legacy session-record writer that lived in this file (synthetic
 * identities, the historical JSON/checksum wire and raw SQLite inserts) was
 * removed by T2-009 after its last consumers moved to the real claim/Runtime
 * path. Only `createTempWorkspace` remains for the current-format Kernel tests.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TempWorkspace {
  readonly root: string;
  resolve(...segments: string[]): string;
  cleanup(): Promise<void>;
}

export async function createTempWorkspace(prefix = "coding-agent-test-"): Promise<TempWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  let cleaned = false;

  return {
    root,
    resolve: (...segments) => path.join(root, ...segments),
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}
