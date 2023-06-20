#!/usr/bin/env tea

#---
# dependencies:
#   git-scm.org: ^2
#   # ^^ required to set version tag used by setup tools
#---

set -ex

CMD_NAME=$(basename "$1")
PREFIX="$(dirname "$(dirname "$1")")"
VERSION="$(basename "$PREFIX")"

export VIRTUAL_ENV="$PREFIX"/venv

python -m venv "$VIRTUAL_ENV"

# setup tools requires a git version typically
cd "$SRCROOT"
git init
git config user.name 'tea[bot]'
git config user.email 'bot@tea.xyz'
git commit -mnil --allow-empty
git tag -a "$VERSION" -m "Version $VERSION" --force

cd "$VIRTUAL_ENV"

# force tmp files to be somewhere useful for debugging purposes
# also why we have --no-clean later
mkdir -p $SRCROOT/xyz.tea.python.build

TMPDIR=$SRCROOT/xyz.tea.python.build \
  bin/pip install \
    "$SRCROOT" \
    --verbose \
    --no-clean \
    --require-virtualenv

# python virtual-envs are not relocatable
# our only working choice is to rewrite these files and symlinks every time
# because we promise that tea is relocatable *at any time*

mkdir -p ../bin

#FIXME requiring sed is a bit lame
cat <<EOF > ../bin/"$CMD_NAME"
#!/usr/bin/env python

import os
import sys
import glob
import shutil
from pathlib import Path

# Determine directories and paths
script_dir = os.path.dirname(os.path.realpath(__file__))
virtual_env = os.path.normpath(os.path.join(script_dir, '..', 'venv'))
arg0 = os.path.basename(sys.argv[0])
python_path = shutil.which('python')
python_home = os.path.dirname(python_path)

# Write pyvenv.cfg file
pyvenv_cfg_path = os.path.join(virtual_env, 'pyvenv.cfg')
with open(pyvenv_cfg_path, 'w') as f:
    f.write(f"home = {python_home}\ninclude-system-site-packages = false\nexecutable = {python_path}\n")

new_first_line = b"#!" + os.path.join(virtual_env, 'bin', 'python').encode('utf-8') + b"\n"

# Go through files in the bin directory
for filepath in glob.glob(os.path.join(virtual_env, 'bin', '*')):
    if os.path.isfile(filepath) and not os.path.islink(filepath):
        with open(filepath, 'rb+') as f:
          first_two_chars = f.read(2)

          if first_two_chars == b'#!':
              old_first_line = first_two_chars + f.readline()  # Read the rest of the first line

              if old_first_line != new_first_line:
                  rest_of_file = f.read()
                  f.seek(0)
                  f.write(new_first_line + rest_of_file)
                  f.truncate()

# Create symlink to the specified Python version in the virtual environment
python_symlink = os.path.join(virtual_env, 'bin', 'python')

# Remove the symbolic link if it already exists
if os.path.exists(python_symlink):
    os.remove(python_symlink)

os.symlink(python_path, python_symlink)

# Execute the corresponding script in the virtual environment
arg0 = os.path.join(virtual_env, 'bin', arg0)
args = sys.argv[1:]
args.insert(0, arg0)
os.execv(arg0, args)
EOF

chmod +x ../bin/"$CMD_NAME"
