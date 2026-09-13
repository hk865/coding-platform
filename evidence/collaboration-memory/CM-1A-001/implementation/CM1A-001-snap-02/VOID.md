# snap-02：**已作废**（保留为并发交错记录，不作为验收对象）

冻结时刻：2026-09-13 ~13:26 CST。声明指纹：`sha256:3571769b363896601349a8300948453c8708c07bb7be995dfa1787ffad9c5a00`（1225 源文件）。

## 为什么要作废

我在冻结**之后**才发现当时**仍有两个工作段在写同一棵树**（`Step3 host tool chain` 与 `Implement model call evidence`），
因此这份快照抓住的是**一次写入中途的状态**：

| 证据 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **rc=2**，2 条诊断：`coordination-tool-access.ts(177,39) Cannot find name 'WorkContextBindingSnapshot'`、`(184,38) 'linked' implicitly has any type` |
| `bash scripts/test-wsl.sh tests/coordination tests/contracts tests/ledger` | rc=1：`1 failed | 21 passed (22)` 文件、`3 failed | 176 passed (179)` 用例 |
| `bash scripts/test-wsl.sh`（全量） | rc=1：`1 failed | 311 passed (312)` 文件、`3 failed | 2071 passed (2074)` 用例 |
| 失败集合 | 全部落在 `tests/coordination/coordination-capability.test.ts` 的 3 条用例（第 3 步的文件，正在被改） |
| 冻结后仍在写 | `src/contracts/coordination-tools.ts`、`src/contracts/ledger.ts`、`src/control/dispatch-engine/dispatch-engine.ts`、`src/harness/persistent-harness.ts`、`tests/coordination/coordination-capability.test.ts`、`tests/coordination/model-request-evidence-bypass.test.ts` |

## 这次暴露的制度问题（必须靠纪律解决，不能靠「我看了一眼觉得静了」）

这已是**第二次**同类事故（snap-01 的 SNAP-01 缺陷是同一机制）。两次的共同点：**我在写入未真正停止时冻结**。
因此从本文件起，冻结必须满足下面三条，缺一条就不算冻结：

1. **所有工作段都确认停止写入**（不是「我看最近没变化」）；
2. 冻结后立刻用 `node scripts/source-snapshot.mjs` **复算一次指纹并与快照文件比对**，两者必须一致；
3. 冻结后立刻跑 `npx tsc --noEmit`，**必须 rc=0**（本快照 rc=2 就是最直接的伪冻结信号）。

## 处置

- 本目录**不再更新**，也不交给独立验收 —— 交出去只会让验收方再去解释漂移（与 SNAP-01 同）。
- 待所有工作段停止写入后，生成 **snap-03**：统一脚本 + 逐文件哈希 + 与 snap-01 的 `--diff` 清单 + `tsc` rc=0 + 全量 rc=0 + 构建；
  并在交接里**如实写出「本批曾发生两次伪冻结」**与 snap-02 的作废原因。
