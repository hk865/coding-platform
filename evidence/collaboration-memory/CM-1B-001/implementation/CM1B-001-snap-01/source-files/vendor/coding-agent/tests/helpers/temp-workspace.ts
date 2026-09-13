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
