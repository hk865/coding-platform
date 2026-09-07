# G5 Gate Evidence（2026-09-07）

> Gate 定义：G5 = P1-13（allowlisted remediation）+ P1-14（baseline activation）——"架构修复与基线演进链路"成立。
> 判定：**PASS**（两依赖票均已验收）。

## 依赖票与验收 refs

| 票 | 验收 commit | 证据 | 数字 |
| --- | --- | --- | --- |
| P1-13 允许列表修复 | fbc365e | dev_docs/verification/p1-13-implementation-evidence.md | typecheck 0；全量 154 files / 1083 tests PASS（0 skip）；双套件 9+9；writer 链 3/3 |
| P1-14 基线激活 | 685bf34（验收 main） | dev_docs/verification/p1-14-implementation-evidence.md | typecheck 0；全量 164 files / 1142 tests PASS（0 skip）；双套件 9+9；restart/evidence 1+1 |

## 成立条件核对

- P1-13：三方 governance 机制（第三类 policy）+ allowlist 判据 + remediation 去重/守卫 + 唯一 Writer(P1-07 lease)+Verification 链；ArchitectureBaseline active ref 全程不动 ✅
- P1-14：候选物化（内容寻址+源精确）→ 精确 ArchitectureChangeDecision → MigrationGate（不隐式 rebase）→ CAS 激活记录（P1-02 激活机制复用）；STALE 不激活；既有 Plan pin 不动 ✅
- 交集无冲突：P1-13 不改基线（验收 8）；P1-14 才移动基线——共享基线上零回归 ✅

## 备注

- 本地 main 未推送 GitHub（推送需用户授权）。
- G3 待 P1-07 + P1-15；G1/G2/G4 已 PASS。
