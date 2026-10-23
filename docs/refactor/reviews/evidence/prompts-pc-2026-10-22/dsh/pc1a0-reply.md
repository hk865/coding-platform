# PC-1a-0 回复：只做 k1

已从冻结 map `vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js.map` 的 `sourcesContent[0]` 逐字节恢复 `vendor/coding-agent/patches/core/context/selection_policy/context-selection-policy.ts`，225 行、7864 字节，sha256 为 `291c3188be525b0ece8730ef74304ea03e153fef8db4a54b0378e2ab6c4c527d`（与 Codex 核对值一致；`.d.ts.map` 文本相同）。随后按其他受管源写法把它加入 `scripts/build-kernel-patch.mjs` 的 `relativeSources`。

`node scripts/build-kernel-patch.mjs --check` 退出码 0：16 个源、64 项产物全部 `matches: true`，其中该源的 js/js.map/d.ts/d.ts.map 四份产物均逐字相同，`dist` 未改动、未执行 `--write`。

提交 `fdfc3027dd4482893456405204d7399dcb25fe46`，仅含上述两个文件。`git status --porcelain` 无输出；`git diff --name-only pc1a-base HEAD` 只列出这两项。

无不预期情况，未跑类型检查、构建或测试，未改夹具。
