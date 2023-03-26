#!/bin/sh

set -e

if ! command -v git >/dev/null; then
  GIT="tea git"
else
  GIT=git
fi

if ! d="$($GIT rev-parse --show-toplevel 2>/dev/null)"; then
  echo "tea.xyz/brewkit: error: cwd is not inside a git repo" >&2
  exit 1
fi

if ! test -d "$d"/projects; then
  echo "tea.xyz/brewkit: error: cwd is not a pantry" >&2
  exit 2
fi

# sadly we seemingly need to reference origin/main
DIVERGENCE_SHA="$($GIT merge-base HEAD origin/main)"
CHANGED_FILES="$($GIT diff --name-only "$DIVERGENCE_SHA") $($GIT status --untracked-files --porcelain)"

OUTPUT=""

for CHANGED_FILE in $CHANGED_FILES; do
  PROJECT=$(echo "$CHANGED_FILE" | sed -n 's#projects/\(.*\)/package\.yml$#\1#p')
  if test -z "$PROJECT"
  then
    true # noop
  elif test "$1" = "--print-paths"; then
    OUTPUT="$OUTPUT\n$CHANGED_FILE"
  else
    OUTPUT="$OUTPUT\n$PROJECT"
  fi
done

# shellcheck disable=SC2046
echo $(echo $OUTPUT | sort | uniq)
