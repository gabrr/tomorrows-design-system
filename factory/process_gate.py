"""Exec only after the supervisor durably records process ownership.

If the supervisor crashes before opening the gate, EOF prevents an unregistered
provider from starting. exec preserves the recorded PID/start identity and group.
"""

import os
import sys


if __name__ == '__main__':
    fd = int(sys.argv[1])
    allowed = os.read(fd, 1) == b'G'
    os.close(fd)
    if not allowed:
        sys.exit(125)
    os.execvp(sys.argv[2], sys.argv[2:])
