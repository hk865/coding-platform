# CM1A-001-snap-04 实施验证

冻结源码 1241 文件，指纹 f930c3efb08d9d665117ddbc974f406a09e7d98efc2f24563ef3a78f709e4a81；最终全量 315 文件 / 2113 用例通过、0 失败，类型 0 诊断、边界 issues 为空、当前构建与文档检查通过。以上是实施验证，尚无独立验收结论。

## 同一冻结源码上的结果

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| WSL 全量 bash scripts/test-wsl.sh --maxWorkers=4 | 315 文件 / 2113 用例通过；rc=0 | logs/full-delivery.log |
| 全量中 tests/coordination | 13 文件 / 111 用例通过（全量子集，不重复计数） | test-results.json |
| 修正后的定向用例 | 4 文件 / 52 用例通过 | logs/correction-targeted.log |
| 内核权限与组合入口 | 2 文件 / 14 用例通过；rc=0 | logs/kernel-delivery.log |
| tsc --noEmit | rc=0，0 诊断 | logs/typecheck-delivery.log |
| Module 边界 | rc=0，issues=[] | logs/boundaries-delivery.json |
| pnpm build | rc=0，内核/平台/UI 当前构建 | logs/build-delivery.log |
| 文档验证（文档根，WSL） | rc=0 | logs/docs-delivery.log |
| 冻结前后源码复算 | 相同 SHA256；逐文件差异为空 | source-snapshot-after.json、logs/frozen-diff.json |

## 重跑

在 WSL 产品根 /mnt/d/1.project/Software/agent_platform 使用 Node 24 工具链：

```bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
node scripts/source-snapshot.mjs
node scripts/source-snapshot.mjs --diff evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04/source-snapshot.json
pnpm build
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit
node scripts/check-module-boundaries.mjs
bash evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04/run-kernel-evidence.sh --maxWorkers=1
bash scripts/test-wsl.sh tests/coordination --maxWorkers=4
bash scripts/test-wsl.sh --maxWorkers=4
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
node dev_docs/verification/validate-docs.mjs
```

测试运行器带真实 bubblewrap sandbox preflight；不可直接以 Windows Vitest 或裸 npx vitest 替代。隔离用例写临时 SQLite/Runtime/计数目录，测试清理负责回收。

## 失败与预检记录

- continuation-04/logs 保留接续实施期间的失败与修复日志；旧快照成功数不迁移。
- logs/full.log 为被中断的非最终预检（UI 构建验证有临时写源码的探针）。
- logs/full-final.log 完整结束但 1 条模块清单测试失败；对应 pre-correction-source-snapshot.json，不能作为最终 PASS。
- logs/material-isolation-01.log 是重复 --config 参数的运行器错误，无测试启动；material-isolation-02.log 使用同一 test-wsl preflight 的隔离 wrapper，1 用例通过。随后移入 tests/coordination/material-isolation.test.ts，并由正式全量重跑。
- logs/kernel-probe-01.log 的组合测试失败来自在平台根解析 resources/skills；内核 wrapper 保留 test-wsl sandbox preflight，并进入 vendor/coding-agent 根后使用该内核的测试目录，最终 14/14 通过。
- assemble-evidence-01..07 是基线字节/行尾/Unicode 路径还原的中间诊断；最终重建严格匹配准备基线，见 preparation-reconstruction.json。

本票无真实远端 provider ack、真实模型质量、长期压测或完整浏览器业务验收声明；具体边界见 coverage.md。Gate A 与 A01–A12 独立结论仍待另一验收方。
