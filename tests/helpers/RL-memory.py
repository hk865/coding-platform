# Fixture: memory pressure for the RE1 rows (spec §7).
# Builds: a 1 GiB bytearray written page by page, then held so the OOM killer
# can kill the process while the surrounding shell continues.
# Rows: RL-03, RL-03b, RL-03c.
import sys
import time

size = int(sys.argv[1]) if len(sys.argv) > 1 else 1024 * 1024 * 1024
buffer = bytearray(size)
for offset in range(0, size, 4096):
    buffer[offset] = 1
# Hold the allocation: the process only ends when the kernel kills it.
time.sleep(600)
