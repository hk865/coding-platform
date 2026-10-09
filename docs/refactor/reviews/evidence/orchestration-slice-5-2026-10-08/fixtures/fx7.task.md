# Group 7: user messages (UM) and runtime user tools (TU)

Read RULES.md first. You may change ONLY `tests/work-graph/S5-user-messages.test.ts`,
`tests/runtime/S5-user-message-tools.test.ts` and create at most ONE new helper
`tests/helpers/S5-user-message-support.ts`. The shared fixture `tests/helpers/S5-decision-fixture.ts` was just
repaired by another group (read its header and `fxA-result.md` here for the new exports). Do not edit it.

Spec: §5.3 UM rows (memory + SQLite), §5.4 / Runtime TU rows, §3.1 S5-MSG-01…06, S5-AU-04, §3.2 (duties,
operator), §2.3 (message extension, body), §2.6 (duties seam), §4.6 (user tools, response input formatter),
rules 1, 10, 12, 13 of the part-1 book.

## Findings — UM (defects 3, 11, 12, 18)

- **Duties (D3).** `UM:73` casts `{...base, duties}` `as unknown as SessionMailboxDependencies`; the field is now
  declared (`duties?: MessageDutiesFactsPort`): pass it typed, no cast; UM05 = absent `duties` (unsupported for a
  new user send) while a legacy Session notify still commits.
- **UM12 (defect 12).** It performs a real ack/replay but creates CURRENT mail at `:310` and compares with this
  execution's first result (`:324`), and `:328` treats absent and null `since` alike. Seed genuine OLD
  absent-field wire data (an old SessionMessage record and its Sent event as the pre-slice-5 codec wrote them,
  through the real codecs), ack it through the old path, compare the frozen old DTO/receipt semantics, assert
  strict ABSENCE of the new fields and of `since` in the public value (not `null`), no new claims, and replay
  allocations unchanged.
- **UM03/06/07 (defect 18).** UM03/06 must reread the stored Task (state unchanged); UM07 must identify the one
  response event (type and message) and assert allocation counters.
- **0 writes (defect 11).** `UM:82` counts submitted records/events/claims through a recorder; use the fixture's
  `storeSnapshot()` on the real store.
- UM08 (two-commit barrier) and UM11 (rereads responded@2, same operator, current pin) are fixed: keep.

## Findings — TU (defects 3, 5, 19, 33–35)

- **Duties (D3).** `TU:153` casts a guessed `duties` property: pass `duties` typed.
- **TU05 (defect 5).** Its ordinary work-run message is seeded directly as responded@1 (`TU:274–285`) and reuses
  another message's source: build a valid history (sent pending@1 through the mailbox owner from the work Run,
  then answered through the answer owner — a part-1 stub: allowed — or the fixture's coherent answered message),
  with the source of THAT message (D1). Keep TU05's expected formatted string `'用户答复\n' + canonicalJson(body)`
  unchanged, supplied once with the original inputId (rule 10).
- **TU04 (defect 19, verified `TU:355`).** `if (answer.status !== 'ready' || answer.value.body === null) return;`
  skips the formatting and input-supply assertions: require a non-null original answer body (expect it), then
  assert.
- TU06 reads through real readers (keep); TU07 is genuine (keep); TU01/03 invoke real owners with work-run
  admission (keep).
