#!/usr/bin/env -S pkgx +git-scm.org bash

set -eo pipefail

CMD_NAME=$(basename "$1")
PREFIX="$(dirname "$(dirname "$1")")"
VERSION="$(basename "$PREFIX")"

export VIRTUAL_ENV="$PREFIX"/venv

python -m venv "$VIRTUAL_ENV"

# setup tools requires a git version typically
cd "$SRCROOT"
git init
git config user.name 'pkgx[bot]'
git config user.email 'bot@pkgx.dev'
git commit -mnil --allow-empty
git tag -a "$VERSION" -m "Version $VERSION" --force

cd "$VIRTUAL_ENV"

# force tmp files to be somewhere useful for debugging purposes
# also why we have --no-clean later
mkdir -p $SRCROOT/dev.pkgx.python.build

TMPDIR=$SRCROOT/dev.pkgx.python.build \
  bin/pip install \
    "$SRCROOT" \
    --verbose \
    --no-clean \
    --require-virtualenv

# python virtual-envs are not relocatable
# our only working choice is to rewrite these files and symlinks every time
# because we promise that pkgx is relocatable *at any time*

"$(dirname "$0")"/python-venv-stubber.sh "$CMD_NAME"
