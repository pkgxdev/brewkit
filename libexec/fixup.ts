#!//usr/bin/env -S pkgx deno run --allow-run --allow-read --allow-write --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils, Path } from "pkgx"

const { useCellar, useConfig, usePantry } = hooks
const { pkg: { str, parse }, host } = utils

const { flags, unknown } = parseFlags(Deno.args, {
  flags: [{
    name: "deps",
    type: "string",
    required: true,
    optionalValue: true
  }],
})

const cellar = useCellar()
const pkg_prefix = new Path(unknown[1])
const pkg = parse(unknown[0])
const yml = await usePantry().project(pkg).yaml()

switch (host().platform) {
case 'darwin': {
  if (yml.build['skip-machos']) {
    console.info(`skipping rpath fixes for ${pkg.project}`)
    break
  }
  const { success } = await Deno.run({
    cmd: [
      'fix-machos.rb',
      pkg_prefix.string,
      ...['bin', 'sbin', 'tbin', 'lib', 'libexec'].compact(x => pkg_prefix.join(x).isDirectory()?.string)
    ],
    env: {
      GEM_HOME: useConfig().prefix.join('.local/share/ruby/gem').string
    }
  }).status()
  if (!success) throw new Error("failed to fix machos")
} break

case 'linux': { 
  if (yml.build['skip-patchelf']) {
    console.info(`skipping rpath fixes for ${pkg.project}`)
    break
  }

  const raw = flags.deps == true ? '' : flags.deps as string
  const installs = await Promise.all(raw.split(/\s+/).map(path => cellar.resolve(new Path(path))))
  const deps = installs.map(({ pkg }) => str(pkg))
  const { success } = await Deno.run({
    cmd: [
      'fix-elf.ts',
      pkg_prefix.string,
      ...deps
    ]
  }).status()
  if (!success) Deno.exit(1)
  break
}}

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
      const text = orig.replaceAll(pkg_prefix.string, `\${pcfiledir}/${relative_path}`)
      if (orig !== text) {
        console.log({ fixing: path })
        path.write({text, force: true})
      }
    }
  }
}

// Facebook and others who use CMake sometimes rely on a libary's .cmake files
// being shipped with it. This would be fine, except they have hardcoded paths.
// But a simple solution has been found.
const cmake = pkg_prefix.join("lib", "cmake")
if (cmake.isDirectory()) {
  for await (const [path, { isFile }] of cmake.walk()) {
    if (isFile && path.extname() == ".cmake") {
      const orig = await path.read()
      const relative_path = pkg_prefix.relative({ to: path.parent() })
      const text = orig.replaceAll(pkg_prefix.string, `\${CMAKE_CURRENT_LIST_DIR}/${relative_path}`)
      if (orig !== text) {
        console.log({ fixing: path })
        path.write({text, force: true})
      }
    }
  }
}
