# PC-1b audit, part R: records and the read (rulings 26–30)

Your part is `R`: `./.lead-ref/parts/R.diff` and `R-files.txt`: `src/contracts/{query-job,dispatch}.ts`,
`src/core/work-graph/queries/**`, `src/core/work-graph/tasks/{model-call-*,model-request-codecs}.ts`,
`src/core/agent-runtime/{model-call-access,execution-contracts,ports,runtime}.ts`, `src/composition/create-platform.ts`,
and R's tests (new `tests/work-graph/PC-record-*`, `PC-query-record-*`, `tests/runtime/PC-read-record-work-query`; old
`A2-step1-codecs`, `B2-model-request`, `tests/helpers/B2-execution-fixture.ts`). The book §3.5, §4 (R's row and the
seams), §5.3 (R's lines).

**Look hardest at:**

- **Ruling 26, the sequence.** 1 + the number of this run's permits already authorized, read with ruling 28's lookup
  inside the authorization; the commit claims `model-request-sequence:<run refKey>:<sequence>` with a
  `UniqueClaimChange` (`expectedOwner: null`, `nextOwner` the permit id); a lost claim does not commit, is not
  retried, and is mapped by the service itself to `busy` with the reason "the model request sequence slot is already
  taken" (not the store's error, not the shared Kernel identity-slot text). Check the store's real answer for a lost
  claim in both stores.
- **Ruling 26, the facts.** `ActualModelRequest` and `ModelRequestPermitV1` gain `prompt`; both projections in
  `model-call-access.ts` pass the facts; the service validates them, stores them in the permit and the authorization
  event, and compares every new fact at consumption like the digests (today's mismatch outcome); the strict codecs
  accept exactly the new fields and reject unknown ones; the idempotency fingerprints include the facts; a replay with
  other facts is `idempotency_conflict` through the existing path, with no new compare path.
- **Ruling 27, Query.** The reservation writes the whole row with `admitted: false` and the facts; the admission
  compares the facts with the row and only flips `admitted`; later usage writes change only the four usage fields;
  `requestDigest`, `reservedInput`, `reservedOutput` and the facts never change; another immutable fact for the same
  `requestId` is `idempotency_conflict`; the event codec checks every element of the request list strictly. Old rows
  and events written before PC-1b: does the codec still read them, or does the book require that (§2)?
- **Ruling 28.** `ModelRequestReadPort` as the book declares it, backed by a lookup on the permit records declared like
  other WorkGraph lookups; no store scan, no Kernel history; `ModelRequestPort` stays write-only. DSH made it an
  independent factory `createModelRequestReadPort` (reply §4 item 1): does it hold, and is it reachable from the
  composition root only?
- **Ruling 29.** `readPromptRecord?` optional on `RuntimeExecutionPort`, always published by `createAgentRuntime`;
  validates the ref, authorizes the read, reads the manifest like `readContinuationBrief`; returns `set`, `requests`
  (Work permits by `sequence`, or Query rows, each with its `kind`) and `texts` (every body the set and the requests
  refer to, keyed by digest, each verified). DSH wrote a minimal `readQueryPromptSet` in `runtime.ts` instead of reusing
  the private Query loaders (reply §4 item 7): does it apply the same checks as the loaders (owner, digest,
  `decodePromptSetV1`)? Can it read another project's or another run's manifest?
- **Ruling 30.** `promptPacks?` and `modelRequestReads?` in the Runtime dependencies; the default platform source
  installed in `runtime.ts`; without `modelRequestReads`, a Work ref gives `unavailable` ("model request reads are not
  wired"), never an empty list; `create-platform.ts` passes the platform source and the real permit read.
- **The tests:** PC-09's R half, the sequence and the lost claim, the Query immutables (each immutable changed alone),
  the codec accept/reject cases (each new field malformed alone, an unknown key), `readPromptRecord` for Work and
  Query and unwired. Name a mutation each would miss.
