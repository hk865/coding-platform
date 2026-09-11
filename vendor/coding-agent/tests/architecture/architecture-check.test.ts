import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace } from "../helpers/test-helpers.js";
import type { TempWorkspace } from "../helpers/test-helpers.js";

const checkerPath = fileURLToPath(new URL("../../scripts/check-architecture.mjs", import.meta.url));
const workspaces: TempWorkspace[] = [];

async function workspace(): Promise<TempWorkspace> {
  const created = await createTempWorkspace("coding-agent-architecture-");
  workspaces.push(created);
  return created;
}

async function source(root: TempWorkspace, relativePath: string, contents: string) {
  const destination = root.resolve("src", relativePath);
  await mkdir(fileURLToPath(new URL(".", `file://${destination}`)), { recursive: true });
  await writeFile(destination, contents, "utf8");
}

function check(root: TempWorkspace) {
  return spawnSync(process.execPath, [checkerPath, "--root", root.root], {
    encoding: "utf8",
  });
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((item) => item.cleanup()));
});

describe("architecture checker", () => {
  it("允许 Adapter 只依赖自己实现的 Core Port", async () => {
    const root = await workspace();
    await source(
      root,
      "core/ports/model_client/model-client-port.ts",
      "export interface ModelClientPort {}\n",
    );
    await source(
      root,
      "model/providers/openai/client.ts",
      'import type { ModelClientPort } from "../../../core/ports/model_client/model-client-port.js";\nexport const client: ModelClientPort = {};\n',
    );

    const result = check(root);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("拒绝 Core 反向导入 Provider", async () => {
    const root = await workspace();
    await source(root, "model/providers/openai/client.ts", "export const client = {};\n");
    await source(
      root,
      "core/runtime/loop/runtime-runner.ts",
      'import { client } from "../../../model/providers/openai/client.js";\nexport { client };\n',
    );

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Core 禁止依赖外层模块");
  });

  it("拒绝内部循环依赖", async () => {
    const root = await workspace();
    await source(root, "core/runtime/loop/a.ts", 'import "./b.js";\n');
    await source(root, "core/runtime/loop/b.ts", 'import "./a.js";\n');

    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("检测到循环依赖");
  });
});
