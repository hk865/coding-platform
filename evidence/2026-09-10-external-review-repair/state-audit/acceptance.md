# 原修复批次最终状态核对结论

2026-09-10：**按原限定范围接受**。这不是整个产品完成；DEF-17产品恢复入口已另票完成[验收](../../2026-09-10-def17/acceptance.md)。

- 本次开始时739文件全部与 `final/final-source-sha256.json` 一致，摘要 `5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364`；机器结果见 [initial-state-audit.json](initial-state-audit.json)。现有全仓253文件/1641项与浏览器23项日志内容已核实；它们属于原修复身份，不是DEF-17验证。旧日志无单独的开始/结束清单，身份绑定强度不应超过原执行记录。
- 原独立报告先审11b6身份；完整旧清单未取得，本次按REV列表与冻结candidate差异有界补审，不声称恢复了完整11b6→5a9e差异集合。范围与不可证明项见 [独立核对](independent-state-audit.md)。
- SA-01补测：合法只读材料到真实 `runtime.start`，关闭执行器拒绝落为crashed；同catch无法证明未启动时保持unknown。新文件及原两回归共3文件/5项通过，0 skipped，[日志](prestart-coverage.log)。旧第二例实际覆盖材料拒绝，原测试与日志保留。
- SA-02：真实 `node dist/app/server.js` 默认CLI未传factory fixture选项，独立临时工作区样例任务started=1/completed=1/failures=[]，[日志](default-cli-smoke-isolated.log)。首轮10秒内未就绪日志保留；其原因没有由该日志独立证明，不归咎为产品断言或环境结论。
- SA-03：旧catch写法独立注入1 passed/1 skipped，[日志](r4-prefix-skip.log)；该实验位于evidence、不是跳过产品测试。原postfix日志证明FAIL，但其中pre-fix分支未注册，不能称同次运行证明SKIP。
- 三项补证经未参与实现者[独立复核](supplement-review.md)确认。新测试最初编写错误日志保留，非产品或环境故障；未跳过或放宽产品断言。
- E-1恢复文件与Git blob均为19161字节、SHA256 `00dfc41f9fe04e8156b2279dd1d213b416894d1ea7ea693dcc663fef655cd8fa`，与历史清单精确匹配。Git对象无时间戳，历史清单未跟踪，产生时间仍不可独立证明。缺失的reviewer-work修复前字节也未重建。

状态入口旧全文冻结于 [history](history/)。当前Ticket、模块状态、原验收与产品交接统一链接本结论。原批保留DEF-01…16、ENV边界；DEF-17依据用户当前委托另票受理。DEF-17已另行冻结747文件/c399…ac61并完成适用全仓、浏览器、类型、构建、边界及文档检查；原739清单不覆盖或替代。
