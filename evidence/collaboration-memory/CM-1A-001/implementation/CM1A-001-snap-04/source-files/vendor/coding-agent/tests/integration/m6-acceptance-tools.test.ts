import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error Benchmark harness 以原生 ESM JavaScript 运行，没有单独发布类型声明。
import { currentRevision, emptyMetrics } from "../../benchmarks/harness/benchmark-harness.mjs";
// @ts-expect-error Provider smoke 是只在验收时执行的原生 ESM CLI。
import * as providerSmoke from "../../benchmarks/harness/provider-smoke.mjs";
// @ts-expect-error Real baseline harness 以原生 ESM JavaScript 运行。
import { resolveBubblewrapPath } from "../../benchmarks/harness/real-baseline.mjs";
// @ts-expect-error Benchmark evidence schema 以原生 ESM JavaScript 运行。
import { providerSmokeRunSchema } from "../../benchmarks/schemas/provider-smoke-schema.mjs";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
const { evaluateProviderSmokeScenario, runProviderSmoke } = providerSmoke;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("M6 acceptance tools", () => {
  it("benchmark metrics 对墙钟回拨产生的负耗时 fail safe", () => {
    expect(emptyMetrics(-1).wallClockMs).toBe(0);
    expect(emptyMetrics(12.6).wallClockMs).toBe(13);
  });

  it("真实 baseline 只接受干净且可追溯的 Git commit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "m6-clean-revision-"));
    temporaryRoots.push(root);
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "m6@example.invalid"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "M6 Test"], { cwd: root });
    await writeFile(path.join(root, "README.md"), "clean\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root });

    await expect(currentRevision(root)).resolves.toMatch(/^[a-f0-9]{40}$/);
    await writeFile(path.join(root, "untracked.txt"), "dirty\n");
    await expect(currentRevision(root)).resolves.toBe("uncommitted");
  });

  it("真实 baseline 复用生产支持的绝对 CODING_AGENT_BWRAP_PATH", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "m6-bwrap-path-"));
    temporaryRoots.push(root);
    const executable = path.join(root, "bwrap");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);

    await expect(resolveBubblewrapPath({ CODING_AGENT_BWRAP_PATH: executable })).resolves.toBe(
      executable,
    );
    await expect(
      resolveBubblewrapPath({ CODING_AGENT_BWRAP_PATH: "relative/bwrap" }),
    ).resolves.toBeNull();
  });

  it("Provider smoke 同时验证纯文本与固定 ToolCall，证据不保存正文或参数", () => {
    const text = evaluateProviderSmokeScenario("text", [
      {
        schemaVersion: 1,
        requestId: "text-request",
        sequence: 1,
        type: "text_delta",
        delta: "private response",
      },
      {
        schemaVersion: 1,
        requestId: "text-request",
        sequence: 2,
        type: "usage_snapshot",
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          cachedInputTokens: 0,
          costUsdMicros: null,
        },
      },
      {
        schemaVersion: 1,
        requestId: "text-request",
        sequence: 3,
        type: "completed",
        reason: "final_answer",
      },
    ]);
    const tool = evaluateProviderSmokeScenario("tool_call", [
      {
        schemaVersion: 1,
        requestId: "tool-request",
        sequence: 1,
        type: "tool_call_started",
        callId: "call-1",
        name: "record_smoke_result",
        ordinal: 0,
      },
      {
        schemaVersion: 1,
        requestId: "tool-request",
        sequence: 2,
        type: "tool_arguments_delta",
        callId: "call-1",
        delta: '{"value":',
      },
      {
        schemaVersion: 1,
        requestId: "tool-request",
        sequence: 3,
        type: "tool_arguments_delta",
        callId: "call-1",
        delta: '"SMOKE_OK"}',
      },
      {
        schemaVersion: 1,
        requestId: "tool-request",
        sequence: 4,
        type: "completed",
        reason: "tool_calls",
      },
    ]);

    expect(text).toMatchObject({
      terminalReason: "final_answer",
      textDeltaCount: 1,
      toolCalls: [],
    });
    expect(tool).toMatchObject({
      terminalReason: "tool_calls",
      textDeltaCount: 0,
      toolCalls: [{ name: "record_smoke_result" }],
    });
    const evidence = JSON.stringify({ text, tool });
    expect(evidence).not.toContain("private response");
    expect(evidence).not.toContain("SMOKE_OK");
    expect(evidence).toContain("sha256:");

    expect(
      providerSmokeRunSchema.safeParse({
        schemaVersion: 1,
        runId: "provider-smoke-fixture",
        status: "passed",
        provider: "openai",
        model: "fixture-model",
        endpointOrigin: "https://api.openai.com",
        credentialSource: "OPENAI_API_KEY",
        providerOptions: {},
        revision: "a".repeat(40),
        promptVersion: "m6-provider-smoke-v1",
        maxOutputTokens: 64,
        timeoutMs: 60_000,
        startedAt: "2026-08-27T00:00:00.000Z",
        endedAt: "2026-08-27T00:00:02.000Z",
        environment: { platform: "linux-x64", node: "v24.18.0" },
        results: [
          {
            scenario: "text",
            status: "passed",
            startedAt: "2026-08-27T00:00:00.000Z",
            endedAt: "2026-08-27T00:00:01.000Z",
            latencyMs: 1_000,
            ...text,
          },
          {
            scenario: "tool_call",
            status: "passed",
            startedAt: "2026-08-27T00:00:01.000Z",
            endedAt: "2026-08-27T00:00:02.000Z",
            latencyMs: 1_000,
            ...tool,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("Provider smoke 缺少环境凭据时 fail closed，且不会发起网络请求", async () => {
    const output = await mkdtemp(path.join(tmpdir(), "m6-provider-smoke-"));
    temporaryRoots.push(output);
    await expect(
      runProviderSmoke({
        projectRoot: path.resolve("."),
        provider: "openai",
        model: "fixture-model",
        timeoutMs: 60_000,
        runId: "missing-credential",
        outputRoot: output,
        environment: {},
        revision: "a".repeat(40),
      }),
    ).rejects.toThrow("缺少 OPENAI_API_KEY，未发起网络请求");
  });
});
