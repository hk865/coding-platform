/**
 * DSEC2 P4 (Kernel module contract): `listFiles` skips entries that share a denied prefix's inode.
 *
 * Today `visit` compares the relative name exactly, so the hard link `.ENV` to the denied `.env`
 * is listed (P4-1) and `.WORKBENCH/local` is walked through the case-variant bind mount (P4-2);
 * both are red. They turn green once the managed `workspace-sandbox.ts` patch records `dev:ino`
 * identities for the denied prefixes, skips matching entries, and `build-kernel-patch --write`
 * regenerates the dist.
 */
import { spawnSync } from "node:child_process";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceSandbox } from "../../vendor/coding-agent/dist/public-api.js";
import { tempRoot } from "../helpers/observation-source-fixture.js";

const PUBLIC_API = fileURLToPath(new URL("../../vendor/coding-agent/dist/public-api.js", import.meta.url));
const BWRAP = process.env["CODING_AGENT_BWRAP_PATH"] ?? "/usr/bin/bwrap";
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("DSEC2 P4 listFiles denied-prefix aliases", () => {
  it("P4-1 skips a hard link to a denied prefix", async () => {
    const root = await tempRoot("dsec2-list-alias-", tempRoots);
    await writeFile(path.join(root, ".env"), "SECRET=1\n");
    await link(path.join(root, ".env"), path.join(root, ".ENV"));
    await writeFile(path.join(root, "README.md"), "readme\n");
    const workspace = await WorkspaceSandbox.create(root, { deniedPrefixes: [".env"] });
    expect(await workspace.listFiles(10)).toEqual({ paths: ["README.md"], truncated: false });
  });

  it("P4-2 skips denied entries reached through a case-variant bind mount", async () => {
    const root = await tempRoot("dsec2-list-alias-", tempRoots);
    await mkdir(path.join(root, ".workbench/local"), { recursive: true });
    await writeFile(path.join(root, ".workbench/local/secret"), "secret\n");
    await writeFile(path.join(root, "README.md"), "readme\n");
    const child = path.join(await tempRoot("dsec2-list-alias-", tempRoots), "list-alias.mjs");
    await writeFile(child, [
      `import { WorkspaceSandbox } from ${JSON.stringify(PUBLIC_API)};`,
      "const root = process.argv[2];",
      'const workspace = await WorkspaceSandbox.create(root, { deniedPrefixes: [".workbench/local"] });',
      'console.log(JSON.stringify(await workspace.listFiles(10, { prefix: ".WORKBENCH" })));',
      "",
    ].join("\n"));
    const result = spawnSync(BWRAP, [
      "--dev-bind", "/", "/",
      "--bind", root, root,
      "--bind", path.join(root, ".workbench"), path.join(root, ".WORKBENCH"),
      "--chdir", root, process.execPath, child, root,
    ], { encoding: "utf8" });
    if (result.error !== undefined) {
      throw new Error(`bwrap environment failure at ${BWRAP} (CODING_AGENT_BWRAP_PATH): ${result.error.message}`);
    }
    expect(result.status, `bwrap child failed: ${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ paths: [], truncated: false });
  });
});
