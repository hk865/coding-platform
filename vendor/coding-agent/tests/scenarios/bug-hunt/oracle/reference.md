# MiniMart 缺陷定位参考（oracle，Agent 不可见）

以下内容仅供 evaluator 判定修复正确性，**不得出现在模型上下文或 Agent 可见文件中**。

## 缺陷清单

| #   | 文件               | 位置                                                               | 根因                                                                     | 症状                   |
| --- | ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------- |
| 1   | `src/inventory.js` | `allocateStock` 中 `const available = item.reserved - item.stock;` | 可用量计算写反（应为 `stock - reserved`），导致有货时算出负数/错误可用量 | 有货却报「库存不足」   |
| 2   | `src/order.js`     | `calculateTotal` 中 `if (line.discountPercent > 100)`              | 折扣边界写错（应为 `>= 100`），100% 折扣未生效                           | 免费商品仍收全款       |
| 3   | `src/order.js`     | `fulfillOrder` 的 `catch` 分支返回 `{ fulfilled: true, ... }`      | 捕获异常后吞掉失败并谎报成功（应为 `fulfilled: false` 并保留错误信息）   | 库存不足订单显示已履约 |

## 判定标准

1. `node test/run-tests.mjs` 全部通过（10 个用例，含两行订单原子性）；
2. 测试文件 `test/run-tests.mjs` 未被修改；
3. `src/inventory.js` 与 `src/order.js` 之外不应有功能性改动（README 允许补充说明）；
4. 官方 acceptance 的独立业务边界黑盒全部通过：
   - `allocateStock` 拒绝零/负数量（抛错或返回非负分配）且不改变库存；
   - 折扣 0%/100%/>100% 不产生负金额（0%→原价、100%→免费、>100%→免费）；
   - 订单中零/负数量行必须失败且不预留；
   - 同一订单重复调用不得重复预留（第二次调用不改变 reserved）；
   - 两行订单第二行不足时整体回滚（含非零起点 reserved）。

## 允许的修复形态

- `allocateStock`：`available = item.stock - item.reserved`；非法数量（非正整数）抛错或返回拒绝语义；
- `calculateTotal`：`discountPercent >= 100` 时整行免费（超过 100% 同样免费），不得产生负金额；
- `fulfillOrder`：库存不足/未知商品/非法数量时返回
  `{ fulfilled: false, orderId, error: <信息> }`（或抛错由调用方处理），不得返回 `fulfilled: true`；
  **多行订单必须具备原子性**：任一行失败时整个订单失败，且此前已预留的库存必须回滚（先全部校验再统一预留，或失败时逐个回滚），不允许失败订单遗留部分预留；
  **同一订单重复提交不得重复预留**（返回 duplicate 标记或拒绝均可，reserved 不得再次增加）。

## 不得判为通过

- 修改测试文件掩盖失败；
- 绕过模块（例如在测试里内联实现）；
- 重写模块结构或删除功能（如删除折扣逻辑）；
- 失败订单遗留部分库存预留（违反原子性）；
- 接受零/负数量导致负分配，或重复订单重复预留。
