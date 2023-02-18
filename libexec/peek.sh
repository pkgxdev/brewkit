#!/bin/sh

#TODO we should ensure we are invoked via tea (to get git)

#---
# dependencies:
#   git-scm.org: ^2
#---

set -e

if ! d=$(git rev-parse --show-toplevel 2>/dev/null); then
  echo "tea.xyz/brewkit: error: cwd is not a git repo" >&2
  exit 1
fi

if ! test -d "$d"/projects; then
  echo "tea.xyz/brewkit: error: cwd is not a pantry" >&2
  exit 2
fi

# sadly we seemingly need to reference origin/main
DIVERGENCE_SHA="$(git merge-base HEAD origin/main)"
CHANGED_FILES="$(git diff --name-only "$DIVERGENCE_SHA")"

for CHANGED_FILE in $CHANGED_FILES; do
  PROJECT=$(echo "$CHANGED_FILE" | sed -n 's#projects/\(.*\)/package\.yml$#\1#p')
  if test -z "$PROJECT"
  then
    true # noop
  elif test "$1" = "--print-paths"; then
    echo "$CHANGED_FILE"
  else
    echo "$PROJECT"
  fi
done
