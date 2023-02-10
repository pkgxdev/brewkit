#!/bin/sh

#TODO we should ensure we are invoked via tea (to get git)

#---
# dependencies:
#   git-scm.org: ^2
#---

set -e

FOO="$(git diff --name-only @{u} --diff-filter=A) $(git ls-files . --exclude-standard --others)"

for x in $FOO; do
  BAR=$(echo "$x" | sed -n 's#projects/\(.*\)/package\.yml$#\1#p')
  if test -z "$BAR"
  then
    true # noop
  elif test "$1" = "--print-paths"; then
    echo "$x"
  else
    echo "$BAR"
  fi
done
