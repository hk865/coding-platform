#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  createBuiltinProviderRegistry,
  validateModelEventSequence,
} from "../../dist/public-api.js";
import { providerSmokeRunSchema } from "../schemas/provider-smoke-schema.mjs";
import { currentRevision } from "./benchmark-harness.mjs";

const PROMPT_VERSION = "m6-provider-smoke-v1";
const MAX_OUTPUT_TOKENS = 64;
const EXPECTED_TOOL_NAME = "record_smoke_result";
const EXPECTED_VALUE = "SMOKE_OK";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少值`);
  return value;
}

function requiredOption(args, name) {
  const value = option(args, name, "");
  if (!value) throw new Error(`${name} 缺少值`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数`);
  return parsed;
}

function safeRunId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error("--run-id 只能包含字母、数字、点、下划线和连字符");
  }
  return value;
}

function requestFor(scenario, requestId, runId) {
  const common = {
    schemaVersion: 1,
    requestId,
    runId,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
  if (scenario === "text") {
    return {
      ...common,
      systemPrompt:
        "You are a low-cost provider connectivity probe. Follow the user instruction exactly.",
      messages: [
        {
          role: "user",
          messageId: `message-${requestId}`,
          content: "Return a short non-empty plain-text response. Do not call a tool.",
        },
      ],
      tools: [],
    };
  }
  return {
    ...common,
    systemPrompt:
      "You are a low-cost function-call probe. Call the supplied function exactly once and do not execute anything.",
    messages: [
      {
        role: "user",
        messageId: `message-${requestId}`,
        content: `Call ${EXPECTED_TOOL_NAME} with value ${EXPECTED_VALUE}. Do not answer in text.`,
      },
    ],
    tools: [
      {
        name: EXPECTED_TOOL_NAME,
        description: "Records a fixed smoke-test marker. The function will not be executed.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string", description: "The fixed smoke marker." } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    ],
  };
}

function completedTerminal(events) {
  const terminal = events.at(-1);
  if (!terminal || terminal.type !== "completed") {
    throw new Error("Provider smoke 没有产生 completed 终止事件");
  }
  return terminal;
}

export function evaluateProviderSmokeScenario(scenario, events) {
  const validation = validateModelEventSequence(events);
  if (!validation.ok) {
    throw new Error(`Provider smoke 流协议失败：${validation.violation.code}`);
  }
  const terminal = completedTerminal(events);
  const text = events
    .filter((event) => event.type === "text_delta")
    .map((event) => event.delta)
    .join("");
  const calls = new Map();
  for (const event of events) {
    if (event.type === "tool_call_started") {
      calls.set(event.callId, { name: event.name, argumentsJson: "" });
    } else if (event.type === "tool_arguments_delta") {
      const call = calls.get(event.callId);
      if (!call) throw new Error("Provider smoke ToolCall 参数缺少开始事件");
      call.argumentsJson += event.delta;
    }
  }

  if (scenario === "text") {
    if (terminal.reason !== "final_answer" || text.trim().length === 0 || calls.size !== 0) {
      throw new Error("Provider text smoke 未产生纯文本 final_answer");
    }
  } else {
    if (terminal.reason !== "tool_calls" || calls.size !== 1) {
      throw new Error("Provider ToolCall smoke 必须恰好产生一个函数调用");
    }
    const call = [...calls.values()][0];
    if (call.name !== EXPECTED_TOOL_NAME) {
      throw new Error("Provider ToolCall smoke 返回了非预期函数");
    }
    let argumentsValue;
    try {
      argumentsValue = JSON.parse(call.argumentsJson);
    } catch {
      throw new Error("Provider ToolCall smoke 参数不是完整 JSON");
    }
    if (
      !argumentsValue ||
      typeof argumentsValue !== "object" ||
      Array.isArray(argumentsValue) ||
      Object.keys(argumentsValue).length !== 1 ||
      argumentsValue.value !== EXPECTED_VALUE
    ) {
      throw new Error("Provider ToolCall smoke 参数与固定标记不一致");
    }
  }

  const usage = events.findLast((event) => event.type === "usage_snapshot")?.usage ?? null;
  return {
    eventCount: events.length,
    eventTypes: events.map((event) => event.type),
    textDeltaCount: events.filter((event) => event.type === "text_delta").length,
    textDigest: text.length > 0 ? digest(text) : null,
    toolCalls: [...calls.values()].map((call) => ({
      name: call.name,
      argumentsDigest: digest(call.argumentsJson),
    })),
    usage,
    terminalReason: terminal.reason,
  };
}

async function runScenario(client, scenario, options) {
  const started = options.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  timer.unref?.();
  const events = [];
  try {
    for await (const event of client.stream(
      requestFor(scenario, `smoke-${scenario}-${randomUUID()}`, `provider-smoke-${options.runId}`),
      { signal: controller.signal },
    )) {
      events.push(event);
    }
  } catch {
    if (controller.signal.aborted) throw new Error(`Provider ${scenario} smoke 超时`);
    throw new Error(`Provider ${scenario} smoke 网络流失败`);
  } finally {
    clearTimeout(timer);
  }
  const ended = options.now();
  return {
    scenario,
    status: "passed",
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    latencyMs: Math.max(0, ended.getTime() - started.getTime()),
    ...evaluateProviderSmokeScenario(scenario, events),
  };
}

export async function runProviderSmoke(options) {
  const registry = options.registry ?? createBuiltinProviderRegistry();
  const definition = registry.get(options.provider);
  const apiKey = options.environment[definition.secretEnvironmentVariable];
  if (!apiKey?.trim()) {
    throw new Error(`缺少 ${definition.secretEnvironmentVariable}，未发起网络请求`);
  }
  const revision = options.revision ?? (await currentRevision(options.projectRoot));
  if (revision === "uncommitted") {
    throw new Error("Provider smoke 要求工作区干净且 Agent commit 可追溯");
  }
  const runId = safeRunId(options.runId);
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const providerOptions = definition.id === "deepseek" ? { thinking: "disabled" } : {};
  const client = registry.create(definition.id, {
    apiKey,
    model: options.model,
    options: providerOptions,
  });
  const scenarioOptions = { now, runId, timeoutMs: options.timeoutMs };
  const results = [
    await runScenario(client, "text", scenarioOptions),
    await runScenario(client, "tool_call", scenarioOptions),
  ];
  const report = providerSmokeRunSchema.parse({
    schemaVersion: 1,
    runId,
    status: "passed",
    provider: definition.id,
    model: options.model,
    endpointOrigin: new URL(definition.defaultBaseUrl).origin,
    credentialSource: definition.secretEnvironmentVariable,
    providerOptions,
    revision,
    promptVersion: PROMPT_VERSION,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: options.timeoutMs,
    startedAt,
    endedAt: now().toISOString(),
    environment: {
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
    },
    results,
  });
  const outputRoot = path.resolve(options.outputRoot, runId);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, "summary.json"), JSON.stringify(report, null, 2) + "\n");
  return { outputRoot, report };
}

export async function main(args) {
  const projectRoot = path.resolve(option(args, "--project", path.resolve(".")));
  const provider = requiredOption(args, "--provider");
  const model = requiredOption(args, "--model");
  const timeoutMs = positiveInteger(option(args, "--timeout-ms", "60000"), "--timeout-ms");
  if (timeoutMs > 120_000) throw new Error("--timeout-ms 不能超过 120000");
  const runId = safeRunId(
    option(
      args,
      "--run-id",
      `provider-smoke-${provider}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
    ),
  );
  const result = await runProviderSmoke({
    projectRoot,
    provider,
    model,
    timeoutMs,
    runId,
    outputRoot: path.resolve(
      option(args, "--output", path.join(projectRoot, "benchmarks/results")),
    ),
    environment: process.env,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outputRoot: result.outputRoot,
        runId: result.report.runId,
        provider: result.report.provider,
        model: result.report.model,
        status: result.report.status,
        scenarios: result.report.results.map((scenario) => ({
          scenario: scenario.scenario,
          status: scenario.status,
          eventTypes: scenario.eventTypes,
          usage: scenario.usage,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

const direct =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Provider smoke failed"}\n`);
    process.exitCode = 1;
  }
}
