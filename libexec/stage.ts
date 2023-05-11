#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-write

import useShellEnv, { expand, flatten } from "hooks/useShellEnv.ts"
import { parseFlags } from "cliffy/flags/mod.ts"
import { useCellar, usePrefix } from "hooks"
import usePantry from "../lib/usePantry.ts"
import { host, undent } from "utils"
import { parse, str as pkgstr } from "utils/pkg.ts"
import Path from "path"

import tea_init from "../lib/init().ts"
tea_init()

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
const prefix = usePrefix()
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

/// assemble build script
const pantry_sh = await pantry.getScript(pkg, 'build', deps)
const brewkit = new URL(import.meta.url).path().parent().parent().join("share/brewkit")

/// calc env
const old_home = Deno.env.get("HOME")
Deno.env.set("HOME", srcdir.string)  //lol side-effects beware!
const env = await useShellEnv({ installations: deps })
Deno.env.set("HOME", old_home!)

if (host().platform == 'darwin') env['MACOSX_DEPLOYMENT_TARGET'] = ['11.0']

env['PATH'] ??= []
env['PATH'].push("/usr/bin", "/bin", "/usr/sbin", "/sbin", usePrefix().join('tea.xyz/v*/bin').string)

const text = undent`
  #!/bin/bash

  set -e
  set -o pipefail
  set -x
  cd "${srcdir}"

  export HOME="${srcdir}/xyz.tea.home"
  export SRCROOT="${srcdir}"
  export PREFIX=${flags.prefix}
  export TEA_PREFIX=${prefix.string}
  ${expand(env)}

  mkdir -p "$HOME"

  export PATH=${brewkit}:"$PATH"
  export CFLAGS="-w $CFLAGS"  # warnings are noise

  ${pantry_sh}
  `

/// write out build script
const sh = srcdir.join("xyz.tea.build.sh").write({ text, force: true }).chmod(0o755)

/// write out tea.yaml so magic works
import * as YAML from "deno/yaml/stringify.ts"

srcdir.join("tea.yaml").write({ text: YAML.stringify({
  env: flatten(env),
  dependencies: deps.reduce((acc, {pkg}) => {
    acc[pkg.project] = `=${pkg.version}`
    return acc
  }, {} as Record<string, string>)
}), force: true })

/// copy in auxillary files from pantry directory
for await (const [path, {isFile}] of pantry.getYAML(pkg).path.parent().ls()) {
  if (isFile) {
    path.cp({ into: srcdir.join("props").mkdir() })
  }
}


/// done
console.log(sh.string)
