只读核对，未写文件、未运行测试。

- **line 已修复**：`c1-g1` 仅在 [line-settings-service.ts:89](D:/cxt/c1-g2-review2/.lead-ref/g1base/src/core/work-graph/configuration/line-settings-service.ts:89) 显式取一次 `expected[0]`，随后复用该 pin。返工恢复此行为，包括上轮 getter 反例：原版与返工版均提交。
- **读取次数需区分**：指纹序列化还通过 [fingerprint.ts:43](D:/cxt/c1-g2-review2/src/contracts/fingerprint.ts:43) 的 `map` 读取元素。因此，长度为 1、走到版本比较的路径中，原版 line／decision 的显式索引次数为 **1／2**，实际 getter 次数为 **2／3**；返工后分别为 **1／1、2／2**。
- **注释通过**：[session-directory.ts:13](D:/cxt/c1-g2-review2/src/core/work-graph/sessions/session-directory.ts:13)、[同文件:939](D:/cxt/c1-g2-review2/src/core/work-graph/sessions/session-directory.ts:939) 与当前实现一致；[同文件:338](D:/cxt/c1-g2-review2/src/core/work-graph/sessions/session-directory.ts:338) 的注释与 `c1-g1` **522 字节完全相同**。本次涉及的历史标签已清除，未新增；规则和理由保留。所给 diff 为 9 文件、+31/−26，未见白名单外文件或其他行为变化。

| 分类 | file:line | 发现与修法 |
|---|---|---|
| **会出错** | [decision-settings-service.ts:145](D:/cxt/c1-g2-review2/src/core/work-graph/configuration/decision-settings-service.ts:145) | `c1-g1` 在 [旧版:70](D:/cxt/c1-g2-review2/.lead-ref/g1base/src/core/work-graph/configuration/decision-settings-service.ts:70) 取 pin 校验，读完 Workspace 后又在 [旧版:207](D:/cxt/c1-g2-review2/.lead-ref/g1base/src/core/work-graph/configuration/decision-settings-service.ts:207) 按长度重新取 pin 比较。返工改为复用首次 pin，**并非对所有输入等价**。沿用上轮 getter：首次返回 revision=1，此后返回 revision=2；当前 Workspace revision=1、无回执、有效 token、`seenThrough={}`，其余条件有效时，**原版返回 `revision_conflict`，返工版提交**。修法：line 保留捕获结果；decision 校验成功仍包装为 `null`，并在原位置恢复 `expected.length === 1 ? expected[0] : undefined` 及原比较。同步修改“不再重读”的注释。我上轮将禁止重读的建议扩展到 decision，不准确。 |

会出错 1 项，不整洁 0 项。