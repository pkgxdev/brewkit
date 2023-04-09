#!/usr/bin/env tea

#---
# dependencies:
#   git-scm.org: ^2
#   # ^^ required to set version tag used by setup tools
#---

import argparse
import os
import subprocess
import venv
import logging

def run(cmd_array):
    logging.debug("+{}".format(" ".join(cmd_array)))
    subprocess.run(cmd_array, check=True)


def main():
    parser = argparse.ArgumentParser(description='')
    parser.add_argument('executable', help='Executable')
    parser.add_argument('optionals', nargs='?', default=None, help='Optional dependencies')
    args = parser.parse_args()

    cmd_name = os.path.basename(args.executable)
    prefix = os.path.dirname(os.path.dirname(args.executable))
    version = os.path.basename(prefix)
    optional_deps = os.environ.get("OPTIONAL_DEPS", "")
    virtual_env = os.path.join(prefix, "venv")

    logging.debug("Creating {}".format(virtual_env))

    venv.create(virtual_env, with_pip=True)

    # setup tools requires a git version typically
    srcroot = os.environ["SRCROOT"]
    logging.debug("+cd {}".format(srcroot)
    os.chdir(srcroot)
    run(["git", "init"])
    run(["git", "config", "user.name", "tea[bot]"])
    run(["git", "config", "user.email", "bot@tea.xyz"])
    run(["git", "commit", "-m", "nil", "--allow-empty"])
    run(["git", "tag", "-a", version, "-m", f"Version {version}", "--force"])

    logging.debug("+cd {}".format(virtual_env)
    os.chdir(virtual_env)

    # force tmp files to be somewhere useful for debugging purposes
    # also why we have --no-clean later
    build_dir = os.path.join(srcroot, "xyz.tea.python.build")
    logging.debug("+mkdir -p {}".format(build_dir))
    os.makedirs(build_dir, exist_ok=True)
    env = os.environ.copy()
    env["TMPDIR"] = build_dir
    if optionals in args:
        install_name = f"{srcroot}[{args.optionals}]"
    else:
        install_name = srcroot
    pipcmd = [
        "bin/pip",
        "install",
        install_name,
        "--verbose",
        "--no-clean",
        "--require-virtualenv",
    ]
    logging.debug("+TMPDIR={} {}".format(build_dir, " ".join(pipcmd)))
    subprocess.run(
        pipcmd,
        check=True,
        env=env,
    )

    # python virtual-envs are not relocatable
    # our only working choice is to rewrite these files and symlinks every time
    # because we promise that tea is relocatable *at any time*
    bin_dir = os.path.join("..", "bin")
    logging.debug("+mkdir -p {}".format(bin_dir))
    os.makedirs(bin_dir, exist_ok=True)

    save_file = os.path.join(bin_dir, cmd_name)
    logging.debug("saving {}".format(save_file))
    # FIXME requiring sed is a bit lame
    with open(save_file, "w") as f:
        f.write(
            f"""#!/bin/sh

export VIRTUAL_ENV="$(cd "$(dirname "$0")"/.. && pwd)/venv"
export ARG0="$(basename "$0")"

TEA_PYTHON="$(which python)"
TEA_PYHOME="$(dirname "$TEA_PYTHON")"

cat <<EOSH > "$VIRTUAL_ENV/pyvenv.cfg"
home = $TEA_PYHOME
include-system-site-packages = false
executable = $TEA_PYTHON
EOSH

find "$VIRTUAL_ENV"/bin -maxdepth 1 -type f | xargs \\
  sed -i.bak "1s|.*|#!$VIRTUAL_ENV/bin/python|"

rm "$VIRTUAL_ENV"/bin/*.bak

ln -sf "$TEA_PYTHON" "$VIRTUAL_ENV"/bin/python

exec "$VIRTUAL_ENV"/bin/$ARG0 "$@"
"""
        )

    logging.debug("chmod 0o755 {}".format(save_file))
    os.chmod(save_file, 0o755)


if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    main()
