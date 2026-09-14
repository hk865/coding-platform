import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.argv[2];
if (!workspace) throw new Error("usage: minimart-blackbox.mjs <workspace>");

const inventoryModule = await import(
  `${pathToFileURL(path.resolve(workspace, "src/inventory.js")).href}?review=${Date.now()}`
);
const orderModule = await import(
  `${pathToFileURL(path.resolve(workspace, "src/order.js")).href}?review=${Date.now()}`
);
const { allocateStock } = inventoryModule;
const { calculateTotal, fulfillOrder } = orderModule;
const checks = [];

async function check(name, probe) {
  try {
    const detail = await probe();
    checks.push({ name, pass: detail === true, detail: detail === true ? "" : String(detail) });
  } catch (error) {
    checks.push({
      name,
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

await check("reserved 等于 stock 时完全不可分配", () => {
  const result = allocateStock({ stock: 7, reserved: 7 }, 2);
  return result.allocated === 0 && result.remaining === 2 ? true : JSON.stringify(result);
});

await check("reserved 超过 stock 时不能产生负分配", () => {
  const result = allocateStock({ stock: 7, reserved: 9 }, 2);
  return result.allocated === 0 && result.remaining === 2 ? true : JSON.stringify(result);
});

await check("零数量与负数量被明确拒绝且不改变库存", () => {
  const item = { stock: 7, reserved: 1 };
  let zeroRejected = false;
  let negativeRejected = false;
  try {
    allocateStock(item, 0);
  } catch {
    zeroRejected = true;
  }
  try {
    allocateStock(item, -2);
  } catch {
    negativeRejected = true;
  }
  return zeroRejected && negativeRejected && item.reserved === 1
    ? true
    : `zeroRejected=${zeroRejected} negativeRejected=${negativeRejected} reserved=${item.reserved}`;
});

await check("0%、100%、超过 100% 折扣边界不产生负金额", () => {
  const zero = calculateTotal([{ price: 50, quantity: 2, discountPercent: 0 }]);
  const full = calculateTotal([{ price: 50, quantity: 2, discountPercent: 100 }]);
  const over = calculateTotal([{ price: 50, quantity: 2, discountPercent: 125 }]);
  return zero === 100 && full === 0 && over === 0 ? true : `zero=${zero} full=${full} over=${over}`;
});

await check("第二行库存不足时第一行预留回滚", async () => {
  const inventory = {
    first: { stock: 10, reserved: 1 },
    second: { stock: 1, reserved: 0 },
  };
  const result = await fulfillOrder(
    {
      id: "review-rollback-stock",
      lines: [
        { sku: "first", quantity: 2 },
        { sku: "second", quantity: 2 },
      ],
    },
    inventory,
  );
  return result.fulfilled === false &&
    inventory.first.reserved === 1 &&
    inventory.second.reserved === 0
    ? true
    : JSON.stringify({ result, inventory });
});

await check("第二行 SKU 不存在时第一行预留回滚", async () => {
  const inventory = { first: { stock: 10, reserved: 3 } };
  const result = await fulfillOrder(
    {
      id: "review-rollback-missing",
      lines: [
        { sku: "first", quantity: 2 },
        { sku: "missing", quantity: 1 },
      ],
    },
    inventory,
  );
  return result.fulfilled === false && inventory.first.reserved === 3
    ? true
    : JSON.stringify({ result, inventory });
});

await check("订单中的零数量和负数量行失败且不预留", async () => {
  const inventory = { sku: { stock: 10, reserved: 2 } };
  const zero = await fulfillOrder(
    { id: "review-zero", lines: [{ sku: "sku", quantity: 0 }] },
    inventory,
  );
  const negative = await fulfillOrder(
    { id: "review-negative", lines: [{ sku: "sku", quantity: -1 }] },
    inventory,
  );
  return zero.fulfilled === false && negative.fulfilled === false && inventory.sku.reserved === 2
    ? true
    : JSON.stringify({ zero, negative, inventory });
});

await check("同一订单重复调用不造成重复预留", async () => {
  const inventory = { sku: { stock: 10, reserved: 0 } };
  const order = { id: "review-idempotent", lines: [{ sku: "sku", quantity: 3 }] };
  const first = await fulfillOrder(order, inventory);
  const second = await fulfillOrder(order, inventory);
  return first.fulfilled === true && inventory.sku.reserved === 3 && second.duplicate === true
    ? true
    : JSON.stringify({ first, second, inventory });
});

const failed = checks.filter((item) => !item.pass);
process.stdout.write(
  JSON.stringify({ status: failed.length === 0 ? "pass" : "fail", checks }, null, 2),
);
process.exit(failed.length === 0 ? 0 : 1);
