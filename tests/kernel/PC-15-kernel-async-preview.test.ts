/**
 * PC-15 (K): an async fixed-count preview drives runCodingAgent selection.
 *
 * The preview resolves only on a later tick, so the run proves the selector awaited it. The
 * report is delivered once, before the provider, with the preview's count and output reserve.
 */
import { describe, expect, it } from "vitest";
import {
  asyncFixedCountPreview,
  createKernelHarness,
} from "../helpers/PC-kernel-fixture.js";

describe("PC-15 Kernel async preview", () => {
  it("awaits the async preview and reports the chosen request before the provider", async () => {
    const order: string[] = [];
    const probe = asyncFixedCountPreview({ window: 900, outputCap: 100, count: 700 });
    const harness = await createKernelHarness(
      [{ text: "done", beforeReply: async () => { order.push("provider"); } }],
      {
        previewRequest: probe.previewRequest,
        window: 900,
        outputCap: 100,
        onContextSelected: (report) => {
          order.push(`selected:${report.inputTokens}:${report.budget}`);
        },
      },
    );
    try {
      const result = await harness.run("go");
      expect(result.state.status).toBe("completed");
      expect(probe.calls).toHaveLength(1);
      expect(probe.calls[0]!.result.fits).toBe(true);
      expect(harness.model.callCount).toBe(1);
      expect(harness.reports).toHaveLength(1);
      expect(harness.reports[0]).toMatchObject({
        inputTokens: 700,
        budget: 800,
        removed: {
          memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
          historyExchange: 0, historyConclusion: 0, currentExchange: 0,
        },
      });
      expect(typeof harness.reports[0]!.requestId).toBe("string");
      expect(order).toEqual(["selected:700:800", "provider"]);
    } finally {
      await harness.close();
    }
  });
});
