#!/usr/bin/env -S tea sh

#---
# dependencies:
#   git-scm.org: ^2
#   # ^^ required to set version tag used by setup tools
#---

set -ex

CMD_NAME=$(basename "$1")
PREFIX="$(dirname "$(dirname "$1")")"
VERSION="$(basename "$PREFIX")"
PYTHON_VERSION=$(python --version | cut -d' ' -f2)
PYTHON_VERSION_MAJ=$(echo "$PYTHON_VERSION" | cut -d. -f1)

export VIRTUAL_ENV="$PREFIX"/venv

python -m venv "$VIRTUAL_ENV"

# setup tools requires a git version typically
cd "$SRCROOT"
git init
git commit -mnil --allow-empty
git tag -a "$VERSION" -m "Version $VERSION"

cd "$VIRTUAL_ENV"
bin/pip install "$SRCROOT" --verbose

# python virtual-envs are not relocatable
# our only working choice is to rewrite these files and symlinks every time
# because we promise that tea is relocatable *at any time*

mkdir -p ../bin

#FIXME requiring sed is a bit lame
cat <<EOF > ../bin/"$CMD_NAME"
#!/bin/sh

export VIRTUAL_ENV="\$(cd "\$(dirname "\$0")"/.. && pwd)/venv"

cat <<EOSH > \$VIRTUAL_ENV/pyvenv.cfg
home = \$TEA_PREFIX/python.org/v$PYTHON_VERSION_MAJ/bin
include-system-site-packages = false
executable = \$TEA_PREFIX/python.org/v$PYTHON_VERSION_MAJ/bin/python
EOSH

find "\$VIRTUAL_ENV"/bin -depth 1 -type f | xargs \
  sed -i.bak "1s|.*|#!\$VIRTUAL_ENV/bin/python|"

rm "\$VIRTUAL_ENV"/bin/*.bak

ln -sf "\$TEA_PREFIX"/python.org/v$PYTHON_VERSION_MAJ/bin/python "\$VIRTUAL_ENV"/bin/python

exec "\$VIRTUAL_ENV"/bin/$CMD_NAME "\$@"

EOF

chmod +x ../bin/"$CMD_NAME"
