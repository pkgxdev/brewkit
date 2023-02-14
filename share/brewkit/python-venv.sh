#!/bin/sh

#---
# dependencies:
#   gnu.org/coreutils: '*'
#---

#TODO no need to make a sub-dir, just make what we got the v-env

set -ex

CMD_NAME=$(basename "$1")
PREFIX="$(dirname "$(dirname "$1")")"
PROJECT_NAME=$(basename "$(dirname "$PREFIX")")
VERSION=$(basename "$PREFIX")
PYTHON_VERSION=$(python --version | cut -d' ' -f2)
PYTHON_VERSION_MAJ=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_VERSION_MIN=$(echo $PYTHON_VERSION | cut -d. -f2)

python -m venv "$PREFIX"

cd "$PREFIX"/bin

./pip install $CMD_NAME

for x in *; do
  if test $x != $CMD_NAME -a $x != python; then
    rm $x
  fi
done

mkdir ../libexec
mv $CMD_NAME ../libexec/${CMD_NAME}

# python virtual-envs are not relocatable
# our only working choice is to rewrite these files and symlinks every time
# because we promise that tea is relocatable *at any time*

cat <<EOF > $CMD_NAME
#!/bin/sh

export VIRTUAL_ENV="\$(cd "\$(dirname "\$0")"/.. && pwd)"

cat <<EOSH > \$VIRTUAL_ENV/pyvenv.cfg
home = \$TEA_PREFIX/python.org/v$PYTHON_VERSION_MAJ/bin
include-system-site-packages = false
executable = \$TEA_PREFIX/python.org/v$PYTHON_VERSION_MAJ/bin/python
EOSH

sed -i.bak "1s|.*|#!\$VIRTUAL_ENV/bin/python|" "\$VIRTUAL_ENV"/libexec/$CMD_NAME

ln -sf "\$TEA_PREFIX"/python.org/v$PYTHON_VERSION_MAJ/bin/python "\$VIRTUAL_ENV"/bin/python

exec "\$VIRTUAL_ENV"/libexec/$CMD_NAME "\$@"

EOF

chmod +x $CMD_NAME
