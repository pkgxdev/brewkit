import { hooks, utils, Path, Package, Installation } from "pkgx"
import { Config } from "brewkit/config.ts"
const { usePantry } = hooks
const { host } = utils

export default async function finish(config: Config) {
  const prefix = config.path.install
  const yml = await usePantry().project(config.pkg).yaml()
  const skip = yml.build.skip ?? []
  const skips = typeof skip === 'string' ? [skip] : skip

  await fix_rpaths(prefix, config.pkg, config.path.cache, config.deps.gas, skips)
  await fix_pc_files(prefix, config.path.build_install)
  await fix_cmake_files(prefix, config.path.build_install)
  if (!skips.includes('libtool-cleanup')) {
    await remove_la_files(prefix)
  } else {
    console.info(`skipping libtool cleanup for ${config.pkg.project}`)
  }
  if (host().platform == 'linux') {
    await consolidate_lib64(prefix)
  }
  if (!skips.includes('flatten-includes')) {
    await flatten_headers(prefix)
  } else {
    console.info(`skipping header flattening for ${config.pkg.project}`)
  }
}

//////////////////////////////////////////////////////////////////////////////////////
async function fix_rpaths(pkg_prefix: Path, pkg: Package, cache: Path, deps: Installation[], skips: string[]) {
  const bindir = new Path(new URL(import.meta.url).pathname).join("../../bin")

  switch (host().platform) {
  case 'darwin': {
    if (skips.includes('fix-machos')) {
      console.info(`skipping rpath fixes for ${pkg.project}`)
      break
    }
    const proc = new Deno.Command(bindir.join('fix-machos.rb').string, {
      args: [
        pkg_prefix.string,
        ...['bin', 'sbin', 'tbin', 'lib', 'libexec'].compact(x => pkg_prefix.join(x).isDirectory()?.string)
      ],
      env: {
        GEM_HOME: cache.join('brewkit/gem').string
      }
    }).spawn()
    const { success } = await proc.status
    if (!success) throw new Error("failed to fix machos")
  } break

  case 'linux': {
    if (skips.includes('fix-patchelf')) {
      console.info(`skipping rpath fixes for ${pkg.project}`)
      break
    }

    const proc = new Deno.Command(bindir.join('fix-elf.ts').string, {
      args: [
        pkg_prefix.string,
        ...deps.map(({ path }) => path.string)
      ]
    }).spawn()
    const { success } = await proc.status
    if (!success) Deno.exit(1)
    break
  }}
}

async function fix_pc_files(pkg_prefix: Path, build_prefix: Path) {
  //NOTE currently we only support pc files in lib/pkgconfig
  // we aim to standardize on this but will relent if a package is found
  // that uses share and other tools that build against it only accept that
  for (const part of ["share", "lib"]) {
    const d = pkg_prefix.join(part, "pkgconfig").isDirectory()
    if (!d) continue
    for await (const [path, { isFile }] of d.ls()) {
      if (isFile && path.extname() == ".pc") {
        const orig = await path.read()
        const relative_path = pkg_prefix.relative({ to: path.parent() })
        // newer versions of brewkit append +brewing to the path; this will get both
        // variants
        const text = orig
          .replaceAll(build_prefix.string, `\${pcfiledir}/${relative_path}`)
          .replaceAll(pkg_prefix.string, `\${pcfiledir}/${relative_path}`)
        if (orig !== text) {
          console.log({ fixing: path })
          path.write({text, force: true})
        }
      }
    }
  }
}

async function fix_cmake_files(pkg_prefix: Path, build_prefix: Path) {
  // Facebook and others who use CMake sometimes rely on a libary's .cmake files
  // being shipped with it. This would be fine, except they have hardcoded paths.
  // But a simple solution has been found.
  const cmake = pkg_prefix.join("lib", "cmake")
  if (cmake.isDirectory()) {
    for await (const [path, { isFile }] of cmake.walk()) {
      if (isFile && path.extname() == ".cmake") {
        const orig = await path.read()
        const relative_path = pkg_prefix.relative({ to: path.parent() })
        // newer versions of brewkit append +brewing to the path; this will get both
        // variants
        const text = orig
          .replaceAll(build_prefix.string, `\${CMAKE_CURRENT_LIST_DIR}/${relative_path}`)
          .replaceAll(pkg_prefix.string, `\${CMAKE_CURRENT_LIST_DIR}/${relative_path}`)
        if (orig !== text) {
          console.log({ fixing: path })
          path.write({text, force: true})
        }
      }
    }
  }
}

