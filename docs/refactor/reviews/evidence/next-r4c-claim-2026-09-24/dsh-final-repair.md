局部漏洞已修，只改 `claim-service.ts`（其余 3 个生产文件本轮未动，测试未改）。

## 修复

`isCanonicalJsonValue` 现在带**逐路径 WeakSet**：进入对象/数组时 `path.add`，`try/finally` 中 `path.delete`（完成分支也移除），因此同一对象的重复共享引用不会误判为环，真正的循环立即返回 `false` 而不再无限递归。

序列化边界收进受控 catch：
- `canonicalizeRequest`：`isCanonicalJsonValue(input/expected)` + `canonicalJson(...)` 全在一个 try/catch 内；循环/深度不受支持/非 JSON → `invalid`。
- `readTaskClaim`：同样在一个 try/catch 内先 `isCanonicalJsonValue(ref)` 再 `dispatchOutboxRefKey(ref)`；非法 ref → `invalid`。

catch 只包住这两处 JSON 边界，Store 读/commit 及角色解析的异常照旧不被吞。未新增文件/接口/框架，`generation === sessionRevision` 等既有实现不变。

## 实测

- `next-types` → **PASS**
- `next-task-claim` → **7 文件 / 73 项 PASS**（新增的 `cyclic request/ref values reject at the JSON boundary without escaping the port` 通过；claimTask 与 readTaskClaim 均 `rejected/invalid`，零 commit）
- 单独 `R4c-task-claim-concurrency.test.ts` → 8/8 PASS

`claim-service.ts` 672 行（新增 21 行 WeakSet 判环与边界 catch）。按要求在此停止，交由主审做完整物理隔离测试。