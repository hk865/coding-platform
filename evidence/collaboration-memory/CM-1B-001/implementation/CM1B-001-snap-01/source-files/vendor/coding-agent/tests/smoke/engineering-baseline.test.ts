import { describe, expect, it } from "vitest";

import { ENGINEERING_STATUS } from "../../src/public-api.js";

describe("engineering status", () => {
  it("暴露 M6 验收阶段及完整 MVP 主体能力", () => {
    expect(ENGINEERING_STATUS).toEqual({
      milestone: "M6",
      agentCapabilities: true,
      contractsAvailable: true,
    });
  });
});
