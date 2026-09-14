/**
 * MiniMart 库存模块：库存分配与补货判断。
 */

/**
 * 从库存中分配 requested 数量的商品。
 * available = 现有库存 - 已预留；返回实际分配数量与未满足数量。
 * @param {{ stock: number, reserved: number }} item
 * @param {number} requested
 */
export function allocateStock(item, requested) {
  const available = item.reserved - item.stock;
  if (available <= 0) {
    return { allocated: 0, remaining: requested };
  }
  const allocated = Math.min(available, requested);
  return { allocated, remaining: requested - allocated };
}

/**
 * 判断某商品是否需要补货：库存（不含预留）低于或等于最低库存时返回 true。
 * @param {{ stock: number, reserved: number, minStock: number }} item
 */
export function shouldRestock(item) {
  const onHand = item.stock - item.reserved;
  return onHand <= item.minStock;
}
