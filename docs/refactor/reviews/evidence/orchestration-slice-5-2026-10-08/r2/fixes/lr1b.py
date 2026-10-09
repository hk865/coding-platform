# LR1 follow-up on a copy that already has the first LR1 text: keep `next` narrowed for the `after` assignment
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / 'src/core/work-graph/views/goal-conflicts.ts'
s = p.read_text(encoding='utf-8')
old_a = "      const exhausted = page.value.next === null || page.value.next === undefined;"
new_a = "      const next = page.value.next;\n      const exhausted = next === null || next === undefined;"
old_b = "      if (exhausted) break;\n      after = page.value.next;"
new_b = "      if (exhausted) break;\n      after = next;"
for o, n in ((old_a, new_a), (old_b, new_b)):
    assert s.count(o) == 1, o
    s = s.replace(o, n)
p.write_text(s, encoding='utf-8')
print('LR1b applied to', p)
