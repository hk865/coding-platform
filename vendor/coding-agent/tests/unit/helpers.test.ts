import { access, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createDeterministicIdGenerator,
  createTempWorkspace,
  ManualClock,
  ResourceScope,
  withEnvironment,
} from "../helpers/test-helpers.js";

describe("M0 test helpers", () => {
  it("临时 workspace 可重复清理且不会遗留目录", async () => {
    const workspace = await createTempWorkspace();
    await writeFile(workspace.resolve("sample.txt"), "isolated", "utf8");
    await workspace.cleanup();
    await workspace.cleanup();

    await expect(access(workspace.root)).rejects.toThrow();
  });

  it("可控时钟只在显式推进时变化", () => {
    const clock = new ManualClock(new Date("2026-01-01T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
    clock.advance(1_500);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:01.500Z");
    clock.reset();
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("确定性 ID 在每个生成器中从同一序列开始", () => {
    const first = createDeterministicIdGenerator("run");
    const second = createDeterministicIdGenerator("run");
    expect([first.next(), first.next()]).toEqual(["run-0000", "run-0001"]);
    expect(second.next()).toBe("run-0000");
  });

  it("环境变量即使在 action 失败时也会恢复", async () => {
    const key = "CODING_AGENT_M0_ENV_TEST";
    delete process.env[key];

    await expect(
      withEnvironment({ [key]: "temporary" }, () => {
        expect(process.env[key]).toBe("temporary");
        throw new Error("expected failure");
      }),
    ).rejects.toThrow("expected failure");

    expect(process.env[key]).toBeUndefined();
  });

  it("资源按后注册先清理，且只清理一次", async () => {
    const order: string[] = [];
    const scope = new ResourceScope();
    scope.defer(() => {
      order.push("first");
    });
    scope.defer(() => {
      order.push("second");
    });

    await scope.dispose();
    await scope.dispose();

    expect(order).toEqual(["second", "first"]);
  });
});
