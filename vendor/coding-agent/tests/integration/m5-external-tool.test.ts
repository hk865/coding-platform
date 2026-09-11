import { z } from "zod";
import { describe, expect, it } from "vitest";

import { ToolRegistry } from "../../src/tools/registry/tool-registry.js";

describe("M5 external Tool boundary", () => {
  it("external_echo 只通过 Registry 接入，不修改 Runtime", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "external_echo",
      description: "M5 test-only external tool",
      inputSchema: z.object({ text: z.string() }).strict(),
      effectClass: "read_only",
      requiredCapabilities: [],
      defaultTimeoutMs: 1_000,
      outputLimitBytes: 1_024,
      independentReadOnly: true,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call) {
          return {
            schemaVersion: 1,
            callId: call.callId,
            status: "success",
            output: [{ kind: "text", text: String(call.arguments["text"] ?? "") }],
            effects: {
              sideEffect: "none",
              changedPaths: [],
              workspaceRevision: null,
              artifactRefs: [],
            },
          };
        },
      },
    });
    const snapshot = registry.freeze(["external_echo"]);
    expect(snapshot.modelToolSpecs().map((tool) => tool.name)).toEqual(["external_echo"]);
    const definition = snapshot.resolve("external_echo");
    expect(
      await definition?.handler.execute(
        {
          schemaVersion: 1,
          callId: "external-call",
          name: "external_echo",
          arguments: { text: "echo-ok" },
        },
        { signal: new AbortController().signal },
      ),
    ).toMatchObject({ status: "success", output: [{ kind: "text", text: "echo-ok" }] });
  });

  it("模型工具 schema 使用跨 Provider 的保守子集，运行时仍由原 Zod schema 严格校验", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "schema_probe",
      description: "schema compatibility probe",
      inputSchema: z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("create"), text: z.string().min(2) }).strict(),
        z.object({ mode: z.literal("delete"), force: z.boolean() }).strict(),
      ]),
      effectClass: "workspace_write",
      requiredCapabilities: ["workspace_write"],
      defaultTimeoutMs: 1_000,
      outputLimitBytes: 1_024,
      independentReadOnly: false,
      handler: {
        async execute(call) {
          return {
            schemaVersion: 1,
            callId: call.callId,
            status: "success",
            output: [],
            effects: {
              sideEffect: "none",
              changedPaths: [],
              workspaceRevision: null,
              artifactRefs: [],
            },
          };
        },
      },
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    });

    const snapshot = registry.freeze(["schema_probe"]);
    const [spec] = snapshot.modelToolSpecs();
    const encoded = JSON.stringify(spec?.inputSchema);
    expect(spec?.inputSchema).toMatchObject({
      type: "object",
      properties: { mode: { type: "string", enum: ["create", "delete"] } },
      required: ["mode"],
      additionalProperties: false,
    });
    expect(encoded).toContain('"enum"');
    expect(encoded).not.toContain('"$schema"');
    expect(encoded).not.toContain('"oneOf"');
    expect(encoded).not.toContain('"const"');
    expect(encoded).not.toContain('"minLength"');
    expect(
      snapshot.resolve("schema_probe")?.inputSchema.safeParse({ mode: "create" }).success,
    ).toBe(false);
  });
});
