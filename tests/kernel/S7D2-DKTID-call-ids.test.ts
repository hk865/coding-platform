/**
 * 7D2 DKTID R1 (ktid-tests.frozen.md §1 R1; rulings K1, K7): a tool call id the model repeats inside one Session keeps
 * its first occurrence and the later one becomes `<id>@<turnId>`; the model's next request carries that same new id.
 *
 * Entry: the public `runCodingAgent` on a real SQLite Kernel store with the frozen PC scripted provider and a
 * `fixture_read` test tool (the harness shape of `tests/kernel/K2K-compaction-view.test.ts`). Each cell reads the
 * RunState `runCodingAgent` returns and the `ModelRequest`s the scripted provider received; nothing is read back from
 * the store. The three cells (one table, ruling K7's three sources of a repeated id):
 * - (a) Turn 1 calls `call_0`; Turn 2 restores Turn 1 (`session_history` through Turn 1's end) and calls `call_0`;
 * - (b) one Turn whose first and second replies both call `call_0`;
 * - (c) two `current_turn` Turns of one Session, each calling `call_0`.
 * Turn k of Session s runs as `{ runId: s-run-k, turnId: s-turn-k }`, so the renamed id is `call_0@s-turn-k`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  appConfigSchema,
  ProviderRegistry,
  readTurnBounds,
  runCodingAgent,
  type ModelRequest,
  type RunState,
  type ToolCall,
} from "../../vendor/coding-agent/dist/public-api.js";
import { fixtureTool, ScriptedProvider, type ScriptedStep } from "../helpers/PC-kernel-fixture.js";
import { openTempKernelStore, type TempKernelStore } from "../helpers/K-session-support.js";

const SKILL_ROOT = fileURLToPath(new URL("../../vendor/coding-agent/resources/skills", import.meta.url));
const opened: TempKernelStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((item) => item.cleanup()));
});

const EFFECTS = { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] } as const;
/** One model reply that calls `fixture_read` once with the model's own id `call_0`. */
const CALL_0: ScriptedStep = { toolCalls: [{ callId: "call_0", name: "fixture_read", arguments: {} }] };

type TurnRow = { label: string; context: "current_turn" | "session_history"; replies: readonly ScriptedStep[] };

async function harness() {
  const temp = await openTempKernelStore("dktid-r1-");
  opened.push(temp);
  const workspaceRoot = path.join(temp.root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: "deepseek", model: "dktid-local", options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 1_000_000, maxModelRequests: 6, maxToolCalls: 6 },
    tools: { enabledNames: ["fixture_read"] },
    storage: { databasePath: temp.databasePath },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ["coding-safety"] },
    memory: { provider: "empty" },
  });
  // Replies are queued right before each Turn runs, so the scripted provider answers in run order.
  const steps: ScriptedStep[] = [];
  const provider = new ScriptedProvider(steps);
  const tool = {
    // The result answers whatever id the Kernel hands the tool, so a renamed call settles under its new id.
    ...fixtureTool("fixture_read", async (call: ToolCall) => ({ schemaVersion: 1 as const, callId: call.callId,
      status: "success" as const, output: [{ kind: "text" as const, text: "fixture body" }], effects: EFFECTS })),
    // The Host permission policy admits a registered read-only tool with workspace_read.
    requiredCapabilities: ["workspace_read"] as const,
  };
  const common = {
    config, workspaceRoot,
    providerRegistry: new ProviderRegistry().register({
      id: "deepseek", secretEnvironmentVariable: "DEEPSEEK_API_KEY", defaultBaseUrl: "https://invalid.test",
      capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => provider,
    }),
    secretSource: { get: () => "synthetic-fixture-key" },
    additionalTools: () => [tool],
  };
  return {
    provider,
    /** Runs the Turns in order on one Session; a `session_history` Turn restores through the previous Turn's end. */
    async run(sessionId: string, turns: readonly TurnRow[]): Promise<RunState[]> {
      const states: RunState[] = [];
      for (const turn of turns) {
        steps.push(...turn.replies);
        let sessionContext: { version: 1; mode: "current_turn" } | { version: 1; mode: "session_history"; throughPosition: number } =
          { version: 1, mode: "current_turn" };
        if (turn.context === "session_history") {
          const previous = states.at(-1);
          const bounds = previous === undefined ? null
            : await readTurnBounds(temp.store, { sessionId, kernelRunId: previous.runId });
          if (bounds === null || bounds.status !== "found" || bounds.endPosition === null) {
            throw new Error(`DKTID R1: no completed Turn before ${turn.label}`);
          }
          sessionContext = { version: 1, mode: "session_history", throughPosition: bounds.endPosition };
        }
        const result = await runCodingAgent({ ...common, sessionId, input: `input-${turn.label}`, sessionContext,
          executionIdentity: { runId: `${sessionId}-run-${turn.label}`, turnId: `${sessionId}-turn-${turn.label}` } });
        states.push(result.state);
      }
      return states;
    },
  };
}

