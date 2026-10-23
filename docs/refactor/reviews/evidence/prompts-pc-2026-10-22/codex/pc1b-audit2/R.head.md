# PC-1b audit 2, part R: records and the read (rework 1)

Your part is `R`: `./.lead-ref/parts/R.diff` and `R-files.txt`: `agent-runtime/runtime.ts`,
`work-graph/queries/query-execution.ts`, `work-graph/tasks/model-request-codecs.ts`, `PC-read-record-work-query`,
`A2-step1-codecs`, `B2-model-request`, `PC-query-record-*`, `PC-record-*`. Rows: R-01 … R-14 of the frozen table
(R-03 rejected; R-12's and R-13's joint parts are in part J's `PC-joint-record-and-failure`, but check their
production side here).

**Look hardest at:**

- **R-01.** Exact key sets for `toolSpecsRef` and its `source` in Work prompt validation; the nested unknown-key
  rejections for the authorization input, the permit snapshot and the event. Any other decoder of the same shapes that
  stays lax?
- **R-02.** `loadQueryManifest` decodes `promptSet` with `decodePromptSetV1`; a missing or broken set → `invalid` at
  `bindPreparedQuery`, state unchanged; tested through the public bind.
- **R-04.** `target.contentType` checked before the cache lookup. How does the test get a same-digest, same-size body
  with another content type (reply §7.5 "fault-injected body store")? Is that injection a public seam?
- **R-05.** The no-dependency runtime validates the ref and answers `unavailable`. Is the message exact?
- **R-06 … R-11, R-14.** As the rows say; R-07's expectation hand-written; R-08's mutation (count only consumed
  permits) really caught; R-09 each immutable fact alone; R-11 each field alone and the second-element case.
- **R-13 production side:** the read collects every digest the set and requests refer to, compares the `texts` key set
  exactly, then verifies each body. Is the order right (key set before body reads)? Can a set with an extra unread key
  pass?
