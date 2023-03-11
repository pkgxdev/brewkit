#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env=GITHUB_TOKEN,TEA_PREFIX,TEA_PANTRY_PATH --allow-write

import useShellEnv, { expand } from "hooks/useShellEnv.ts"
import { parseFlags } from "cliffy/flags/mod.ts"
import { useCellar, usePrefix } from "hooks"
import usePantry from "../lib/usePantry.ts"
import { host, print, undent } from "utils"
import { parse } from "utils/pkg.ts"
import Path from "path"

const { flags, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "srcdir",
    type: "string",
    required: true
  }, {
    name: "prefix",
    type: "string",
    required: true
  }, {
    name: "deps",
    type: "string",
    optionalValue: true
  }],
})

const pantry = usePantry()
const cellar = useCellar()
const srcdir = Path.cwd().join(flags.srcdir)
const deps = await (() => {
  if (typeof flags.deps != 'string' || !flags.deps) return Promise.resolve([])
  const parts = flags.deps.split(/\s+/)
  const pp = parts.map(x => cellar.resolve(new Path(x)))
  return Promise.all(pp)
})()
if (srcdir.string.includes(" ")) {
  console.error("warning: srcdir should not contain spaces, some build tools *will* choke")
}

//FIXME this goes to GitHub, and we already did this once
// NOTE we have to in order to get `version.raw` which many pkgymls need
const pkg = await pantry.resolve(parse(pkgname))

/// calc env
const env = await useShellEnv({ installations: deps })
if (host().platform == 'darwin') env['MACOSX_DEPLOYMENT_TARGET'] = ['11.0']

env['PATH'] ??= []
env['PATH'].push("/usr/bin", "/bin", usePrefix().join('tea.xyz/v*/bin').string)

/// assemble build script
const pantry_sh = await pantry.getScript(pkg, 'build', deps)
const brewkit = new URL(import.meta.url).path().parent().parent().join("share/brewkit")

const text = undent`
  #!/bin/bash

  set -e
  set -o pipefail
  set -x
  cd "${srcdir}"

  export HOME="${srcdir}/xyz.tea.home"
  export SRCROOT="${srcdir}"
  export PREFIX=${flags.prefix}
  ${expand(env)}

  mkdir -p "$HOME"

  export PATH=${brewkit}:"$PATH"

  ${pantry_sh}
  `

/// write out build script
const sh = srcdir.join("xyz.tea.build.sh").write({ text, force: true })


/// copy in auxillary files from pantry directory
for await (const [path, {isFile}] of pantry.getYAML(pkg).path.parent().ls()) {
  if (isFile) {
    path.cp({ into: srcdir.join("props").mkdir() })
  }
}


/// done
print(`${sh}\n`)
