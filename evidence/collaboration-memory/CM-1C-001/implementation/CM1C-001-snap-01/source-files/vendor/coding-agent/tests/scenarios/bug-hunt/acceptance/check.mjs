#!/usr/bin/env node
/**
 * MiniMart 修复验收器（确定性、可执行）。
 * 用法：node check.mjs <workspace>
 * 退出码 0 = 通过；输出结构化 JSON。
 *
 * 覆盖：任务包自带测试 + 独立业务边界黑盒（非法数量、折扣边界、整体回滚、订单幂等），
 * 防止「只满足自带测试」的 near-miss 实现通过。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const BASE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "base");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
}

const workspace = process.argv[2];
if (!workspace) {
  process.stderr.write("用法：node check.mjs <workspace>\n");
  process.exit(2);
}

let workspaceRoot;
try {
  workspaceRoot = path.resolve(workspace);
  await stat(workspaceRoot);
  check("workspace 存在", true, workspaceRoot);
} catch {
  check("workspace 存在", false, workspace);
  const result = {
    status: "fail",
    checks,
    failureClassification: "runner_error",
    detail: "workspace 不存在",
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(1);
}

// 1) 测试文件不得被修改（防止用改测试掩盖失败）
try {
  const baseTest = await readFile(path.join(BASE_ROOT, "test", "run-tests.mjs"), "utf8");
  const workspaceTest = await readFile(path.join(workspaceRoot, "test", "run-tests.mjs"), "utf8");
  check(
    "测试文件未被修改",
    sha256(workspaceTest) === sha256(baseTest),
    `base=${sha256(baseTest).slice(0, 12)} workspace=${sha256(workspaceTest).slice(0, 12)}`,
  );
} catch {
  check("测试文件未被修改", false, "workspace 缺少 test/run-tests.mjs 或 base 缺失");
}

// 2) 源文件结构不过度膨胀（允许仅修改两个 src 模块，不允许新增/删除/重命名文件）
try {
  const baseSrc = (await readdir(path.join(BASE_ROOT, "src"))).sort();
  const workspaceSrc = (await readdir(path.join(workspaceRoot, "src"))).sort();
  check(
    "src 文件结构保持不变",
    JSON.stringify(baseSrc) === JSON.stringify(workspaceSrc),
    `base=[${baseSrc}] workspace=[${workspaceSrc}]`,
  );
} catch {
  check("src 文件结构保持不变", false, "无法读取 src 目录");
}

// 3) 真实运行测试
let testOutput;
let testExitCode = null;
try {
  const spawned = spawnSync(process.execPath, ["test/run-tests.mjs"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  testOutput = (spawned.stdout ?? "") + (spawned.stderr ?? "");
  testExitCode = spawned.status;
  check(
    "全部测试用例通过",
    spawned.status === 0,
    `exit=${spawned.status ?? "null"}${spawned.signal ? ` signal=${spawned.signal}` : ""}\n${testOutput.slice(0, 2_000)}`,
  );
} catch (error) {
  testOutput = String(error);
  check("全部测试用例通过", false, String(error));
}

// 4) 业务边界黑盒（直接 import 工作区模块；不依赖任务包自带测试的覆盖范围）
try {
  const inventoryModule = await import(
    `${pathToFileURL(path.resolve(workspaceRoot, "src/inventory.js")).href}?gate=${Date.now()}`
  );
  const orderModule = await import(
    `${pathToFileURL(path.resolve(workspaceRoot, "src/order.js")).href}?gate=${Date.now()}`
  );
  const { allocateStock } = inventoryModule;
  const { calculateTotal, fulfillOrder } = orderModule;

  // 4a) 非法数量（0 / 负）必须被拒绝且不改变库存：不允许负分配
  {
    const item = { stock: 7, reserved: 1 };
    let rejected = false;
    try {
      const zero = allocateStock(item, 0);
      const negative = allocateStock(item, -2);
      rejected =
        zero.allocated >= 0 &&
        zero.remaining >= 0 &&
        negative.allocated >= 0 &&
        negative.remaining >= 0 &&
        item.reserved === 1;
    } catch {
      rejected = item.reserved === 1; // 抛错也是合法拒绝形态
    }
    check("allocateStock 拒绝零/负数量且不改变库存", rejected, `reserved=${item.reserved}`);
  }

  // 4b) 折扣边界不产生负金额：0% / 100% / >100% 全免
  {
    const zero = calculateTotal([{ price: 50, quantity: 2, discountPercent: 0 }]);
    const full = calculateTotal([{ price: 50, quantity: 2, discountPercent: 100 }]);
    const over = calculateTotal([{ price: 50, quantity: 2, discountPercent: 125 }]);
    check(
      "折扣边界 0%/100%/>100% 不产生负金额",
      zero === 100 && full === 0 && over === 0,
      `zero=${zero} full=${full} over=${over}`,
    );
  }

  // 4c) 订单中的零/负数量行必须失败且不预留
  {
    const inventory = { sku: { stock: 10, reserved: 2 } };
    const results = [];
    for (const quantity of [0, -1]) {
      try {
        results.push(
          await fulfillOrder(
            { id: `review-q-${quantity}`, lines: [{ sku: "sku", quantity }] },
            inventory,
          ),
        );
      } catch {
        results.push({ fulfilled: false, error: "thrown" });
      }
    }
    check(
      "零/负数量订单行失败且不预留",
      results.every((item) => item.fulfilled === false) && inventory.sku.reserved === 2,
      JSON.stringify({ results, reserved: inventory.sku.reserved }),
    );
  }

  // 4d) 同一订单重复调用不得重复预留
  {
    const inventory = { sku: { stock: 10, reserved: 0 } };
    const order = { id: "review-idempotent", lines: [{ sku: "sku", quantity: 3 }] };
    const first = await fulfillOrder(order, inventory);
    const second = await fulfillOrder(order, inventory);
    check(
      "同一订单重复调用不重复预留",
      first.fulfilled === true && second.fulfilled !== false && inventory.sku.reserved === 3,
      JSON.stringify({ first, second, reserved: inventory.sku.reserved }),
    );
  }

  // 4e) 两行订单回滚（reserved 非零起点）：第二行失败时第一行预留回滚
  {
    const inventory = {
      first: { stock: 10, reserved: 1 },
      second: { stock: 1, reserved: 0 },
    };
    const result = await fulfillOrder(
      {
        id: "review-rollback",
        lines: [
          { sku: "first", quantity: 2 },
          { sku: "second", quantity: 2 },
        ],
      },
      inventory,
    );
    check(
      "两行订单第二行不足时整体回滚（含既有 reserved）",
      result.fulfilled === false &&
        inventory.first.reserved === 1 &&
        inventory.second.reserved === 0,
      JSON.stringify({ result, inventory }),
    );
  }
} catch (error) {
  const boundaryDetail = error instanceof Error ? error.message : String(error);
  check("业务边界黑盒可执行", false, boundaryDetail);
}

const pass = checks.every((item) => item.pass);
const result = {
  scenario: "bug-hunt",
  status: pass ? "pass" : "fail",
  failureClassification: pass ? "pass" : "acceptance_failed",
  checks,
  test: { exitCode: testExitCode, output: testOutput.slice(0, 16_384) },
};
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exit(pass ? 0 : 1);
