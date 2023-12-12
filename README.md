![pkgx](https://pkgx.dev/banner.png)

# BrewKit

## Usage

```sh
$ bk build zlib.net
$ bk test zlib.net
```

> [!TIP]
> If you’re inside a pantry clone then (after running `dev`) brewkit will
> build/test whatever has been edited.

## Build Process Details

> [!NOTE]
> `$BREWROOT` is either your pantry clone or
> `${XDG_DATA_HOME:-$HOME/.local/share}/brewkit`.

> [!NOTE]
> `$PKGSLUG` is the pkg project name with slashes replaced with unicode
> slashes and the version appended in `-1.2.3` form.

1. srcs are placed at `$BREWROOT/srcs/$PKGSLUG`
   * if the source type is a tarball, it is stored as `$BREWROOT/srcs/$PKGSLUG.ext`
2. if the src type is not source control a git repository is initialized for
   the sources and all files are added to the git stage.
   * this is so you can make modifications and get a diff with `git diff` that
     you can then save for use in your build script
3. the sources are cloned to `$BREWROOT/builds/$PKGSLUG` via rsync
4. the build script is generated and placed at `$BREWROOT/builds/$PKGSLUG.sh`
   * the build script uses pkgx machinery to work, check it out
5. a `pkgx.yaml` is generated to `$BREWROOT/builds/$PKGSLUG`
   * this way if you step into that directory and `dev` you get the full build
     environment for your pkg
6. the build script is run
   * the prefix your build script is fed is `$BREWROOT/installs/$PKGSLUG`
7. `$BREWROOT/builds/$PKGSLUG` is moved to `${PKGX_DIR:-$HOME/.pkgx}`
   * without this step you would not be able to use the package from within
     your pantry clone
8. Some key tools are always provided by brewkit (via shims that install on
   demand). These are:
   * `cc`, and the associated build toolchain (specifically latest LLVM)
     * if you want a specific LLVM or GCC then specify the dep and that will
       be used instead
   * `make`
   * `patch`
   * GNU `install`
   * `pkg-config`
   * GNU `sed`

## Apologies

This repo is optimized for the GitHub Actions calling site and not for
readability. I hate this but it’s the right choice for our users.
