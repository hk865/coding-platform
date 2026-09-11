import { mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { EmptyMemoryProvider } from "../../src/memory/providers/empty/empty-memory-provider.js";
import { FileSkillLoader } from "../../src/skills/loader/file-skill-loader.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
});

describe("M5 Skill/Memory extensions", () => {
  it("从固定资源格式加载并按显式 ID 稳定选择 Skill", async () => {
    const root = await createTempWorkspace("m5-skills-");
    workspaces.push(root);
    for (const id of ["z-reference", "a-instruction"]) {
      await mkdir(root.resolve(id));
      await writeFile(
        root.resolve(id, "skill.json"),
        JSON.stringify({
          schemaVersion: 1,
          id,
          title: id,
          kind: id.endsWith("reference") ? "reference" : "instruction",
          priority: 10,
          contentFile: "content.md",
        }),
        "utf8",
      );
      await writeFile(root.resolve(id, "content.md"), `content for ${id}`, "utf8");
    }
    const registry = await (
      await FileSkillLoader.create(root.root)
    ).load(new AbortController().signal);
    const selected = await registry.select(
      { schemaVersion: 1, requestedIds: ["z-reference", "a-instruction"] },
      { signal: new AbortController().signal },
    );
    expect(selected.map((skill) => skill.id)).toEqual(["a-instruction", "z-reference"]);
    expect(selected[0]?.source).toMatch(/^skill:a-instruction@sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(selected)).not.toContain(root.root);
  });

  it("EmptyMemoryProvider 无状态并显式忽略 write", async () => {
    const provider = new EmptyMemoryProvider();
    const signal = new AbortController().signal;
    const request = {
      schemaVersion: 1 as const,
      query: "typescript",
      workspaceIdentity: "workspace-1",
      limit: 10,
    };
    expect(await provider.recall(request, { signal })).toEqual([]);
    expect(await provider.recall(request, { signal })).toEqual([]);
    expect(
      await provider.write(
        {
          schemaVersion: 1,
          workspaceIdentity: "workspace-1",
          item: {
            schemaVersion: 1,
            id: "memory-1",
            content: "data",
            priority: 1,
            source: "test",
            createdAt: "2026-08-26T00:00:00.000Z",
          },
        },
        { signal },
      ),
    ).toEqual({ status: "ignored", reason: "provider_disabled" });
  });
});
