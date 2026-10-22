/**
 * PC-1a ruling 2: the optional Host context inputs of the public entry.
 *
 * Every expectation below is a hand-written literal. Runs start at the public
 * `runCodingAgent`; the provided case also goes through the frozen
 * `PC-kernel-fixture`. No database is read and no fact is written by hand.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appConfigSchema,
  ProviderRegistry,
  resumeCodingAgent,
  runCodingAgent,
  type BeforeModelHookPort,
  type ModelRequest,
  type RunAppInput,
  type RunState,
  type ToolDefinition,
} from "../../vendor/coding-agent/dist/public-api.js";
import {
  createKernelHarness,
  fixtureTool,
  ScriptedProvider,
  type ScriptedStep,
} from "../helpers/PC-kernel-fixture.js";
import { successResult } from "../helpers/orchestration-fixture.js";
import { openTempKernelStore, type TempKernelStore } from "../helpers/K-session-support.js";
import { sha256Hex } from "../../src/contracts/fingerprint.js";

type Skill = {
  schemaVersion: 1;
  id: string;
  title: string;
  content: string;
  kind: "instruction" | "reference";
  priority: number;
  source: string;
};
type Report = Parameters<NonNullable<RunAppInput["onContextSelected"]>>[0];
type Configuration = Parameters<NonNullable<RunAppInput["onConfiguration"]>>[0];
type AssistantMessage = Extract<ModelRequest["messages"][number], { readonly role: "assistant" }>;

const BASE_A = { templateId: "first-base", version: 1, text: "FIRST BASE TEXT" };
const BASE_B = { templateId: "resume-base", version: 9, text: "RESUME BASE TEXT" };
const SKILL_A: Skill = {
  schemaVersion: 1, id: "first-skill", title: "First Skill", content: "FIRST SKILL CONTENT",
  kind: "instruction", priority: 0, source: "host",
};
const SKILL_B: Skill = {
  schemaVersion: 1, id: "resume-skill", title: "Resume Skill", content: "RESUME SKILL CONTENT",
  kind: "instruction", priority: 0, source: "host",
};
/** Ruling 11: the fixed `coding-agent-v5` base text, sha256 of its 3,812 UTF-8 bytes. */
const FIXED_BASE_SHA256 =
  "860d951d7f60787371922438b5935842c76ea90aa8a75fdf75d55297727f7cc2";
const ZERO_REMOVED = {
  memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
  historyExchange: 0, historyConclusion: 0, currentExchange: 0,
};

const opened: TempKernelStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((temp) => temp.cleanup()));
});

/**
 * Pause at the SECOND `before_model` boundary: the first model call runs a real
 * tool loop, so the paused Turn already carries an assistant message with thinking.
 * (A file-local twin exists in R4a-frozen-public.test.ts; it is not exported and
 * the frozen fixtures/other tests may not be edited.)
 */
function pauseAtSecondBeforeModel(): BeforeModelHookPort {
  let boundary = 0;
  return {
    hookId: "pc-inputs-pause-second", point: "before_model", priority: 0,
    async execute() {
      boundary += 1;
      return boundary === 1
        ? { point: "before_model", kind: "continue" }
        : { point: "before_model", kind: "pause", reason: "pc inputs pause" };
    },
  };
}

/** Public `runCodingAgent` over a temp SQLite Session; no private module is reached. */
async function openPublicHarness(
  temp: TempKernelStore,
  steps: readonly ScriptedStep[],
  skillRoot: string,
  enabledIds: readonly string[],
  tools: readonly ToolDefinition[],
) {
  const workspaceRoot = path.join(temp.root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: "deepseek", model: "pc-inputs", options: {}, maxOutputTokens: 100 },
    runtime: { tokenBudget: 50_000, maxModelRequests: 4, maxToolCalls: 4 },
    tools: { enabledNames: tools.map((tool) => tool.name) },
    storage: { databasePath: temp.databasePath },
    skills: { resourceRoot: skillRoot, enabledIds: [...enabledIds] },
    memory: { provider: "empty" },
  });
  const model = new ScriptedProvider(steps);
  const providerRegistry = new ProviderRegistry().register({
    id: "deepseek", secretEnvironmentVariable: "PC_INPUTS_UNUSED_SECRET",
    defaultBaseUrl: "https://invalid.test",
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => model,
  });
  const common = {
    config, workspaceRoot, sessionId: "pc-inputs-session", providerRegistry,
    secretSource: { get: () => "synthetic-pc-key" },
    additionalTools: () => tools,
  };
  return { temp, model, common };
}

