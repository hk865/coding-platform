# M2 材料读取事实：第二阶段实现

Astra 已完成骨架/测试中审。只实现 scope 中 material-facts-service.ts，contracts 与测试只读；先读 M2-material-read-facts-skeleton.md 全文和当前 CODE-QUALITY-GUIDELINES §2.1，再读真实材料 resolver/service/authority/source 接口。中审修正同一实例并发、取消与撤权污染，7 条测试均在真实原材料/current/source 前置成功后因 M2 unsupported 红。冻结测试不许改，缺口需报告主审。

按原任务契约复用原 MaterialService + resolver，使用本次调用独立 collector，记录实际 observed full ref/revision，重复不同版本拒绝 revision_conflict，失败 guards=[]，不造授权算法、全局屏障或第二材料状态。普通查询不被本内部事务事实接口替换。原 signal 绑定 source capture，保留取消/不可用/未知语义。所有正式 source/grant 身份与正文权限由既有 owner 维护。

中审已冻结：每条测试先走原服务当前材料链；同实例两调用实际交错且取消后可再次调用；混合版本用未撤权的独立 B；guards 去重；真实 Store CAS 撤权反例。注释只保留实现原因和边界，删除阶段一重复长篇任务抄录，代码保持可读。

检查分别运行 `python3 tools/dsh-refactor/check.py next-types` 和 `python3 tools/dsh-refactor/check.py next-material-facts next-material-readers`。仅原地写 scope 文件；不写测试/契约/组合根/B2。交付真实结果、复用点与剩余接线，不声称产品完成。DSH 全局配置/凭据与旧源码禁止改动。
