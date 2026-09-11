"""Fail-closed Linux terminal sandbox. Restrictions precede Bash and cover descendants."""
import ctypes
import os
import platform
import sys

if platform.machine() != 'x86_64':
    sys.exit('受限终端当前需要 Linux x86_64')
libc = ctypes.CDLL(None, use_errno=True)

def check(value, name):
    if value < 0:
        raise OSError(ctypes.get_errno(), name)
    return value

abi = libc.syscall(444, 0, 0, 1)
if abi < 6:
    sys.exit('内核缺少所需隔离能力，未启动 Shell')
root, scratch, node_runtime = map(os.path.realpath, sys.argv[1:4])
if root == '/' or not os.path.isdir(root) or not os.path.isdir(scratch):
    sys.exit('无效的项目隔离目录')
os.closerange(3, 4096)

class Ruleset(ctypes.Structure):
    _fields_ = [('fs', ctypes.c_uint64), ('net', ctypes.c_uint64), ('scoped', ctypes.c_uint64)]

class PathRule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('access', ctypes.c_uint64), ('fd', ctypes.c_int32)]

read = (1 << 0) | (1 << 2) | (1 << 3)
all_fs = (1 << 16) - 1
rules = Ruleset(all_fs, 3, 3)
fd = check(libc.syscall(444, ctypes.byref(rules), ctypes.sizeof(rules), 0), 'create Landlock ruleset')

def allow(path, rights):
    if not os.path.exists(path):
        return
    path_fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
    try:
        if not os.path.isdir(path):
            rights &= (1 << 0) | (1 << 1) | (1 << 2) | (1 << 14) | (1 << 15)
        attr = PathRule(rights, path_fd)
        check(libc.syscall(445, fd, 1, ctypes.byref(attr), 0), 'add Landlock path')
    finally:
        os.close(path_fd)

# The actual project and a private scratch directory are the only writable trees.
write = all_fs & ~((1 << 6) | (1 << 11))  # Never permit device creation.
allow(root, write)
allow(scratch, write)
for path in ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/proc', '/sys/devices/system/cpu', node_runtime]:
    allow(path, read)
for path in ['/dev/null', '/dev/zero', '/dev/tty', '/dev/urandom', '/dev/random']:
    allow(path, (1 << 1) | (1 << 2) | (1 << 15))
check(libc.prctl(38, 1, 0, 0, 0), 'no_new_privs')
check(libc.syscall(446, fd, 0), 'enforce Landlock')
os.close(fd)

# Deny network/Unix sockets, ptrace, namespace/mount escape, and io_uring.
# This x86_64 filter also rejects x32 ABI syscall encodings.
class Filter(ctypes.Structure):
    _fields_ = [('code', ctypes.c_ushort), ('jt', ctypes.c_ubyte), ('jf', ctypes.c_ubyte), ('k', ctypes.c_uint32)]
class Program(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ushort), ('filters', ctypes.POINTER(Filter))]
blocked = [41, 101, 165, 166, 246, 248, 249, 250, 272, 298, 303, 304, 308, 310, 311, 313, 321, 323, 425, 426, 427]
items = [Filter(0x20, 0, 0, 4), Filter(0x15, 1, 0, 0xC000003E), Filter(0x06, 0, 0, 0x80000000), Filter(0x20, 0, 0, 0), Filter(0x45, 0, 1, 0x40000000), Filter(0x06, 0, 0, 0x00050001)]
for syscall in blocked:
    items.extend([Filter(0x15, 0, 1, syscall), Filter(0x06, 0, 0, 0x00050001)])
items.append(Filter(0x06, 0, 0, 0x7FFF0000))
array = (Filter * len(items))(*items)
program = Program(len(items), array)
check(libc.prctl(22, 2, ctypes.byref(program), 0, 0), 'enforce seccomp')
os.environ['TMPDIR'] = scratch
os.environ['PATH'] = node_runtime + '/bin:/usr/local/bin:/usr/bin:/bin'
os.environ['HISTFILE'] = '/dev/null'
os.execv('/bin/bash', ['/bin/bash', '--noprofile', '--norc', '-i'])
