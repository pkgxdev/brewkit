#!/bin/sh

set -e

CMD_NAME=$(basename "$1")
PREFIX="$(dirname "$(dirname "$1")")"
PROJECT_NAME=$(basename "$(dirname "$PREFIX")")
VERSION=$(basename "$PREFIX")
PYTHON_VERSION=$(python --version | cut -d' ' -f2)
PYTHON_VERSION_MAJ=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_VERSION_MIN=$(echo $PYTHON_VERSION | cut -d. -f1,2)

python -m venv $PREFIX/libexec

cd "$PREFIX"

libexec/bin/pip install -v --no-binary :all: --ignore-installed $CMD_NAME
mkdir bin

cat <<EOF >bin/$CMD_NAME
#!/usr/bin/env bash
self="\${BASH_SOURCE[0]}"
LIBEXEC="\$(cd "\$(dirname "\$self")"/../libexec/bin && pwd)"
source "\$LIBEXEC/activate"
exec "\$LIBEXEC"/$CMD_NAME "\$@"
EOF
chmod +x bin/$CMD_NAME

cd libexec/bin
fix-shebangs.ts *

rm Activate.ps1 activate.csh activate.fish

sed -i.bak 's|VIRTUAL_ENV=".*"|VIRTUAL_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. \&\& pwd)"|' activate
rm activate.bak

# FIXME a lot: this "updates" the `venv` on each run for relocatability
cat <<EOF >>activate

sed -i.bak \\
  -e "s|$TEA_PREFIX/python.org/v$PYTHON_VERSION|\$TEA_PREFIX/python.org/v$PYTHON_VERSION_MAJ|" \\
  -e 's|bin/python$PYTHON_VERSION_MAJ.$PYTHON_VERSION_MIN|bin/python|' \\
  -e "s|$PREFIX/libexec|\$TEA_PREFIX/$PROJECT_NAME/$VERSION/libexec|" \\
  \$VIRTUAL_ENV/pyvenv.cfg
rm \$VIRTUAL_ENV/pyvenv.cfg.bak
EOF

for x in python*; do
  ln -sf ../../../../python.org/v$PYTHON_VERSION_MAJ/bin/$x $x
done