/** The call ids of every assistant message the Turn recorded, in order. */
function recordedCallIds(state: RunState): string[] {
  return state.transcript.flatMap((entry) => entry.kind === "assistant_message"
    ? entry.toolCalls.map((call) => call.callId) : []);
}

/** The call ids the model saw in a request: those of its assistant messages and those of its tool results. */
function sentCallIds(request: ModelRequest | undefined): { calls: string[]; results: string[] } {
  const messages = request?.messages ?? [];
  return {
    calls: messages.flatMap((message) => message.role === "assistant" ? message.toolCalls.map((call) => call.callId) : []),
    results: messages.flatMap((message) => message.role === "tool" ? [message.callId] : []),
  };
}

describe("7D2 DKTID R1: a repeated tool call id is renamed after its first occurrence (Kernel SQLite)", () => {
  it.each([
    {
      name: "(a) Turn 2 restores Turn 1 and repeats call_0",
      session: "dkt-a",
      turns: [
        { label: "1", context: "current_turn", replies: [CALL_0, { text: "answer-1" }] },
        { label: "2", context: "session_history", replies: [CALL_0, { text: "answer-2" }] },
      ],
      recorded: [["call_0"], ["call_0@dkt-a-turn-2"]],
      next: { calls: ["call_0", "call_0@dkt-a-turn-2"], results: ["call_0", "call_0@dkt-a-turn-2"] },
    },
    {
      name: "(b) the second reply of one Turn repeats call_0",
      session: "dkt-b",
      turns: [
        { label: "1", context: "current_turn", replies: [CALL_0, CALL_0, { text: "answer-1" }] },
      ],
      recorded: [["call_0", "call_0@dkt-b-turn-1"]],
      next: { calls: ["call_0", "call_0@dkt-b-turn-1"], results: ["call_0", "call_0@dkt-b-turn-1"] },
    },
    {
      name: "(c) two current_turn Turns of one Session both call call_0",
      session: "dkt-c",
      turns: [
        { label: "1", context: "current_turn", replies: [CALL_0, { text: "answer-1" }] },
        { label: "2", context: "current_turn", replies: [CALL_0, { text: "answer-2" }] },
      ],
      recorded: [["call_0"], ["call_0@dkt-c-turn-2"]],
      next: { calls: ["call_0@dkt-c-turn-2"], results: ["call_0@dkt-c-turn-2"] },
    },
  ] satisfies { name: string; session: string; turns: TurnRow[]; recorded: string[][];
    next: { calls: string[]; results: string[] } }[])("DKTID-R1 $name", async ({ session, turns, recorded, next }) => {
    const h = await harness();

    const states = await h.run(session, turns);

    // The first occurrence stays as the model sent it; the repeat carries the Turn that repeated it.
    expect(states.map(recordedCallIds)).toEqual(recorded);
    // The request after the repeat's result shows the model the same new id, in the call and in its result.
    expect(sentCallIds(h.provider.requests.at(-1))).toEqual(next);
    expect(states.map((state) => state.status)).toEqual(turns.map(() => "completed"));
  });
});
