# Inventory for the structure-round task book: B1 (bounded codec-generation pilot)

$(COMMON)

## B1 (row in `./.lead-ref/d84-condensed.md`; decision 70 item 3 in HANDOFF, search "按格式描述生成编解码")

The knowledge of one event protocol's format is spread over its type, decode pipeline, body checks and
registration; three existing pipelines (then `decision-record-codecs.ts:64`, `:84`, `line-settings-codecs.ts:56`).
Pilot: for **2 decision events and 1 line-settings (pinned) event only**, describe each format once and derive the
codec from the description; afterwards the lead decides whether to extend it (later slices add about 12 record kinds).
Behaviour-identical: same accepted inputs, same rejection results and texts in the same order, same encoded bytes.

## Answer

1. Which two decision events and which line-settings event fit best, with their current type, encoder, decoder,
   body checks and registration (`file:line` each), and the exact order and texts of every rejection each decoder
   can return today.
2. Two or three concrete designs (for example: a runtime table of field descriptors interpreted by one generic
   decoder; a declarative schema plus small hand-written hooks; build-time generation). For each: what the
   description looks like for one of the pilot events (write it out), how it reproduces today's rejection order and
   texts exactly, how encoding keeps the same JSON bytes (key order, omitted vs null fields), how the types stay
   exact for callers, the lines added and deleted, and what it would cost to add one new record kind later.
   Recommend one, with reasons.
3. Tests that pin today's decode results and texts (file and test name), and gaps where a difference would go unseen;
   whether any test imports a symbol that would move.
4. Files touched; overlap with SC's files and with D3, D2, C2, C1, A6 (see `./.lead-ref/d84-condensed.md`).
5. Risks; anything that cannot be identical without a test change.

End with a last line exactly: `选的事件 N 个，方案 N 种，推荐 <名字>，估计行数 N–N，风险 N`
