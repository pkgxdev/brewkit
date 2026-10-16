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


def venv_is_current():
    try:
        with open(pyvenv_cfg_path, 'r') as f:
            cfg = f.read()
    except OSError:
        return False
    if cfg != expected_cfg:
        return False
    try:
        return os.readlink(python_symlink) == python_path
    except OSError:
        return False


def replace_bytes(path, data, mode=None):
    tmp = path + ".new"
    try:
        with open(tmp, 'wb') as f:
            f.write(data)
        if mode is not None:
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.lexists(tmp):
            os.remove(tmp)


def rewrite_shebang(filepath):
    if not os.path.isfile(filepath) or os.path.islink(filepath):
        return
    with open(filepath, 'rb') as f:
        first_two_chars = f.read(2)
        if first_two_chars != b'#!':
            return
        old_first_line = first_two_chars + f.readline()
        if not (old_first_line.strip().endswith(b"python") and old_first_line != new_first_line):
            return
        rest_of_file = f.read()
    replace_bytes(filepath, new_first_line + rest_of_file, os.stat(filepath).st_mode)


def rewrite_venv():
    tmp_cfg = pyvenv_cfg_path + ".new"
    try:
        with open(tmp_cfg, 'w') as f:
            f.write(expected_cfg)
        os.replace(tmp_cfg, pyvenv_cfg_path)
    finally:
        if os.path.lexists(tmp_cfg):
            os.remove(tmp_cfg)

    for filepath in glob.glob(os.path.join(virtual_env, 'bin', '*')):
        rewrite_shebang(filepath)

    tmp_link = python_symlink + ".new"
    try:
        if os.path.lexists(tmp_link):
            os.remove(tmp_link)
        os.symlink(python_path, tmp_link)
        os.replace(tmp_link, python_symlink)
    finally:
        if os.path.lexists(tmp_link):
            os.remove(tmp_link)


if not venv_is_current():
    lock_path = os.path.join(virtual_env, '.pkgx-stub.lock')
    with open(lock_path, 'a+') as lockf:
        fcntl.flock(lockf, fcntl.LOCK_EX)
        try:
            if not venv_is_current():
                rewrite_venv()
        finally:
            fcntl.flock(lockf, fcntl.LOCK_UN)

# Execute the corresponding script in the virtual environment
arg0 = os.path.join(virtual_env, 'bin', arg0)

args = sys.argv[1:]
args.insert(0, arg0)
os.execv(arg0, args)
