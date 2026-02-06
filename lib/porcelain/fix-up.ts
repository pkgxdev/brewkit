import { hooks, utils, Path, Package, Installation } from "pkgx"
import { Config } from "brewkit/config.ts"
const { usePantry } = hooks
const { host } = utils

export default async function finish(config: Config) {
  const prefix = config.path.install
  await fix_rpaths(prefix, config.pkg, config.path.cache, config.deps.gas)
  await fix_pc_files(prefix, config.path.build_install)
  await fix_cmake_files(prefix, config.path.build_install)
  await remove_la_files(prefix)
}

//////////////////////////////////////////////////////////////////////////////////////
async function fix_rpaths(pkg_prefix: Path, pkg: Package, cache: Path, deps: Installation[]) {
  const bindir = new Path(new URL(import.meta.url).pathname).join("../../bin")
  const yml = await usePantry().project(pkg).yaml()

  switch (host().platform) {
  case 'darwin': {
    if (yml.build.skip === 'fix-machos' || yml.build.skip?.includes('fix-machos')) {
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
    if (yml.build.skip === 'fix-patchelf' || yml.build.skip?.includes('fix-patchelf')) {
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
  const lib = pkg_prefix.join("lib").isDirectory()
  if (!lib) return
  for await (const [path, { isFile }] of lib.walk()) {
    if (isFile && path.extname() == ".la") {
      console.log({ removing: path })
      Deno.removeSync(path.string)
    }
  }
}