async function remove_la_files(pkg_prefix: Path) {
  // libtool .la files contain hardcoded paths and cause more problems than they solve
  // only remove top-level lib/*.la — subdirectory .la files may be module descriptors
  // needed at runtime (eg. ImageMagick codec plugins)
  const lib = pkg_prefix.join("lib").isDirectory()
  if (!lib) return
  for await (const [path, { isFile }] of lib.ls()) {
    if (isFile && path.extname() == ".la") {
      console.log({ removing: path })
      Deno.removeSync(path.string)
    }
  }
}

async function consolidate_lib64(pkg_prefix: Path) {
  // some build systems install to lib64 on x86-64 Linux; we standardize on lib
  const lib64 = pkg_prefix.join("lib64")
  if (!lib64.isDirectory()) return

  const lib = pkg_prefix.join("lib")
  Deno.mkdirSync(lib.string, { recursive: true })

  for await (const [path, { isFile, isSymlink }] of lib64.ls()) {
    const dest = lib.join(path.basename())
    if (isFile || isSymlink) {
      Deno.renameSync(path.string, dest.string)
    }
  }

  Deno.removeSync(lib64.string, { recursive: true })
  Deno.symlinkSync("lib", lib64.string)
}

// headers that must not be flattened into include/ as they would shadow
// system/libc headers (compared case-insensitively for macOS HFS+/APFS)
const SYSTEM_HEADERS = new Set([
  "assert.h",
  "complex.h",
  "ctype.h",
  "errno.h",
  "fenv.h",
  "float.h",
  "inttypes.h",
  "iso646.h",
  "limits.h",
  "locale.h",
  "math.h",
  "setjmp.h",
  "signal.h",
  "stdalign.h",
  "stdarg.h",
  "stdatomic.h",
  "stdbool.h",
  "stddef.h",
  "stdint.h",
  "stdio.h",
  "stdlib.h",
  "stdnoreturn.h",
  "string.h",
  "tgmath.h",
  "threads.h",
  "time.h",
  "uchar.h",
  "wchar.h",
  "wctype.h",
  // POSIX
  "dirent.h",
  "fcntl.h",
  "glob.h",
  "grp.h",
  "netdb.h",
  "poll.h",
  "pthread.h",
  "pwd.h",
  "regex.h",
  "sched.h",
  "search.h",
  "semaphore.h",
  "spawn.h",
  "strings.h",
  "syslog.h",
  "termios.h",
  "unistd.h",
  "utime.h",
  "wordexp.h",
  // common C++ / platform headers that cause trouble
  "memory.h",
  "version.h",
  "module.h",
])

async function flatten_headers(pkg_prefix: Path) {
  // if include/ contains exactly one subdirectory and no loose files, flatten it
  // eg. include/foo/*.h → include/*.h with include/foo → symlink to .
  const include = pkg_prefix.join("include").isDirectory()
  if (!include) return

  const entries: Path[] = []
  const subdirs: Path[] = []

  for await (const [path, { isDirectory }] of include.ls()) {
    entries.push(path)
    if (isDirectory) subdirs.push(path)
  }

  if (subdirs.length == 1 && entries.length == 1) {
    const subdir = subdirs[0]
    const name = subdir.basename()

    // check for headers that would shadow system headers (case-insensitive for macOS)
    const dominated: string[] = []
    for await (const [path] of subdir.ls()) {
      const lower = path.basename().toLowerCase()
      if (SYSTEM_HEADERS.has(lower)) {
        dominated.push(path.basename())
      }
    }
    if (dominated.length > 0) {
      console.log({ skipping_flatten: name, would_shadow: dominated })
      return
    }

    // move all contents up
    for await (const [path] of subdir.ls()) {
      Deno.renameSync(path.string, include.join(path.basename()).string)
    }

    Deno.removeSync(subdir.string, { recursive: true })
    Deno.symlinkSync(".", include.join(name).string)
    console.log({ flattened_headers: name })
  }
}
