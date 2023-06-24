![tea](https://tea.xyz/banner.png)

# BrewKit

BrewKit is build infrastructure for tea.

```sh
tea pkg build zlib.net
# ^^ same as tea +tea.xyz/brewkit pkg build zlib.net
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

## Outside a Pantry Checkout

Outside a pantry checkout we operate against your tea installation
(which defaults to `~/.tea`). Builds occur in a temporary directory rather
than local to your pantry checkout.

```sh
tea pkg build zlib.net
```


## Additions

This repo is for tooling built on top of the tea primitives with the purpose
of generalized building and testing of open source packages.

If you have an idea for an addition open a [discussion]!


### Stuff That Needs to be Added

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


### Hacking on brewkit

If you do `../brewkit/bin/pkg build` for example your local brewkit will be
used rather than that which is installed.

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
tea gh release create "v$V" --prerelease --generate-notes --title "v$V"
```


[discussion]: https://github.com/orgs/teaxyz/discussions


## Shellcheck

```sh
for x in bin/*; do
  if file $x | grep 'shell script'; then
    tea shellcheck --shell=dash --severity=warning $x
  fi
done

tea shellcheck --shell=dash --severity=warning **/*.sh
```
