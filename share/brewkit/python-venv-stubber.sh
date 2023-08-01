#!/bin/sh
# python virtual-envs are not relocatable
# our only working choice is to rewrite these files and symlinks every time
# because we promise that tea is relocatable *at any time*
#FIXME requiring sed is a bit lame

if test -z "$VIRTUAL_ENV"; then
  echo "error: VIRTUAL_ENV not set" >&2
  exit 1
fi

mkdir -p "$VIRTUAL_ENV/../bin"

CMD_NAME="$1"

cat <<EOF > "$VIRTUAL_ENV"/../bin/"$CMD_NAME"
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

              if old_first_line.endswith(b"python") and old_first_line != new_first_line:
                  rest_of_file = f.read()
                  f.seek(0)
                  f.write(new_first_line + rest_of_file)
                  f.truncate()

# Create symlink to the specified Python version in the virtual environment
python_symlink = os.path.join(virtual_env, 'bin', 'python')

# Remove the symbolic link if it already exists
if os.path.islink(python_symlink) or os.path.exists(python_symlink):
    os.remove(python_symlink)

os.symlink(python_path, python_symlink)

# Execute the corresponding script in the virtual environment
arg0 = os.path.join(virtual_env, 'bin', arg0)
args = sys.argv[1:]
args.insert(0, arg0)
os.execv(arg0, args)
EOF

chmod +x "$VIRTUAL_ENV/../bin/$CMD_NAME"
