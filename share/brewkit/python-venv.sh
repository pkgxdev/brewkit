#!/usr/bin/env -S tea +git-scm.org bash

set -eo pipefail

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

"$(dirname "$0")"/python-venv-stubber.sh "$CMD_NAME"
