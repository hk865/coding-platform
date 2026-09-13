# 缺陷记录

冻结快照当前没有开放产品缺陷。此前有界审查发现并由单owner修正：

| ID | 原问题 | 独立关闭依据 |
|---|---|---|
| M06-R01 | View漏budget-exhausted终态 | 冻结view测试11例与共享terminal helper |
| M06-R02 | 仅canonical引用先占后继，未正文/授权验读 | frozen生产可信观察+原子前缀；缺正文/撤权/CAS负例；独立真实source见证 |
| M06-R03 | source瞬时unknown映射stale跳过较早候选 | 独立真实ENOENT，整轮unavailable，无winner；恢复首选 |
| M06-R04 | 未消费观察跨调用残留 | 随机token+dispose/finally，独立registry生命周期与并发隔离复验 |

此前exact revoked+其他宽grant组合审查反馈也已修改并独立复验。旧失败保留于review/current-01至03及implementation/continuation-01；未在验收中私修源码或放宽断言。
