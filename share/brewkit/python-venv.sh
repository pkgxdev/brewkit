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

TEA_PYTHON="\$(which python)"
TEA_PYHOME="\$(dirname "\$TEA_PYTHON")"

cat <<EOSH > \$VIRTUAL_ENV/pyvenv.cfg
home = \$TEA_PYHOME
include-system-site-packages = false
executable = \$TEA_PYTHON
EOSH

find "\$VIRTUAL_ENV"/bin -maxdepth 1 -type f | xargs \\
  sed -i.bak "1s|.*|#!\$VIRTUAL_ENV/bin/python|"

rm "\$VIRTUAL_ENV"/bin/*.bak

ln -sf "\$TEA_PYTHON" "\$VIRTUAL_ENV"/bin/python

exec "\$VIRTUAL_ENV"/bin/$CMD_NAME "\$@"

EOF

chmod +x ../bin/"$CMD_NAME"
