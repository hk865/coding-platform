# LR1: lookupAll — exactly `cap` items with no further page is a complete window; > 25 pages / > cap items overflow
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / 'src/core/work-graph/views/goal-conflicts.ts'
s = p.read_text(encoding='utf-8')
old1 = """    let truncated = false;
    for (;;) {"""
new1 = """    let truncated = false;
    let pages = 0;
    for (;;) {"""
old2 = """      items.push(...(page.value.records as unknown as T[]));
      if (items.length >= cap) { truncated = true; break; }
      if (page.value.next === null || page.value.next === undefined) break;
      after = page.value.next;"""
new2 = """      items.push(...(page.value.records as unknown as T[]));
      pages += 1;
      const next = page.value.next;
      const exhausted = next === null || next === undefined;
      // §4.1 line 772 / T-R2-3 (lead LR1): exactly `cap` items (or exactly the
      // page bound) with no further page is a complete window; only more items,
      // or a further page at either bound, overflows.
      if (items.length > cap || (!exhausted && (items.length >= cap || pages >= Math.ceil(cap / limit)))) {
        truncated = true;
        break;
      }
      if (exhausted) break;
      after = next;"""
for o, n in ((old1, new1), (old2, new2)):
    assert s.count(o) == 1, (o[:40], s.count(o))
    s = s.replace(o, n)
p.write_text(s, encoding='utf-8')
print('LR1 applied to', p)
