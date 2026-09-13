import { describe, expect, it } from "vitest";

import { StructuredEventLogger } from "../../src/observability/logging/structured-event-logger.js";

describe("StructuredEventLogger", () => {
  it("输出单行结构化事件并脱敏敏感键", async () => {
    const lines: string[] = [];
    const logger = new StructuredEventLogger((line) => {
      lines.push(line);
    });
    await logger.publish(
      {
        type: "run.started",
        meta: {
          schemaVersion: 1,
          eventId: "event-1",
          runId: "run-1",
          turnId: "turn-1",
          sequence: 1,
          occurredAt: "2026-08-20T00:00:00.000Z",
          elapsedMs: 0,
        },
        payload: { apiKey: "must-not-leak" },
      } as never,
      { signal: new AbortController().signal },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[redacted]");
    expect(lines[0]).not.toContain("must-not-leak");
  });
});
