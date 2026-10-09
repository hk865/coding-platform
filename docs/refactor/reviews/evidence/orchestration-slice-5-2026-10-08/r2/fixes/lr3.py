# LR3: the record tool's pin pre-read that THROWS also consults the replay entry (python3 -I lr3.py <copy-root>)
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / 'src/core/agent-runtime/communication-tools.ts'
s = p.read_text(encoding='utf-8')
old = """                const read = pinReader === undefined
                  ? await decisions.readDecisionAnswer(context, { source: messageSource })
                  : await pinReader.call(decisions, context, { source: messageSource });
                if (read.status !== 'ready') {"""
new = """                const preRead = () => (pinReader === undefined
                  ? decisions.readDecisionAnswer(context, { source: messageSource })
                  : pinReader.call(decisions, context, { source: messageSource }));
                let read: Awaited<ReturnType<typeof preRead>>;
                try {
                  read = await preRead();
                } catch (error) {
                  // Lead LR3 (§8.2 line 1366): a pre-read that throws is a read
                  // failure too; it must not hide the original receipt below.
                  read = { status: 'rejected', code: 'unavailable',
                    reason: `the decision answer pre-read failed: ${error instanceof Error ? error.message : String(error)}` };
                }
                if (read.status !== 'ready') {"""
assert s.count(old) == 1, s.count(old)
p.write_text(s.replace(old, new), encoding='utf-8')
print('LR3 applied to', p)
