# R4a 原 Session 独立审查返修

沿用原8文件写范围及所有只读约束。主 Agent已经复跑：私有 .vite-temp 挂载解决两个跨进程启动EROFS，原Kernel全量200通过/1跳过。不可通过修改测试或放宽环境检查解决。

独立审阅发现2个实际遗漏，Sol 已补 tests/review/R4a-resume-environment.test.ts，主Agent在你当前候选运行 r4a 得14项11通过/3失败，失败如下：

1. paused虽然核对有效约束，但仍绕过 #assertCompatibleEnvironment。公共 resumeCodingAgent 同预算/沙箱，仅换 model.model 或 workspaceRoot，实际续跑了模型。应使真正执行的暂停恢复在任何正式事件/模型调用前核对原配置和原workspace。注意 Core recover 无environment时只投影paused返回状态、不执行runner，这是已有检查用法（包括本次checkpoint用例），保持此检查用法；公共恢复组合根传了environment，必须核对，不可用可选callback或无参数捷径绕过实际执行路径。等值原环境正常恢复要继续通过。
2. #selectCheckpoint 未解析 checkpoint.recoveryConstraints；v2且checksum正确的缓存被直接采纳。Turn记录是权威，新checkpoint有字段时解析已支持version并核对与Turn原约束一致；不一致/未知version可按原坏checkpoint机制跳过，再读较早可用候选或从正式事件回放。旧checkpoint无字段保持兼容，不要求补字段或重写旧正文。使用现有schema/parser/canonicalJson，不新增模块、不反向import app。新的Sol用例断言未知版本候选未被采用、状态等于事件回放；另断言缺字段旧快照仍被采用。

请修这两个缺口，更新 INTEGRATION 中实际兼容语义。不要宣称所有收紧参数都必然支持：原config一致性检查仍可能拒绝改变limits等原配置，requireEffectiveRecoveryConstraints仅证明“不放宽”，不覆盖原配置兼容要求。

运行 check.py r4a（14项）、r4a-regression、kernel-types、kernel-architecture。仅临时报告允许写 /tmp/dsh-output；报告最终也直接放最终回复，避免嵌套沙箱临时路径报告不可见。不可改冻结测试/类型/getter/工具脚本，不能新建生产文件或增加写范围。完成后主Agent再次独立验收。
