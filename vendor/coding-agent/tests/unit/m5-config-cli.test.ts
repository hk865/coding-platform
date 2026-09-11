import { describe, expect, it } from "vitest";

import { parseCliCommand } from "../../src/app/cli/cli.js";
import { loadAppConfig } from "../../src/app/composition/app-config.js";

describe("M5 config/CLI", () => {
  it("配置优先级是 CLI > CODING_AGENT_* > default", async () => {
    const config = await loadAppConfig({
      cwd: "/tmp/workspace",
      environment: {
        CODING_AGENT_PROVIDER: "openai",
        CODING_AGENT_MODEL: "gpt-env",
      },
      overrides: { provider: "deepseek", model: "deepseek-v4-flash" },
    });
    expect(config.model).toMatchObject({ provider: "deepseek", model: "deepseek-v4-flash" });
    expect(JSON.stringify(config)).not.toContain("API_KEY");
  });

  it("run/resume 严格拒绝缺失与冲突参数", () => {
    expect(parseCliCommand(["run", "--input", "hello", "--non-interactive"], "/tmp")).toMatchObject(
      {
        command: "run",
        input: "hello",
        nonInteractive: true,
      },
    );
    expect(parseCliCommand(["resume", "--session", "s-1"], "/tmp")).toMatchObject({
      command: "resume",
      sessionId: "s-1",
    });
    expect(() => parseCliCommand(["run"], "/tmp")).toThrow("--input");
    expect(() => parseCliCommand(["resume", "--session", "s-1", "--input", "x"], "/tmp")).toThrow(
      "不接受",
    );
    expect(() => parseCliCommand(["run", "--input", "x", "--unknown"], "/tmp")).toThrow("未知参数");
  });
});
