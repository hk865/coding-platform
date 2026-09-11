const fs=require('node:fs'); const path=require('node:path');
const dir=__dirname; const root='D:/1.project/Software/agent_learn/agent_dev/agent_platform';
let s=fs.readFileSync(path.join(dir,'3.after.md'),'utf8');
s=s.replace('### 3.2 已实现但产品入口缺失（(b)）——这是最容易读错的一类','### 3.2 模块端口与产品接线（逐项区分实现深度）');
s=s.replace('## 五、文档说“已实现”但产品够不到的地方','## 五、修订前文档容易误读的地方（本次已同步当前模块表）');
s=s.replace('### 4.3 文字层面 3 处需修正','### 4.3 原文字层面 3 处问题（本次已勘误）');
s=s.replace('**须记录的文档欠账**：','**修订前的文档欠账（本次已更新当前入口）**：');
s=s.replace('### 6.4 建议补的两个小口子','### 6.4 两项后续状态');
s=s.replace('2. 重组后补一次带新身份的文档口径更新（见 6.1 的文档欠账）。','2. 重组后的身份口径已在本次文档准确性修订中更新，历史身份仍保留为各批次记录。');
s=s.replace('重组把 181 个文件迁移到 12 个 Module 目录、重写了 173 个文件的相对 import 路径','迁移清单有 181 行、180 个唯一迁移路径（含一条重复记录），并改写相关 import；详细数量口径见重组独立复核');
fs.writeFileSync(path.join(dir,'3.after.md'),s);
const record=`# 2026-09-10 文档准确性修订

依据：用户要求先修正文档准确性，再选择下一项项目。范围为当前状态、交接、进度审计勘误及历史接续材料的时点提示；产品规范、源码、技术选型与实施优先级不变。

## 变更与依据

- human/module-status.md：增加供选题的剩余义务表；当前身份使用744/f362…并说明排除项，旧747/739/730等归入历史批次。按真实能力范围调整图示，保留反馈规划、返工和架构入口的核心缺口；Query、WorkspaceReader、初始角色消费者标部分接通。
- IMPLEMENTATION-HANDOFF.md：补重组后的当前身份与当前委托，旧验收保留原时点。
- 2026-09-10-progress-audit.md：修正一律改黄、MigrationGate实现分类、副作用处置与对账混用、允许依赖等同实际接线的推论；撤回未经依赖证明的必定实施排序。原审计实跑归属保留。
- 2026-09-09-architecture-rebuild/core-continuation.md：保留历史正文，顶部注明工具轮次/Reviewer已验收与checkPorts因果勘误，防止旧建议再次触发实现。

源码依据：app/service.ts的真实查询分派和verification覆盖；harness/persistent-harness.ts的verificationOverride与inspect端口；verification-engine/migration-gate-port.ts的守卫后unsupported；contracts/goal-phase.ts的识别/阻断/记录与处置资格；context-compiler/runtime-context.ts的长期Context缺口。PRODUCT、ARCHITECTURE、Module/Interface的行为要求不因本次状态勘误改变，未调整Ticket或产品验收标准。

## 验证与边界

修订前后文件、条件写入清单、744文件源码身份核对及文档检查日志保存在产品根 evidence/2026-09-10-doc-accuracy/。本次不复跑全仓或浏览器，不声称浏览器环境问题已修复；引用原审计WSL结果时保留原运行者归属。历史归档与验收日志未改动。

下一项实施尚待用户选择；文档无相关技术选型时，主Agent汇总子Agent问题先询问用户，不自行决定依赖该选型的实现。
`;
const target=root+'/dev_docs/verification/2026-09-10-doc-accuracy.md';
if(fs.existsSync(target)) throw Error('Unexpected existing report');
fs.writeFileSync(path.join(dir,'4.after.md'),record);
const changes=JSON.parse(fs.readFileSync(path.join(dir,'changes.json'),'utf8'));
changes.push({target,beforeSha256:null,staged:path.join(dir,'4.after.md')});
fs.writeFileSync(path.join(dir,'changes.json'),JSON.stringify(changes,null,2));
