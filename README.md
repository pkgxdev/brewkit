![tea](https://tea.xyz/banner.png)

# BrewKit

BrewKit is build infrastructure for tea.

```sh
tea +tea.xyz/brewkit pkg build zlib.net
```

If you are inside a pantry and tea magic is installed, you can omit the `tea`
preamble and package names; BrewKit will figure out what packages you are
editing and build them.

```sh
$ pkg build
tea.xyz/brewkit: building zlib.net
```

You can build for Linux (via Docker) using `-L`, e.g.:

```sh
pkg -L build
```

## Without Magic

If you don’t have tea’s magic installed you need to explicitly add `brewkit` to
the environment:

```sh
tea +tea.xyz/brewkit pkg build
```

## Outside a Pantry Checkout

Outside a pantry checkout, you need to both ask `tea` to add `brewkit` to the
environment and specify which package to operate on. Outside a pantry checkout
we operate against your tea installation (which defaults to `~/.tea`).

```sh
tea +tea.xyz/brewkit pkg build zlib.net
```

## Additions

This repo is for tooling built on top of the tea primitives with the purpose
of generalized building and testing of open source packages.

If you have an idea for an addition open a [discussion]!

[discussion]: https://github.com/orgs/teaxyz/discussions

# Stuff That Needs to be Added

Getting the `rpath` out of a macOS binary:

```sh
lsrpath() {
    otool -l "$@" |
    awk '
        /^[^ ]/ {f = 0}
        $2 == "LC_RPATH" && $1 == "cmd" {f = 1}
        f && gsub(/^ *path | \(offset [0-9]+\)$/, "") == 2
    '
}
```

This should be added to a `pkg doctor` type thing I reckon. E.g.
`pkg doctor zlib.net -Q:rpath`.

&nbsp;

# Tasks

## Bump

Inputs: PRIORITY

```sh
if ! git diff-index --quiet HEAD --; then
  echo "error: dirty working tree" >&2
  exit 1
fi

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "error: requires main branch" >&2
  exit 1
fi

V=$(git describe --tags --abbrev=0 --match "v[0-9]*.[0-9]*.[0-9]*")
V=$(tea semverator bump $V $PRIORITY)

git push origin main
tea gh release create "v$V"
```
