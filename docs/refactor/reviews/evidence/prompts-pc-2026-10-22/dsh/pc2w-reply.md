# PC-2-W 回复

十个文件均先跑出 RED（对原实现 10 个用例全失败，另 10 个默认文本用例通过），再 GREEN。测试名均为 `PC2-W-<文件名> carries ... changed ...`：

- note-tool：`changed record_note description`
- project-source-tool：`changed project_source description`
- session-discovery-tools：`changed find_related_sessions description`
- communication-tools：`changed send_session_message description`
- graph-tools：`changed look_graph description`
- whiteboard-tools：`changed description and basedOn parameter text`
- unknown-call-review-tools：`changed description and item parameter text`
- command-rerun-tools：`changed description and command parameter text`
- exploration-tools：`changed description and prefix parameter text`
- readonly-command-tool：`changed description and command parameter text`

每个文件另有 `default texts and explicit platform texts are deep-equal`，共 20 用例。

检查：

- `tsc`：0 错误。
- `check:architecture`：通过，`next source boundaries: OK`。
- 新测试：10 文件、20 用例全过。
- 既有导入测试（`grep -rlE` 得 35 个测试文件）：33 个通过；`orchestration-mechanism` 与 `A4-duplicate-receipts` 共 5 个用例失败，原因均为 `/usr/bin/bwrap` 不存在（`run_check` `ENOENT`），在原提交上同样失败，非本次改动。
- 旧测试未改。

提交：`87f16ba PC-2 W: tool factories take platform tool texts`。

未完成文件：无。

ruling 21 与代码不合处：五个文件（note、project-source、communication、graph、session-discovery）的工具参数今天没有参数描述，平台包里 `parameters` 为空。PC-24 要求的“改一个参数字面”无法套用：默认文本下加描述会改变今天的规格；允许 pack 额外加 key 又会被 PC-25 判为 extra key。故这五个文件只测了改描述，参数部分在回复中说明。
