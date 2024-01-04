#!/usr/bin/env -S pkgx +git-scm.org python

import argparse
import os
import subprocess
import venv
import logging

def run(cmd_array):
    logging.debug("+{}".format(" ".join(cmd_array)))
    subprocess.run(cmd_array, check=True)

def delete_empty_dirs(directory):
  # list all files and directories in the current directory
  contents = os.listdir(directory)

  # recursively check all subdirectories for emptiness
  for item in contents:
    path = os.path.join(directory, item)
    if os.path.isdir(path):
      delete_empty_dirs(path)  # recursively check subdirectory
    else:
      return  # exit if a non-empty file is found

  # if we reach here, all subdirectories are empty; delete the current directory
  os.rmdir(directory)

def main():
    parser = argparse.ArgumentParser(description='')
    parser.add_argument('executable', help='Executable')
    parser.add_argument('--extra', nargs='*', default=[], help='Adds a PEP 508 optional dependencies (aka extras)', action='extend')
    parser.add_argument('--requirements-txt', help='uses requirements.txt', action='store_const', const=True, default=False)
    parser.add_argument('--no-binary', help='passes --no-binary to pip', action='store_const', const=True, default=False)
    args = parser.parse_args()

    cmd_name = os.path.basename(args.executable)
    prefix = os.path.dirname(os.path.dirname(args.executable))
    version = os.path.basename(prefix)
    virtual_env = os.path.join(prefix, "venv")

    logging.debug("Creating {}".format(virtual_env))

    venv.create(virtual_env, with_pip=True, symlinks=True)

    # setup tools requires a git version typically
    srcroot = os.environ["SRCROOT"]
    logging.debug("+cd {}".format(srcroot))
    os.chdir(srcroot)
    run(["git", "init"])
    run(["git", "config", "user.name", "pkgx[bot]"])
    run(["git", "config", "user.email", "bot@pkgx.dev"])
    run(["git", "commit", "-m", "nil", "--allow-empty"])
    run(["git", "tag", "-a", version, "-m", f"Version {version}", "--force"])

    logging.debug("+cd {}".format(virtual_env))
    os.chdir(virtual_env)

    # force tmp files to be somewhere useful for debugging purposes
    # also why we have --no-clean later
    build_dir = os.path.join(srcroot, "dev.pkgx.python.build")

    logging.debug("+mkdir -p {}".format(build_dir))
    os.makedirs(build_dir, exist_ok=True)

    env = os.environ.copy()
    env["TMPDIR"] = build_dir

    if len(args.extra) > 0:
      install_name = f"{srcroot}[{','.join(args.extra)}]"
    else:
      install_name = srcroot

    pipcmd = [
      "bin/pip",
      "install",
      install_name
    ]

    if args.requirements_txt:
      pipcmd.extend(["-r", f"{srcroot}/requirements.txt"])

    if args.no_binary:
      pipcmd.extend(["--no-binary", ":all:"])

    pipcmd.extend([
      "--verbose",
      "--no-clean",
      "--require-virtualenv"
    ])

    logging.debug("+TMPDIR={} {}".format(build_dir, " ".join(pipcmd)))
    subprocess.run(
        pipcmd,
        check=True,
        env=env,
    )

    # python virtual-envs are not relocatable
    # our only working choice is to rewrite these files and symlinks every time
    # because we promise that pkgx is relocatable *at any time*
    bin_dir = os.path.join(prefix, "bin")
    logging.debug("+mkdir -p {}".format(bin_dir))
    os.makedirs(bin_dir, exist_ok=True)

    save_file = os.path.join(bin_dir, cmd_name)
    logging.debug("saving {}".format(save_file))
    # FIXME requiring sed is a bit lame
    with open(save_file, "w") as f:
        f.write(
            """#!/bin/sh

export VIRTUAL_ENV="$(cd "$(dirname "$0")"/.. && pwd)/venv"
export ARG0="$(basename "$0")"

PKGX_PYTHON="$(which python)"
PKGX_PYHOME="$(dirname "$PKGX_PYTHON")"

cat <<EOSH > "$VIRTUAL_ENV/pyvenv.cfg"
home = $PKGX_PYHOME
include-system-site-packages = false
executable = $PKGX_PYTHON
EOSH

find "$VIRTUAL_ENV"/bin -maxdepth 1 -type f | xargs \\
  sed -i.bak "1s|.*/python|#!$VIRTUAL_ENV/bin/python|"

rm "$VIRTUAL_ENV"/bin/*.bak

ln -sf "$PKGX_PYTHON" "$VIRTUAL_ENV"/bin/python

exec "$VIRTUAL_ENV"/bin/$ARG0 "$@"
"""
        )

    logging.debug("chmod 0o755 {}".format(save_file))
    os.chmod(save_file, 0o755)

    # usually empty and thus lets delete it
    delete_empty_dirs(os.path.join(virtual_env, "include"))

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    main()
