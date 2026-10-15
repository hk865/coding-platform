# Fixture: fork pressure for the RE1 rows (spec §7).
# Builds: a loop that forks until EAGAIN, keeps the children asleep, then
# cleans them up and prints the number that succeeded.
# Rows: RL-04.
import errno
import os
import signal
import sys
import time

children = []
while True:
    try:
        pid = os.fork()
    except OSError as error:
        if error.errno != errno.EAGAIN:
            raise
        break
    if pid == 0:
        time.sleep(30)
        os._exit(0)
    children.append(pid)

time.sleep(1)
for pid in children:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
for pid in children:
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass

print(len(children))
sys.exit(0)