/** Same public start for both resume entries: a real tool loop with thinking, paused at boundary 2. */
async function pausedAfterToolLoop() {
  const temp = await openTempKernelStore("pc-inputs-resume-");
  opened.push(temp);
  // The frozen fixture's helper declares no capability; a read-only tool that the
  // Host permission policy admits needs the workspace_read capability.
  const echo = {
    ...fixtureTool("echo", async (call) => successResult(call.callId, "echo ok")),
    requiredCapabilities: ["workspace_read"] as const,
  };
  const reports: Report[] = [];
  const previewRequests: ModelRequest[] = [];
  const configurations: Configuration[] = [];
  const providerReportCounts: number[] = [];
  const harness = await openPublicHarness(
    temp,
    [
      {
        reasoningContent: "THINK-ONE",
        toolCalls: [{ callId: "call-one", name: "echo", arguments: {} }],
      },
      { text: "RESUMED", beforeReply: () => { providerReportCounts.push(reports.length); } },
    ],
    path.join(temp.root, "absent-skills"),
    [],
    [echo],
  );
  const identity = { runId: "pc-resume-run", turnId: "pc-resume-turn" };
  const first = await runCodingAgent({
    ...harness.common,
    input: "resume-question",
    executionIdentity: identity,
    baseSystemPrompt: BASE_A,
    skills: [SKILL_A],
    controlHooks: [pauseAtSecondBeforeModel()],
    onConfiguration: (configuration: Configuration) => configurations.push(configuration),
  });
  return {
    harness, first, identity, reports, previewRequests, configurations, providerReportCounts,
    resumeInputs: {
      baseSystemPrompt: BASE_B,
      skills: [SKILL_B],
      reasoningReplay: "none" as const,
      previewRequest: async (request: Readonly<ModelRequest>) => {
        previewRequests.push(structuredClone(request));
        return {
          outgoing: { ...structuredClone(request), maxOutputTokens: 40 },
          inputTokens: 321, outputReserve: 40, fits: true,
        };
      },
      onContextSelected: (report: Report) => { reports.push(report); },
      onConfiguration: (configuration: Configuration) => { configurations.push(configuration); },
    },
  };
}

type ResumeScenario = Awaited<ReturnType<typeof pausedAfterToolLoop>>;

function expectPausedToolLoop(state: RunState) {
  expect(state.status).toBe("paused");
  expect(state.transcript.map((entry) => entry.kind)).toEqual([
    "user_message", "assistant_message", "tool_result",
  ]);
  const assistant = state.transcript[1];
  expect(assistant?.kind).toBe("assistant_message");
  if (assistant?.kind !== "assistant_message") {
    throw new Error("paused transcript has no assistant message");
  }
  expect(assistant.message.reasoningContent).toBe("THINK-ONE");
  expect(assistant.message.content).toBe("");
  expect(assistant.toolCalls.map((call) => call.callId)).toEqual(["call-one"]);
  const toolResult = state.transcript[2];
  expect(toolResult?.kind === "tool_result" ? toolResult.result.status : undefined).toBe("success");
}

function expectResumedRun(scenario: ResumeScenario, state: RunState) {
  expect(state.status).toBe("completed");
  expect(scenario.harness.model.callCount).toBe(2);
  const resumed = scenario.harness.model.requests[1]!;

  // baseSystemPrompt and skills: the new Host text and Skill section, not BASE_A/SKILL_A.
  expect(resumed.systemPrompt).toBe(
    'RESUME BASE TEXT\n\n[skill_instruction id="resume-skill" source="host"]\nRESUME SKILL CONTENT',
  );
  // previewRequest: the resumed run's outgoing request is the one the preview returned.
  expect(resumed.maxOutputTokens).toBe(40);

  // reasoningReplay `none`: no assistant thinking leaves, the tool-call message stays.
  const assistants = resumed.messages.filter(
    (message): message is AssistantMessage => message.role === "assistant",
  );
  expect(assistants).toHaveLength(1);
  expect("reasoningContent" in assistants[0]!).toBe(false);
  expect(assistants[0]!.toolCalls.map((call) => call.callId)).toEqual(["call-one"]);
  expect(assistants[0]!.content).toBe("");

  // onContextSelected: one report, before the provider, with the rechecked counts.
  expect(scenario.previewRequests).toHaveLength(1);
  expect(scenario.providerReportCounts).toEqual([1]);
  expect(scenario.reports).toEqual([{
    requestId: resumed.requestId,
    inputTokens: 321,
    budget: 49_960,
    removed: ZERO_REMOVED,
  }]);
  const configuration = scenario.configurations.at(-1);
  expect(configuration?.systemPromptVersion).toBe("resume-base@9");
  expect(configuration?.systemPrompt).toBe("RESUME BASE TEXT");
  expect(configuration?.skills).toEqual([SKILL_B]);
  expect(configuration?.skillResourceRoot).toBe("provided-by-host");

  // The returned (stored) transcript keeps the original thinking and its calls.
  const kept = state.transcript.find((entry) =>
    entry.kind === "assistant_message" && entry.message.reasoningContent === "THINK-ONE");
  if (kept?.kind !== "assistant_message") {
    throw new Error("resumed transcript lost the original thinking message");
  }
  expect(kept.toolCalls.map((call) => call.callId)).toEqual(["call-one"]);
}

