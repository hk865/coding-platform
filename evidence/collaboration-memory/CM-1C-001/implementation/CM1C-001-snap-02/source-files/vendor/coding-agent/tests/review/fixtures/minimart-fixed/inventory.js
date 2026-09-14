/** Independent review completion used only in the isolated Bug Hunt workspace. */
export function allocateStock(item, requested) {
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new RangeError("requested 必须是正整数");
  }
  if (
    !Number.isFinite(item.stock) ||
    !Number.isFinite(item.reserved) ||
    item.stock < 0 ||
    item.reserved < 0
  ) {
    throw new RangeError("stock/reserved 必须是非负有限数");
  }
  const available = Math.max(0, item.stock - item.reserved);
  const allocated = Math.min(available, requested);
  return { allocated, remaining: requested - allocated };
}

export function shouldRestock(item) {
  return item.stock - item.reserved <= item.minStock;
}
