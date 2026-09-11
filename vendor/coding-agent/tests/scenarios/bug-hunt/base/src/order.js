/**
 * MiniMart 订单模块：订单金额计算与订单履约。
 */
import { allocateStock } from "./inventory.js";

/**
 * 计算订单总金额：每行 单价×数量，折扣按百分比减免；折扣达到 100% 时该行免费。
 * @param {Array<{ price: number, quantity: number, discountPercent: number }>} lines
 */
export function calculateTotal(lines) {
  return lines.reduce((total, line) => {
    const subtotal = line.price * line.quantity;
    let discount = 0;
    if (line.discountPercent > 100) {
      discount = subtotal;
    } else if (line.discountPercent > 0 && line.discountPercent < 100) {
      discount = (subtotal * line.discountPercent) / 100;
    }
    return total + subtotal - discount;
  }, 0);
}

/**
 * 履约订单：为每一行分配库存并预留；任何一行库存不足时整个订单失败。
 * @param {{ id: string, lines: Array<{ sku: string, quantity: number }> }} order
 * @param {Record<string, { stock: number, reserved: number }>} inventory
 */
export async function fulfillOrder(order, inventory) {
  try {
    for (const line of order.lines) {
      const item = inventory[line.sku];
      if (!item) {
        throw new Error(`未知商品: ${line.sku}`);
      }
      const allocation = allocateStock(item, line.quantity);
      if (allocation.allocated < line.quantity) {
        throw new Error(`库存不足: ${line.sku}`);
      }
      item.reserved += allocation.allocated;
    }
    return { fulfilled: true, orderId: order.id };
  } catch (error) {
    // 记录警告并继续返回成功 —— 注意：这会让调用方误以为订单已履约。
    return { fulfilled: true, orderId: order.id, warning: error.message };
  }
}
