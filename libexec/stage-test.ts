#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-read
  - --allow-write
  - --allow-env
---*/

import { usePantry, usePrefix, useCellar } from "hooks"
import useShellEnv, { expand } from "hooks/useShellEnv.ts"
import { undent, pkg as pkgutils, panic } from "utils"
import { parseFlags } from "cliffy/flags/mod.ts"
import Path from "path"

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
const yml = await pantry.getYAML(pkg).parse()
const env = await useShellEnv({ installations: [...deps, self] })

if (!yml.test) throw "no `test` node in package.yml"

if (env['PATH']) {
  env['PATH'].push("$PATH")
}

let text = undent`
  #!/usr/bin/env bash

  set -e
  set -o pipefail
  set -x

  export TEA_PREFIX=${usePrefix()}

  ${expand(env)}

  `

if (yml.test.fixture) {
  const fixture = dstdir.join("xyz.tea.fixture").write({ text: yml.test.fixture.toString() })
  text += `export FIXTURE="${fixture}"\n\n`
}

text += `cd "${dstdir}"\n\n`

text += await pantry.getScript(pkg, 'test', deps)
text += "\n"

for await (const [path, {name, isFile}] of pantry.getYAML(pkg).path.parent().ls()) {
  if (isFile && name != 'package.yml') {
    path.cp({ into: dstdir })
  }
}

const sh = dstdir
  .join("xyz.tea.test.sh")
  .write({ text, force: true })
  .chmod(0o500)

console.log(sh.string)
