export function allocateStock(item, requested) {
  const available = Math.max(0, item.stock - item.reserved);
  const allocated = Math.min(available, requested);
  return { allocated, remaining: requested - allocated };
}

export function shouldRestock(item) {
  return item.stock - item.reserved <= item.minStock;
}
