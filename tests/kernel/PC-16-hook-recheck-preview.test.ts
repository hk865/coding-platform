/**
 * PC-16 (K): the before-model hook is re-checked with the preview, and only a fitting k is sent.
 *
 * Count 700, window 900. The first request reserves 100 (800 fits). A hook cap of 250 makes the
 * re-check 950 and the provider is never called; a Host cap of 150 clamps the re-check to 850 and
 * the provider receives maxOutputTokens 150.
 */
import { describe, expect, it } from "vitest";
import type { ModelRequest } from "../../vendor/coding-agent/dist/public-api.js";
import {
  createRunnerHarness,
  fixedCountPreview,
} from "../helpers/PC-kernel-fixture.js";

function runnerInput() {
  return {
    run: {
      schemaVersion: 1 as const,
      runId: "run-pc16",
      turn: {
        turnId: "turn-pc16",
        userMessage: {
          schemaVersion: 1 as const,
          messageId: "user-pc16",
          role: "user" as const,
          content: "go",
        },
      },
      createdAt: "2026-10-22T00:00:00.000Z",
    },
    baseSystemPrompt: "BASE",
    tokenBudget: 900,
    maxOutputTokens: 100,
  };
}

/**
 * Literal input counts per preview call; the fixture's `fixedCountPreview` is constant, so the
 * first and re-checked counts cannot differ through it.
 */
function twoCountPreview(counts: readonly [number, number], limits: {
  readonly window: number;
  readonly outputCap: number;
}) {
  const calls: {
    request: ModelRequest;
    result: { inputTokens: number; outputReserve: number; fits: boolean };
  }[] = [];
  return {
    calls,
    previewRequest(request: Readonly<ModelRequest>) {
      const inputTokens = counts[calls.length];
      if (inputTokens === undefined) {
        throw new Error(`PC-16 preview called more than ${counts.length} times`);
      }
      const outputReserve = Math.min(request.maxOutputTokens ?? limits.outputCap, limits.outputCap);
      const result = {
        outgoing: { ...structuredClone(request), maxOutputTokens: outputReserve },
        inputTokens,
        outputReserve,
        fits: inputTokens + outputReserve <= limits.window,
      };
      calls.push({ request: structuredClone(request), result: structuredClone(result) });
      return result;
    },
  };
}

describe("PC-16 hook re-check with the final request preview", () => {
  it("does not call the provider when the re-checked request does not fit", async () => {
    const probe = fixedCountPreview({ window: 900, outputCap: 250, count: 700 });
    const harness = createRunnerHarness([{ text: "should not be called" }], {
      hookOutputCap: 250,
      previewRequest: probe.previewRequest,
    });
    const state = await harness.run(runnerInput());

    expect(state.status).toBe("failed");
    expect(state.outcome?.kind === "failed" ? state.outcome.failure.code : undefined)
      .toBe("required_content_over_budget");
    expect(harness.model.callCount).toBe(0);
    expect(harness.reports).toHaveLength(0);
    expect(probe.calls).toHaveLength(2);
    expect(probe.calls[0]!.result.outputReserve).toBe(100);
    expect(probe.calls[0]!.result.fits).toBe(true);
    expect(probe.calls[1]!.result.outputReserve).toBe(250);
    expect(probe.calls[1]!.result.fits).toBe(false);
    expect(probe.calls[1]!.result.inputTokens + probe.calls[1]!.result.outputReserve).toBe(950);
  });

  it("sends the clamped reserve and reports the re-checked counts", async () => {
    const probe = fixedCountPreview({ window: 900, outputCap: 150, count: 700 });
    const harness = createRunnerHarness([{ text: "answer" }], {
      hookOutputCap: 250,
      previewRequest: probe.previewRequest,
    });
    const state = await harness.run(runnerInput());

    expect(state.status).toBe("completed");
    expect(probe.calls[0]!.result.outputReserve).toBe(100);
    expect(probe.calls[1]!.result.outputReserve).toBe(150);
    expect(probe.calls[1]!.result.fits).toBe(true);
    expect(probe.calls[1]!.result.inputTokens + probe.calls[1]!.result.outputReserve).toBe(850);
    expect(harness.model.callCount).toBe(1);
    expect(harness.model.requests[0]!.maxOutputTokens).toBe(150);
    expect(harness.reports).toHaveLength(1);
    expect(harness.reports[0]).toMatchObject({ inputTokens: 700, budget: 750 });
  });

  it("reports the re-checked input count: 701, not the first preview's 700", async () => {
    // Count 700 before the hook, 701 on the re-check; 701 + 150 = 851 fits 900.
    const probe = twoCountPreview([700, 701], { window: 900, outputCap: 150 });
    let reportsAtProvider = -1;
    let harness: ReturnType<typeof createRunnerHarness>;
    harness = createRunnerHarness([{
      text: "answer",
      beforeReply: () => { reportsAtProvider = harness.reports.length; },
    }], {
      hookOutputCap: 250,
      previewRequest: probe.previewRequest,
    });
    const state = await harness.run(runnerInput());

    expect(state.status).toBe("completed");
    expect(probe.calls).toHaveLength(2);
    expect(probe.calls[0]!.result).toMatchObject({ inputTokens: 700, outputReserve: 100, fits: true });
    expect(probe.calls[1]!.result).toMatchObject({ inputTokens: 701, outputReserve: 150, fits: true });
    expect(probe.calls[1]!.result.inputTokens + probe.calls[1]!.result.outputReserve).toBe(851);
    expect(harness.model.callCount).toBe(1);
    expect(harness.model.requests[0]!.maxOutputTokens).toBe(150);
    // The report must already be delivered when the provider is entered.
    expect(reportsAtProvider).toBe(1);
    expect(harness.reports).toHaveLength(1);
    expect(harness.reports[0]).toEqual({
      requestId: harness.model.requests[0]!.requestId,
      inputTokens: 701,
      budget: 750,
      removed: {
        memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
        historyExchange: 0, historyConclusion: 0, currentExchange: 0,
      },
    });
  });
});
