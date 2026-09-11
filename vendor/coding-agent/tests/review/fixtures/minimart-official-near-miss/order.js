import { allocateStock } from "./inventory.js";

export function calculateTotal(lines) {
  return lines.reduce((total, line) => {
    const subtotal = line.price * line.quantity;
    const discount = (subtotal * Math.min(100, Math.max(0, line.discountPercent))) / 100;
    return total + subtotal - discount;
  }, 0);
}

export async function fulfillOrder(order, inventory) {
  try {
    const planned = new Map();
    for (const line of order.lines) {
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
    return { fulfilled: true, orderId: order.id };
  } catch (error) {
    return {
      fulfilled: false,
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
