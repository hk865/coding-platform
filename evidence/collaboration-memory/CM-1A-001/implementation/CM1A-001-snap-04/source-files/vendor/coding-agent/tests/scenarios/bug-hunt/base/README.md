# MiniMart 订单与库存服务

一个最小化的 Node.js 模块（ESM，零外部依赖），模拟小型电商的订单与库存计算。

## 模块

- `src/inventory.js`：库存分配与库存状态判断
- `src/order.js`：订单金额计算与订单履约

## 运行测试

```bash
node test/run-tests.mjs
```

当前测试基线：部分用例失败（这正是本任务的症状）。
