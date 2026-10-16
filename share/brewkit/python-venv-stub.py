#!/usr/bin/env python

import fcntl
import glob
import os
import sys

# Determine directories and paths
script_dir = os.path.dirname(os.path.realpath(__file__))
virtual_env = os.path.normpath(os.path.join(script_dir, '..', 'venv'))
arg0 = os.path.basename(sys.argv[0])
python_path = sys.executable
python_home = os.path.dirname(python_path)

# Virtualenvs are not relocatable, so the stub still rewrites them when the
# interpreter moves. Concurrent runs of an already-correct venv must not write.
pyvenv_cfg_path = os.path.join(virtual_env, 'pyvenv.cfg')
python_symlink = os.path.join(virtual_env, 'bin', 'python')
expected_cfg = (
    f"home = {python_home}\n"
    "include-system-site-packages = false\n"
    f"executable = {python_path}\n"
)
new_first_line = b"#!" + python_symlink.encode('utf-8') + b"\n"


def cfg_values(text):
    return dict(l.split(' = ', 1) for l in text.splitlines() if ' = ' in l)


def same_path(a, b):
    return os.path.realpath(a) == os.path.realpath(b)


# a relocated pkg keeps its interpreter, but its shebangs name the old venv path
def stale_shebang(filepath):
    if not os.path.isfile(filepath) or os.path.islink(filepath):
        return False
    with open(filepath, 'rb') as f:
        if f.read(2) != b'#!':
            return False
        first_line = b'#!' + f.readline()
    return first_line.strip().endswith(b"python") and first_line != new_first_line


def bin_files():
    return glob.glob(os.path.join(virtual_env, 'bin', '*'))


# compare resolved paths so v3 vs v3.12.1 spellings of one interpreter don't churn
def venv_is_current():
    try:
        with open(pyvenv_cfg_path, 'r') as f:
            cfg = cfg_values(f.read())
        return (
            same_path(cfg['home'], python_home)
            and same_path(cfg['executable'], python_path)
            and cfg.get('include-system-site-packages') == 'false'
            and same_path(python_symlink, python_path)
            and not any(stale_shebang(x) for x in bin_files())
        )
    except (OSError, KeyError):
        return False


# Nothing is ever created beyond what a venv already holds, so everything is
# rewritten in place. That is safe because rewrites hold the lock and the
# symlink is removed first and recreated last: until it is back, every
# unlocked caller sees "not current" and waits on the lock.
def rewrite_shebang(filepath):
    if not stale_shebang(filepath):
        return
    with open(filepath, 'rb+') as f:
        f.readline()
        rest_of_file = f.read()
        f.seek(0)
        f.write(new_first_line + rest_of_file)
        f.truncate()


def rewrite_venv():
    if os.path.lexists(python_symlink):
        os.remove(python_symlink)

    with open(pyvenv_cfg_path, 'w') as f:
        f.write(expected_cfg)

    for filepath in bin_files():
        rewrite_shebang(filepath)

    os.symlink(python_path, python_symlink)


if not venv_is_current():
    # lock the existing bin/ dir rather than a file: nothing is added to the tree
    fd = os.open(os.path.join(virtual_env, 'bin'), os.O_RDONLY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        if not venv_is_current():
            rewrite_venv()
    finally:
        os.close(fd)

# Execute the corresponding script in the virtual environment
arg0 = os.path.join(virtual_env, 'bin', arg0)

args = sys.argv[1:]
args.insert(0, arg0)
os.execv(arg0, args)
