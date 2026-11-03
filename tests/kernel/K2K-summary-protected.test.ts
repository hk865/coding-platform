/**
 * Slice K2 KE2 (`selectContext`): the compaction summary message is protected (slice-K2-SPEC
 * L7, row K2K-09).
 *
 * The budget B1 is the UTF-8 byte count of the request that keeps only the base prompt, the
 * summary message and the latest input, plus 4,096 and the 100-token output reserve (the PC
 * byte preview). At B1 both history exchanges go and the summary stays; at B1 - 1 the
 * protected content no longer fits.
 */
import { describe, expect, it } from "vitest";
import {
  ContextSelectionError,
  buildModelRequest,
  selectContext,
  type ContextBuilderInput,
  type ModelRequest,
} from "../../vendor/coding-agent/dist/public-api.js";
import { assistantEntry, bytePreview, contextInput, selectionOptions, userEntry } from "../helpers/PC-kernel-fixture.js";

const SUMMARY = "以下是本线更早对话的压缩摘要（压缩记录 9，覆盖到位置 7）。原记录没有删除。\n\nSUMMARY BODY";
const transcript: ContextBuilderInput["transcript"] = [
  userEntry("context-summary:s1:9", SUMMARY),
  userEntry("h1", "old question one"),
  assistantEntry("a1", "old answer one"),
  userEntry("h2", "old question two"),
  assistantEntry("a2", "old answer two"),
  userEntry("latest", "latest input"),
];

const kept: ModelRequest = {
  schemaVersion: 1,
  requestId: "pc-request",
  runId: "pc-run",
  systemPrompt: "BASE",
  messages: [
    { role: "user", messageId: "context-summary:s1:9", content: SUMMARY },
    { role: "user", messageId: "latest", content: "latest input" },
  ],
  tools: [],
  maxOutputTokens: 100,
};
const B1 = Buffer.byteLength(JSON.stringify(kept), "utf8") + 4_096 + 100;

const selection = { historyEntryCount: 5, taskInputMessageId: "latest", build: buildModelRequest } as const;

describe("K2 summary message protection (KE2 selectContext)", () => {
  it.each([
    { name: "at B1 both history exchanges go and the summary message stays", window: B1, fits: true },
    { name: "at B1 - 1 the protected content is over budget", window: B1 - 1, fits: false },
  ])("K2K-09 $name", async ({ window, fits }) => {
    const probe = bytePreview({ window, outputCap: 100 });
    const selected = selectContext(contextInput({ transcript, tokenBudget: window, maxOutputTokens: 100 }),
      selectionOptions(selection, probe.previewRequest));
    if (!fits) {
      await expect(selected).rejects.toBeInstanceOf(ContextSelectionError);
      await expect(selected).rejects.toMatchObject({ code: "required_content_over_budget" });
      return;
    }
    const result = await selected;
    expect(result.request).toEqual(kept);
    expect(result.report.removed).toEqual({
      memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
      historyExchange: 2, historyConclusion: 2, currentExchange: 0,
    });
  });
});
