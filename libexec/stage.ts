#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-write --allow-run=cp

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils, Path } from "tea"
import undent from "outdent"

const { useShellEnv, useCellar, useConfig, usePantry } = hooks
const { host, pkg: { parse } } = utils
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
  }, {
    name: "blddir",
    aliases: ["build-dir"],
    type: "string",
    required: true
  }],
})

const pantry = usePantry()
const cellar = useCellar()
const prefix = useConfig().prefix
const srcdir = Path.cwd().join(flags.srcdir)
const blddir = Path.cwd().join(flags.blddir)
const deps = await (() => {
  if (typeof flags.deps != 'string' || !flags.deps) return Promise.resolve([])
  const parts = flags.deps.split(/\s+/)
  const pp = parts.map(x => cellar.resolve(new Path(x)))
  return Promise.all(pp)
})()
if (blddir.string.includes(" ")) {
  console.error("warning: build directory contains spaces. build tools *may choke*")
}

if (!blddir.isDirectory() || blddir.exists()?.isEmpty()) {
  if (blddir.exists()) await blddir.rm()
  // NOTE we use cp -a to preserve symlinks
  // We'd love to use deno/sd/copy.ts but it fails on symlinks
  // https://github.com/denoland/deno_std/issues/3454
  await Deno.run({ cmd: ["cp", "-a", srcdir.string, blddir.string] }).status()
}

//FIXME this goes to GitHub, and we already did this once
// NOTE we have to in order to get `version.raw` which many pkgymls need
const pkg = await pantry.resolve(parse(pkgname))

/// assemble build script
const pantry_sh = await pantry.getScript(pkg, 'build', deps)
const brewkit = new Path(new URL(import.meta.url).pathname).parent().parent().join("share/brewkit")

/// calc env
const sh = useShellEnv()
const old_home = Deno.env.get("HOME")
Deno.env.set("HOME", blddir.string)  //lol side-effects beware!
const env = await sh.map({ installations: deps })
Deno.env.set("HOME", old_home!)

if (host().platform == 'darwin') env['MACOSX_DEPLOYMENT_TARGET'] = ['11.0']

env['PATH'] ??= []
env['PATH'].push("/usr/bin", "/bin", "/usr/sbin", "/sbin", useConfig().prefix.join('tea.xyz/v*/bin').string)

const text = undent`
  #!/bin/bash

  set -e
  set -o pipefail
  set -x
  cd "${blddir}"

  export HOME="${blddir}/xyz.tea.home"
  export SRCROOT="${blddir}"
  export PREFIX=${flags.prefix}
  export TEA_PREFIX=${prefix.string}
  ${sh.expand(env)}

  mkdir -p "$HOME"

  export PATH=${brewkit}:"$PATH"
  export CFLAGS="-w $CFLAGS"  # warnings are noise

  ${pantry_sh}
  `

/// write out build script
const script = blddir.join("xyz.tea.build.sh").write({ text, force: true }).chmod(0o755)

/// write out tea.yaml so magic works
import * as YAML from "deno/yaml/stringify.ts"

blddir.join("tea.yaml").write({ text: YAML.stringify({
  env: sh.flatten(env),
  dependencies: deps.reduce((acc, {pkg}) => {
    acc[pkg.project] = `=${pkg.version}`
    return acc
  }, {} as Record<string, string>)
}), force: true })

/// copy in auxillary files from pantry directory
for await (const [path, {isFile}] of (await pantry.filepath(pkg.project)).parent().ls()) {
  if (isFile) {
    path.cp({ into: blddir.join("props").mkdir() })
  }
}


/// done
console.info(script.string)
