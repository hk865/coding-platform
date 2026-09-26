两个缺口已修复，四项检查全绿。

## 自检结果（真实执行）

| 检查 | 结果 |
| --- | --- |
| `check.py r4a`（14 项） | **14 passed / 14**（返修前 11/14） |
| `check.py kernel-types` | **exit 0** |
| `check.py kernel-architecture` | **passed (69 source files)** |
| `check.py r4a-regression` | **46 files passed；204 passed / 1 skipped** |

## 缺口 1：paused 绕过 `#assertCompatibleEnvironment`

`src/core/runtime/recovery/recovery-coordinator.ts`：

- `recover` 收到 `environment` 时，paused 与 `willContinue` 一样在**任何对账写入与任何继续动作之前**执行原配置 + workspace 核对。生产 `resumeCodingAgentInternal` 总是传 `environment`，公共恢复路径不再存在绕过；未传 `environment` 的既有直接调用（含本次 checkpoint 用例）仍只投影 paused 状态、不执行 runner，用法未变，也没有用可选 callback 替代这条强制检查。
- paused 固定原 `RunConfigSnapshot`（含 `limits`/`modelConfigId`/`baseConfigDigest`）与 workspace identity/reference，**不比较 workspace revision**：记录值是暂停 Turn 开始前的基线，而 Session/SQLite 存储可能就在 workspace 内（`kernel-session-api` 的 `data/sessions.sqlite` 即此），本 Turn 事件落盘会让 revision 合法漂移；强制相等会使「同一原环境再次暂停恢复」必然失败（现有回归用例）。新增 `requireWorkspaceRevision` 选项，仅 paused 传 `false`；`willContinue` 仍严格比较 revision，未放宽。
- Sol 用例 1（只换 `model.model`）、用例 2（只换 `workspaceRoot`）均在零模型调用、零记录变化下 `conflict`；`kernel-session-api` 的等值原环境暂停恢复继续通过。

## 缺口 2：`#selectCheckpoint` 未解析 checkpoint 的 `recoveryConstraints`

同一文件 `#selectCheckpoint` 候选校验（Core 内，复用现有 `parseEffectiveRecoveryConstraints` + `canonicalJson`，未新增模块、未反向 import app）：

- checkpoint 带该字段时解析并与 `turn.started` 的原约束逐值比较（Turn 无证据也算不一致）；不一致、未知 version（parser 抛 `version_unsupported`）、形状非法均按既有坏 checkpoint 机制跳过，继续尝试更早候选或从正式事件回放，`turn.started` 始终权威。
- 旧 checkpoint 缺字段直接采纳，不要求补写、不改写旧正文。
- Sol 用例 3（checksum 合法但 `version: 2`）未被采用，`state` 等于纯事件回放且记录零变化；用例 4（缺字段旧快照）仍被采纳。

## INTEGRATION.md

补充了暂停恢复环境核对语义、checkpoint 一致性规则，并明确修正：`requireEffectiveRecoveryConstraints` **只证明「不放宽」**，真正执行前仍有独立的 `#assertCompatibleEnvironment` 原配置核对（`RunConfigSnapshot` 全量相等，含 `limits`），改变 `limits` 或其他原 config（即使更紧）仍可能 `conflict`；宿主应回传原 config/limits。

## 冻结文件（未修改）

```
a35e5537a3d25a77392e29ab32dec7e0dc42cba6506fe03681b8de3a014dac49  tests/review/R4a-resume-environment.test.ts (Sol)
3bf03103bf65d228e2cfc2ad22b72038dffda81b78b9e9750f7643c4dc195e36  tests/review/R4a-recovery-contract.test.ts
7f48516627458d2c21e2b49d921c249d1396b8e220ad071fd8e1098a828b7497  tests/review/independent-r4a-session-recovery.test.ts
d00448a2eaf54baff0f3fb91c602c604323599176d255dbb9902e7736487dfa2  src/app/composition/recovery-contract-types.ts
```

未覆盖：`after_tool` 暂停、block/modify/fail、native compact 保持 unsupported；paused 不检测「同 root/config、仅文件内容漂移」（留给原 `consistencyMode` 的边界检查）；未新增测试文件、未跑 build/平台 suite/付费模型。报告已写 `/tmp/dsh-output/implementation-final.md`。待主 Agent 再次独立验收。