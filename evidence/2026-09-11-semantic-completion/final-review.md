# 最小语义协作闭环：独立复核

2026-09-11。复核范围为清理基线 b7fa329 之后的生产增量与新的人类选择组件；沿用已有12 Module审查，不重新审计全仓。复核者 coordination_guards 未编写本轮生产代码；其测试使用的读取 seam 均明确标注，不能当作真实模型质量或真实文件竞争证据。

## 发现、修复与反例

1. FAIL调查刷新未关联旧答案，可能让旧未受理adjust_plan永久阻塞后继。已建立精确同来源/失败集合的supersedes链，保留旧记录。仅plan变化、仅source变化、两者变化、pending阻塞、current幂等、running不重启、决定引用保留及选材均有回归：failure-feedback-renewal-2.log，16/16。
2. 只记录提案而没有人的决定时，重试可能跳过来源检查。现在只有已验证精确human决定的恢复允许历史来源；proposal-only仍查当前source及plan。feedback-decision-recovery-3.log，7/7。
3. 模型JSON为null或选项为null可能使对话组件崩溃。已检查根对象及选项字段，非法内容仍保留原文，不提供选择动作。
4. 独立Reviewer来源扩展在确认定向关系前读取无关答案，可能让同Goal其他工作的异常答案阻塞当前后继。已先用canonical提案、已接受计划及当前assignment确认答案指向，再读取并执行严格守卫。无关malformed/stale/missing答案不阻塞，已定向的缺失答案仍阻塞：failure-feedback-isolation-1.log，12/12。

另由真实兼容回归发现Reviewer mode被FAIL调查排除，现已允许完成的正式Reviewer来源；其材料只通过精确已接受返工指向后继，不将Reviewer伪装成同一Work身份。rework-drive-compat-2.log，3/3。

## 复核结论与边界

限定复验范围内，上述明确问题均已修复，没有剩余明确阻塞。模块依赖检查保持12 Module及原DAG；没有新增Control到Context/WorkspaceReader依赖。此结论不替代最终全量、浏览器、构建与源码身份验证。

当前来源在提交前和Run组装时复核，但外部文件系统与账本不是原子事务；不声称所有文件竞争都被消除。已记录决定的异常后重启测试是指定提交边界的一次异常加正常关闭重开，不是进程强杀或未知副作用恢复证明。跨工作包持续协作、动态扩大的失败集合、一般来源失效和完整架构演进不在此最小样例的完成声明内。