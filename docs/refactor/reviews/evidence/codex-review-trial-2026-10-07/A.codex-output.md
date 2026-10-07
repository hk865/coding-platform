One correctness defect found:

- **should-fix — [src/core/agent-runtime/continuation-brief-assembly.ts:349](src/core/agent-runtime/continuation-brief-assembly.ts:349): The unobserved interval now runs backwards.**  
  In the supported Run1 → failed checks → Run2 cancelled before entry → Run3 sequence, suppose Run1 ends at 10:00 and Run2 at 10:05. The new checkpoint 0 uses Run1’s end, but line 427 still sets `unobserved.previousEndedAt` to Run2’s end and `to: 0`. The renderer (`src/contracts/continuation-brief.ts:417`) consequently reports an unobserved window from 10:05 back to Run1’s earlier check opening. This contradicts the factual interval required by §6.1(e). Preserve the LA-10 ancestor checkpoint, but point `unobserved` at the first checkpoint following Run2’s end.

  The updated C3 test checks checkpoints and segments without asserting this interval; its Host fixture also uses a fixed clock (`tests/helpers/AG2b-collaboration-fixture.ts:266`), hiding the timestamp reversal.

No tests run; no files modified.