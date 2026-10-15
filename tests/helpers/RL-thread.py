# Fixture: thread pressure for the RE1 rows (spec §7).
# Builds: threads with a small stack blocked on an Event, until creation fails;
# prints the number created and the peak RSS, then cleans up.
# Rows: RL-05.
import sys
import threading
import time

threading.stack_size(64 * 1024)
stop = threading.Event()
threads = []
while True:
    try:
        thread = threading.Thread(target=stop.wait)
        thread.start()
        threads.append(thread)
    except (RuntimeError, OSError):
        break

peak_kib = 0
with open("/proc/self/status", encoding="utf-8") as status:
    for line in status:
        if line.startswith("VmHWM:"):
            peak_kib = int(line.split()[1])

print(f"{len(threads)} {peak_kib}")
time.sleep(1)
stop.set()
for thread in threads:
    thread.join()
sys.exit(0)
