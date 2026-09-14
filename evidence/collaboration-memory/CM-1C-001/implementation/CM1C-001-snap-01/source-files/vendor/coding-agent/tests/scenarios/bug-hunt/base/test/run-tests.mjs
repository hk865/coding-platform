/**
 * MiniMart 测试：当前基线有 3 个失败用例，对应 3 个已知缺陷。
 * 修复完成后全部用例应通过。
 */
import { allocateStock, shouldRestock } from "../src/inventory.js";
import { calculateTotal, fulfillOrder } from "../src/order.js";

const checks = [];
let failures = 0;

function check(name, condition, detail) {
  checks.push({ name, pass: Boolean(condition), detail: detail ?? "" });
  if (!condition) failures += 1;
}

// --- 库存分配：可用量 = stock - reserved ---
{
  const item = { stock: 10, reserved: 4 };
  const result = allocateStock(item, 3);
  check(
    "库存分配使用可用量（stock - reserved）",
    result.allocated === 3 && result.remaining === 0,
    `allocated=${result.allocated}, remaining=${result.remaining}`,
  );
}

// --- 库存不足时不分配 ---
{
  const item = { stock: 2, reserved: 2 };
  const result = allocateStock(item, 5);
  check(
    "库存耗尽时 allocated 为 0 且全部未满足",
    result.allocated === 0 && result.remaining === 5,
    `allocated=${result.allocated}, remaining=${result.remaining}`,
  );
}

// --- 补货判断 ---
{
  const item = { stock: 5, reserved: 1, minStock: 4 };
  check(
    "库存等于最低库存时需要补货",
    shouldRestock(item) === true,
    `shouldRestock=${shouldRestock(item)}`,
  );
  const enough = { stock: 8, reserved: 1, minStock: 4 };
  check(
    "库存高于最低库存时不需要补货",
    shouldRestock(enough) === false,
    `shouldRestock=${shouldRestock(enough)}`,
  );
}

// --- 订单金额：折扣与 100% 免单 ---
{
  const total = calculateTotal([
    { price: 100, quantity: 2, discountPercent: 10 },
    { price: 50, quantity: 1, discountPercent: 0 },
  ]);
  check("10% 折扣行与无折扣行合计正确", total === 230, `total=${total}`);
}

{
  const total = calculateTotal([{ price: 80, quantity: 1, discountPercent: 100 }]);
  check("100% 折扣时该行免费", total === 0, `total=${total}`);
}

// --- 订单履约：库存不足必须失败，不得吞错返回成功 ---
{
  const order = { id: "o-1", lines: [{ sku: "a", quantity: 3 }] };
  const inventory = { a: { stock: 10, reserved: 0 } };
  const result = await fulfillOrder(order, inventory);
  check(
    "库存充足时履约成功且预留增加",
    result.fulfilled === true && inventory.a.reserved === 3,
    `reserved=${inventory.a.reserved}`,
  );
}

{
  const order = { id: "o-2", lines: [{ sku: "b", quantity: 99 }] };
  const inventory = { b: { stock: 5, reserved: 0 } };
  const result = await fulfillOrder(order, inventory);
  check(
    "库存不足时履约必须明确失败（fulfilled=false）且不得预留",
    result.fulfilled === false && inventory.b.reserved === 0,
    `fulfilled=${result.fulfilled}, warning=${result.warning ?? "无"}, reserved=${inventory.b.reserved}`,
  );
}

// --- 订单原子性：两行订单中任一行失败时，整个订单失败且已预留的库存必须回滚 ---
{
  const order = {
    id: "o-3",
    lines: [
      { sku: "a", quantity: 2 },
      { sku: "b", quantity: 99 },
    ],
  };
  const inventory = { a: { stock: 10, reserved: 0 }, b: { stock: 5, reserved: 0 } };
  const result = await fulfillOrder(order, inventory);
  check(
    "两行订单第二行库存不足时整个订单失败且第一行预留回滚",
    result.fulfilled === false && inventory.a.reserved === 0 && inventory.b.reserved === 0,
    `fulfilled=${result.fulfilled}, a.reserved=${inventory.a.reserved}, b.reserved=${inventory.b.reserved}`,
  );
}

{
  const order = {
    id: "o-4",
    lines: [
      { sku: "a", quantity: 1 },
      { sku: "missing", quantity: 1 },
    ],
  };
  const inventory = { a: { stock: 10, reserved: 0 } };
  const result = await fulfillOrder(order, inventory);
  check(
    "两行订单含未知 SKU 时整个订单失败且已预留回滚",
    result.fulfilled === false && inventory.a.reserved === 0,
    `fulfilled=${result.fulfilled}, a.reserved=${inventory.a.reserved}`,
  );
}

for (const check of checks) {
  process.stdout.write(
    `${check.pass ? "PASS" : "FAIL"}  ${check.name}${check.detail ? `  [${check.detail}]` : ""}\n`,
  );
}

if (failures > 0) {
  process.stdout.write(`\n${failures} 个用例失败\n`);
  process.exit(1);
}
process.stdout.write("\n全部用例通过\n");
