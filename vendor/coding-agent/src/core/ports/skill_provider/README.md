# Skill Provider Port

`skill-provider-port.ts` 定义按显式 ID 选择 `SkillContext` 的可取消接口。请求和返回值都经过 strict
schema，结果必须稳定排序并保留来源。

Port 不定义资源文件格式、目录扫描或工具执行。Skill 只能作为 Context 数据，不能授予 Permission；当前实现由
`FileSkillLoader` 加载，再由 `SkillRegistry` 提供选择。
