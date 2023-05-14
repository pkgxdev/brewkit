#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import { useCellar, usePrefix } from "hooks"
import tea_init from "../lib/init().ts"
import { str } from "utils/pkg.ts"
import run from "hooks/useRun.ts"
import { host } from "utils"
import Path from "path"

tea_init()

const { flags, unknown } = parseFlags(Deno.args, {
  flags: [{
    name: "deps",
    type: "string",
    required: true,
    optionalValue: true
  }],
})

const cellar = useCellar()
const pkg_prefix = new Path(unknown[0])

switch (host().platform) {
case 'darwin':
  await run({
    cmd: [
      'fix-machos.rb',
      pkg_prefix.string,
      ...['bin', 'sbin', 'tbin', 'lib', 'libexec'].compact(x => pkg_prefix.join(x).isDirectory())
    ],
    env: {
      GEM_HOME: usePrefix().join('tea/local/share/ruby/gem').string
    }
  })
  break

case 'linux': {
  const raw = flags.deps == true ? '' : flags.deps as string
  const installs = await Promise.all(raw.split(/\s+/).map(path => cellar.resolve(new Path(path))))
  const deps = installs.map(({ pkg }) => str(pkg))
  await run({
    cmd: [
      'fix-elf.ts',
      pkg_prefix.string,
      ...deps
    ]
  })
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
        console.verbose({ fixing: path })
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
        console.verbose({ fixing: path })
        path.write({text, force: true})
      }
    }
  }
}
