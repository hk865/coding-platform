export const meta = {
  name: 't-cov-triage-claude',
  description: 'Independent Claude classification of the 795 after-T coverage candidates (decision 79-4), 25 rows per agent',
  phases: [{ title: 'Classify', detail: 'one agent per 25-row batch' }],
}

const GROUPS = args.groups // [{g, n}]
const BATCH = 25
const batches = []
for (const { g, n } of GROUPS) {
  for (let s = 1; s <= n; s += BATCH) batches.push({ g, from: s, to: Math.min(n, s + BATCH - 1) })
}
log(`${batches.length} batches over ${GROUPS.reduce((a, x) => a + x.n, 0)} rows`)

const pad = i => String(i).padStart(3, '0')
const COMMON = `Read-only coverage triage for the lead of a software project. Do NOT write, edit or create any file; do not run tests, builds or git commands that write. Answer in English.

Read first, in full: D:/cc-lead-notes/codex2/t-cov-common.md. It is the task text given to another reviewer (Codex) for the same rows; follow its background, locations, row columns and class definitions (D1, D2, U, F, G, N, 待定) exactly. Paths: after T = D:/cxt/t-docs/tree/, before T = D:/cxt/t-inv/, the lists and refs under D:/cxt/t-cov/. Work independently: do not read any Codex answer (D:/cc-lead-notes/codex2/t-cov-*.out.md).

For each row: open the code at path:line_after in the after-T tree, find which arm/function it is, trace its callers and the conditions that reach it, and decide the class with file:line evidence. For group A rows also find the before-T test (in D:/cxt/t-inv/tests) that executed the line and what T did with it (search the T items in D:/cxt/t-docs/evidence/books/t-items-*.md and t-final.json by the test file name), and say whether T's reason was right for this line. Prefer 待定 over a guess.`

const SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row: { type: 'string' },
          where: { type: 'string', description: 'path:line_after and the arm or function in a few words' },
          cls: { type: 'string', enum: ['D1', 'D2', 'U', 'F', 'G', 'N', '待定'] },
          reason: { type: 'string', description: 'with file:line' },
          proposal: { type: 'string' },
          before_test: { type: 'string', description: 'group A only: the before-T test file:line and the T item that removed or changed it; else empty' },
          t_reason_wrong: { type: 'boolean', description: 'group A only: true when T deleted the only test of reachable behaviour for a wrong reason' },
        },
        required: ['row', 'where', 'cls', 'reason', 'proposal', 'before_test', 't_reason_wrong'],
      },
    },
  },
  required: ['rows'],
}

phase('Classify')
const out = await parallel(batches.map(b => () =>
  agent(`${COMMON}\n\nYour rows: ids ${b.g}-${pad(b.from)} to ${b.g}-${pad(b.to)} of D:/cxt/t-cov/lists/list-${b.g}.tsv (the first column is the row id; the file has a header line). Return exactly one entry per row id in that range.`,
    { label: `cls:${b.g}-${pad(b.from)}`, phase: 'Classify', schema: SCHEMA })
    .then(r => ({ ...b, rows: r ? r.rows : null }))
))
const missing = out.filter(b => !b || !b.rows).map(b => b && `${b.g}-${b.from}`)
if (missing.length) log(`batches with no result: ${missing.join(', ')}`)
return { batches: out }
