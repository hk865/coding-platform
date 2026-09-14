import { allocateStock } from "./inventory.js";

const fulfilledOrdersByInventory = new WeakMap();

export function calculateTotal(lines) {
  return lines.reduce((total, line) => {
    if (!Number.isFinite(line.price) || line.price < 0) {
      throw new RangeError("price 必须是非负有限数");
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError("quantity 必须是正整数");
    }
    if (!Number.isFinite(line.discountPercent)) {
      throw new RangeError("discountPercent 必须是有限数");
    }
    const subtotal = line.price * line.quantity;
    const discountPercent = Math.min(100, Math.max(0, line.discountPercent));
    return total + subtotal - (subtotal * discountPercent) / 100;
  }, 0);
}

export async function fulfillOrder(order, inventory) {
  const fulfilledOrders = fulfilledOrdersByInventory.get(inventory) ?? new Set();
  if (fulfilledOrders.has(order.id)) {
    return { fulfilled: true, orderId: order.id, duplicate: true };
  }
  try {
    const planned = new Map();
    for (const line of order.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new RangeError(`非法数量: ${line.sku}`);
      }
      const item = inventory[line.sku];
      if (!item) throw new Error(`未知商品: ${line.sku}`);
      const alreadyPlanned = planned.get(line.sku) ?? 0;
      const allocation = allocateStock(
        { ...item, reserved: item.reserved + alreadyPlanned },
        line.quantity,
      );
      if (allocation.allocated < line.quantity) throw new Error(`库存不足: ${line.sku}`);
      planned.set(line.sku, alreadyPlanned + allocation.allocated);
    }
    for (const [sku, quantity] of planned) inventory[sku].reserved += quantity;
    fulfilledOrders.add(order.id);
    fulfilledOrdersByInventory.set(inventory, fulfilledOrders);
    return { fulfilled: true, orderId: order.id };
  } catch (error) {
    return {
      fulfilled: false,
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
