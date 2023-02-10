![tea](https://tea.xyz/banner.png)

# BrewKit

The BrewKit builds packages.

```sh
tea +tea.xyz/brewkit build zlib.net
```

If you are inside a pantry and tea magic is installed you can omit package
names, BrewKit will figure out what packages you are editing and build them.

```sh
xc build
```

Here [`xc`](xcfile.dev) reads the instructions from the pantry README to know
to call the full command.