describe("PC-1a public inputs", () => {
  it("PC-1a provided base and Skills: the provider gets exactly the Host base text and Skill content, the report is id@version / provided-by-host, and no platform Skill file is read", async () => {
    const base = { templateId: "pc-host-base", version: 7, text: "HOST BASE TEXT" };
    // The fixture configures a non-existent platform Skill root; reaching it would fail the run.
    const harness = await createKernelHarness([{ text: "done" }], {
      baseSystemPrompt: base,
      skills: [SKILL_A],
    });
    try {
      const result = await harness.run("question");
      expect(result.state.status).toBe("completed");
      expect(harness.model.requests).toHaveLength(1);
      expect(harness.model.requests[0]!.systemPrompt).toBe(
        'HOST BASE TEXT\n\n[skill_instruction id="first-skill" source="host"]\nFIRST SKILL CONTENT',
      );
      expect(harness.configurations).toHaveLength(1);
      expect(harness.configurations[0]!.systemPromptVersion).toBe("pc-host-base@7");
      expect(harness.configurations[0]!.systemPrompt).toBe("HOST BASE TEXT");
      expect(harness.configurations[0]!.skills).toEqual([SKILL_A]);
      expect(harness.configurations[0]!.skillResourceRoot).toBe("provided-by-host");
    } finally {
      await harness.close();
    }
  });

  it("PC-1a same-identity resume: a paused tool loop resumes with new base/Skills, no replayed thinking, and one pre-provider report", async () => {
    const scenario = await pausedAfterToolLoop();
    expect(scenario.harness.model.requests).toHaveLength(1);
    expectPausedToolLoop(scenario.first.state);

    const second = await runCodingAgent({
      ...scenario.harness.common,
      input: "resume-question",
      executionIdentity: scenario.identity,
      ...scenario.resumeInputs,
    });

    expectResumedRun(scenario, second.state);
  });

  it("PC-1a public resumeCodingAgent: the same paused tool loop resumes through the public entry", async () => {
    const scenario = await pausedAfterToolLoop();
    expectPausedToolLoop(scenario.first.state);

    const second = await resumeCodingAgent({
      ...scenario.harness.common,
      ...scenario.resumeInputs,
    });

    expectResumedRun(scenario, second.state);
  });

  it("PC-1a absence: the fixed coding-agent-v5 base and the file-loaded Skills are kept", async () => {
    const temp = await openTempKernelStore("pc-inputs-absence-");
    opened.push(temp);
    const skillRoot = path.join(temp.root, "skills");
    const skillDirectory = path.join(skillRoot, "pc-file-skill");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "skill.json"), JSON.stringify({
      schemaVersion: 1, id: "pc-file-skill", title: "File Skill",
      kind: "instruction", priority: 0, contentFile: "content.md",
    }));
    await writeFile(path.join(skillDirectory, "content.md"), "FILE SKILL BODY");

    const harness = await openPublicHarness(
      temp, [{ text: "done" }], skillRoot, ["pc-file-skill"], [],
    );
    const configurations: Configuration[] = [];
    const result = await runCodingAgent({
      ...harness.common,
      input: "question",
      onConfiguration: (configuration) => configurations.push(configuration),
    });

    expect(result.state.status).toBe("completed");
    expect(harness.model.requests).toHaveLength(1);
    const request = harness.model.requests[0]!;
    expect(configurations).toHaveLength(1);
    const configuration = configurations[0]!;
    expect(configuration.systemPromptVersion).toBe("coding-agent-v5");
    expect(configuration.skillResourceRoot).toBe(skillRoot);
    expect(configuration.skills.map(({ id, title, content, kind, priority }) =>
      ({ id, title, content, kind, priority }))).toEqual([{
      id: "pc-file-skill", title: "File Skill", content: "FILE SKILL BODY",
      kind: "instruction", priority: 0,
    }]);
    expect(configuration.skills[0]?.source).toMatch(/^skill:pc-file-skill@sha256:[0-9a-f]{64}$/);
    // The whole fixed base, not just its opening, is pinned in both places.
    expect(sha256Hex(configuration.systemPrompt)).toBe(FIXED_BASE_SHA256);
    const skillSection = "\n\n[skill_instruction ";
    const skillAt = request.systemPrompt.indexOf(skillSection);
    expect(skillAt).toBeGreaterThan(0);
    expect(sha256Hex(request.systemPrompt.slice(0, skillAt))).toBe(FIXED_BASE_SHA256);
    expect(request.systemPrompt).toMatch(
      /\[skill_instruction id="pc-file-skill" source="skill:pc-file-skill@sha256:[0-9a-f]{64}"\]\nFILE SKILL BODY$/,
    );
  });
});
