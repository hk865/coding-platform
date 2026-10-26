/**
 * Hand-written expected P7 handoff texts: the two platform template files, the
 * three handoff strings and the sha256 of each template file. Every literal is
 * copied by hand from the frozen rules; nothing here calls production rendering
 * code or imports a production constant. The templates render into the
 * secretary round's `task_round` slot, so the only slot value in these samples
 * is a placeholder the renderer inserts verbatim.
 */

/** The three handoff strings of the platform pack, keyed as the pack keys them. */
export const HANDOFF_STRINGS = {
  'handoff.understandingInstruction': 'For each goal listed below, write one understanding note with these five '
    + 'parts: status (where the goal stands), decided (what is settled), open (what is still open), next (what '
    + 'happens next) and risks (what could go wrong).',
  'handoff.briefHeading': '## Handoff brief',
  'handoff.briefTools': '细节用这些工具按需读',
} as const;

/** The committed template files, byte for byte, with no trailing newline. */
export const HANDOFF_TEMPLATE_TEXTS = {
  'handoff-write-understanding-secretary':
`## Handoff understanding

You are handing this request to the next secretary of this line. Before you answer, record the understanding the next line starts from.

{{task_round}}`,
  'handoff-brief-secretary':
`You are continuing this line. The brief below is the work this line now owns; use it before you answer.

{{task_round}}`,
} as const;

/** `sha256sum` of each committed template file, hand-written. */
export const HANDOFF_TEMPLATE_DIGESTS = {
  'handoff-write-understanding-secretary': 'd7afe976edbe02c6dd541b644b3c2b7f314bb186ff4458432e817a4fae7483c6',
  'handoff-brief-secretary': 'd9207c93fb42718ece6b1e70e3bcbb526a28c3782f4e99e680fd366ffc15b6a9',
} as const;

/** The rendered text with the constructed `task_round` value `ROUND MATERIAL`. */
export const HANDOFF_RENDERED = {
  'handoff-write-understanding-secretary':
`## Handoff understanding

You are handing this request to the next secretary of this line. Before you answer, record the understanding the next line starts from.

ROUND MATERIAL`,
  'handoff-brief-secretary':
`You are continuing this line. The brief below is the work this line now owns; use it before you answer.

ROUND MATERIAL`,
} as const;
