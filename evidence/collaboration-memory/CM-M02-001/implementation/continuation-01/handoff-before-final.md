# M02 当前实施进展

状态：实施中，尚未冻结或独立验收。输入见 adopted-source-snapshot.json 和 decision-log.md。

实现：StartQueryJob 同事务绑定原始请求、轮次与来源；Control/Ledger 两层校验；Runtime exact request inspect 只读已提交结果；恢复复用正常答案的校验和提交；无结果保留 canonical 状态、显示需对账，不重跑。需对账/活跃项不挤占 pending 扫描额度。取消先持久闭合，再通知 Runtime；准备窗口合并重复请求并记住取消。界面新增取消和恢复观察。

已跑证据：check-03 与 check-05 类型/UI类型均 0，5 文件13用例通过，包含 memory/SQLite 答案提交故障后恢复、旧记录与多轮回归、真实只读查询和活跃 writer 并行、B 输入、取消/重复/重启。check-06 增加 journal exact read/持久结果 inspect/准备取消定向，运行中；新增 Ledger cancelled 终态检查还需确认该轮及后续精确测试覆盖。01 命名冲突、02 测试缺少 focus、04 取消断言过早的失败日志保留，后续修复不覆盖原日志。

剩余：完成新检查，补充绑定篡改/恢复未知及扫描公平用例、浏览器取消/需对账，补齐归属/接口/文件差分。与 M03–M05 组合后固定源码集中回归与独立验收。当前证据不代表 M02 全票通过。
