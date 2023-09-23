#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils, Path } from "tea"
import undent from "outdent"

const { usePantry, useCellar, useConfig, useShellEnv } = hooks
const { pkg: pkgutils, panic } = utils

const { flags, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "deps",
    type: "string",
    optionalValue: true
  }, {
    name: "dstdir",
    type: "string",
    required: true
  }]
})

const pantry = usePantry()
const rq = pkgutils.parse(pkgname)
const cellar = useCellar()
const self = await cellar.has(rq) ?? panic()
const { pkg } = self
const deps = await (() => {
  if (typeof flags.deps != 'string' || !flags.deps) return Promise.resolve([])
  const parts = flags.deps.split(/\s+/)
  const pp = parts.map(x => cellar.resolve(new Path(x)))
  return Promise.all(pp)
})()
const dstdir = new Path(flags.dstdir)
const yml = await pantry.project(pkg).yaml()
const installations = [...deps]
if (deps.find(x => x.pkg.project == self.pkg.project) === undefined) installations.push(self)

Deno.env.set("HOME", dstdir.string)  //lol side-effects beware!
const env = await useShellEnv().map({ installations })

if (!yml.test) throw "no `test` node in package.yml"

env['PATH'] ??= []
env['PATH'].push("/usr/bin:/bin")

if (!deps.find(({pkg}) => pkg.project == 'llvm.org' || pkg.project == 'gnu.org/gcc')) {
  /// add our helper cc toolchain unless the package has picked its own toolchain
  env['PATH'].push(new Path(new URL(import.meta.url).pathname).parent().parent().join("share/toolchain/bin").string)
}

let text = undent`
  #!/usr/bin/env bash

  set -e
  set -o pipefail
  set -x

  export TEA_PREFIX="${useConfig().prefix}"
  export HOME="${dstdir}"

  ${useShellEnv().expand(env)}

  `

if (yml.test.fixture) {
  const fixture = dstdir.join("xyz.tea.fixture").write({ text: yml.test.fixture.toString() })
  text += `export FIXTURE="${fixture}"\n\n`
}

text += `cd "${dstdir}"\n\n`

text += await pantry.getScript(pkg, 'test', deps)
text += "\n"

for await (const [path, {name, isFile}] of (await pantry.filepath(pkg.project)).parent().ls()) {
  if (isFile && name != 'package.yml') {
    path.cp({ into: dstdir })
  }
}

const sh = dstdir
  .join("xyz.tea.test.sh")
  .write({ text, force: true })
  .chmod(0o500)

console.info(sh.string)
