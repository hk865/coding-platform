# Structure round, night 1: the frozen findings table (decision 80; lead, 2026-10-21)

Codex's read-only audit of the merge `n1-merged` (S1 `0d47938`, S2 `65891b8`, S3 `36f79b8` on `s85-base`), six parts
(`D:/cc-lead-notes/codex2/s85/n1/P1–P6.out.md`, copy `D:/cxt/s85n1`). The daily full suite on the merge: 755 files,
9,668 passed, 3 skipped (`impl/t/checks/full-s85n1.txt`), the same as at the SC merge. The lead checked each finding
against the code and the book; this table is frozen for rework 1 (at most three reworks).

| Id | Run | Class | Lead's ruling | What to do in rework 1 |
| --- | --- | --- | --- | --- |
| P1-01 | S1 | 会出错 → 建议 | Only an accessor that returns different values on each read shows it; the options are plain objects. The fix is one short-circuit that restores the base's read order, so take it. | `observed-model-run.ts:282`: compute `hasMaterialTools` as `hasRead && reviewSource && !!o.materialTools` (the base tested truthiness, `o.materialTools ? ['read_material'] : []`, base `:302`; the new code tests `!== undefined`), so `materialTools` is read only under the base's condition and with the base's test; the read inside the `additionalTools` callback stays. |
| P1-02 | S1 | 会出错 → rejected | Needs a `graphContext` getter that returns different ports on successive reads. The Runtime deps are plain objects built in the composition root; the book's rule 1 lists the observable effects (texts, orders, field presence, store reads, clock calls, stored and sent bytes), and a property read of a plain object is none of them. The proposed fix (forwarding getters) adds code for a case that cannot occur. | Nothing. |
| P2-01 | S2 | 违规 | Right: book §5.3 says "the logs and the results must be identical"; the C2 probe records calls and arguments, not what each read returned, and plain `JSON.stringify` merges a missing field with an explicit `undefined`. | Extend the C2 probe (copies only): record each wrapped call's result or thrown error and each of the four loops' returned result, serialised with key order kept and `undefined` marked (book §5.0 rule 4); rerun base twice and the rework's result once on the seven files; report. |
| P2-02 | S2 | 违规 | Right: book §5.0 rule 5. | The compare step fails when any required probe captured nothing (per probe count, both sides). |
| P2-03 | S2 | 违规 → closed by the audit | The four-row table is in Codex's answer (`P2.out.md`, lines checked against base and new); it goes into the evidence. | Nothing. |
| P3-01 | S3 | 会出错 | Right: book §5.1 ruling 3, "a required slot that is `undefined` or `''` throws". The check only covers slots the template uses. | `render-template.ts`: check every `required` slot of the template's table, with the existing empty test and error text. |
| P3-02 | S3 | 违规 → rejected | The spec P1 says "正文里不许出现别的 `{{`": a template with an unclosed or stray marker breaks the format. Throwing a plain `Error` for it is the same kind as ruling 3's four code-bug throws (unreachable with the fixed pack, no rejection result); rendering it as text would ship a broken prompt silently. | Nothing. |
| P3-03 | S3 | 违规 | Right: ruling 1, every string keeps its literal type; `mentionsTools` is generated `as string[]`. | `build-platform-prompts.mjs`: emit `mentionsTools` as a literal tuple type (`as ["propose_safer_method"]`, `as []`), so it still satisfies `string[]`; regenerate the module. |
| P4-01 | S3 | 会出错 | Confirmed: `phase: 'review'`, `items: []` renders `### 要核对的调用\n\n\n### 每条…`, the base `### 要核对的调用\n\n### 每条…` (one extra `\n`). The proposal path already prefixes its optional lines with `\n`; the review path does not. | Template `### 要核对的调用{{items}}`; the caller passes `itemLines.length === 0 ? '' : '\n' + itemLines.join('\n')`; regenerate the module and the asset hashes; prove `items: []` and `items` non-empty byte-equal to the base. |

Rework 1 touches: S1 `src/core/agent-runtime/observed-model-run.ts`; S3 `src/contracts/prompts/render-template.ts`,
`scripts/build-platform-prompts.mjs`, `src/contracts/core/prepared-execution.ts`,
`resources/prompts/platform/templates/unknown-call-review.txt`, `src/contracts/prompts/platform-pack.generated.ts`,
`runtime-assets.json`; S2's probe only (no production file).

## Rework 1 (DSH s85-R1-1021: S1 fix `c03f595`, S3 fix `b35e077`; 913 s) and its quick re-audit

Codex's quick re-audit (`codex2/s85/r1/R1.out.md`): P1-01, P2-01, P3-01, P3-03 and P4-01 fixed (Codex rebuilt the
K3 review and proposal texts from the new template, strings and code: 613 / 717 / 1,196 and 556 / 804 bytes, equal
to the base); every hunk belongs to a row; the template hash matches its raw bytes; version stays 1. One row:

| Id | Class | Lead's ruling |
| --- | --- | --- |
| R1-01 | 违规 (P2-02 not fully fixed) | Right: the compare step's required set is what base-run1 captured, so a probe that captured nothing on both sides would pass. Closed by the lead's check instead of a rework (evidence only, no production file): `probe-recover/c2-required-counts.sh` declares the eight required probes (the activity, track and timeline record ports, the calendar clock, the four loops' results) independently and counts them per round over the seven proof files: base-run1, base-run2 and result-run1 each 262 / 26 / 259 / 389 / 19 / 11 / 15 / 37, no zero, no undeclared tag (`c2-required-counts.out`). |
