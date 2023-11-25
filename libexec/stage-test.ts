#!//usr/bin/env -S pkgx deno run --allow-read --allow-write --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils, Path } from "pkgx"
import undent from "outdent"
import host from "libpkgx/utils/host.ts";

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
const project = pantry.project(pkg)
const yml = await project.yaml()
const installations = [...deps]
if (deps.find(x => x.pkg.project == self.pkg.project) === undefined) installations.push(self)

/// try to find `pkgx` since we deliberately withold it from the PATH for tests
/// since it needs to be an explicit dependency
const pkgx = (PATH => {
  for (const path of PATH.split(":")) {
    const f = Path.abs(path)?.join("pkgx").isExecutableFile()
    if (f) return f.string
  }
})(Deno.env.get("PATH") ?? '') ?? 'pkgx'

Deno.env.set("HOME", dstdir.string)  //lol side-effects beware!
const env = await useShellEnv().map({ installations })

if (!yml.test) throw "no `test` node in package.yml"

env['PATH'] ??= []
env['PATH'].push("/usr/bin:/bin")

let text = undent`
  #!/usr/bin/env -S pkgx bash

  set -exo pipefail

  command_not_found_handle() {
    echo "::warning::\\\`$1\\\` is not an explicit dependency!"
    case $1 in
    cc|c++|ld)
      ${pkgx} +llvm.org -- "$@";;
    *)
      ${pkgx} "$@";;
    esac
  }

  export PKGX_DIR="${useConfig().prefix}"
  export HOME="${dstdir}"

  ${useShellEnv().expand(env)}

  `

if (yml.test.fixture) {
  const fixture = dstdir.join("dev.pkgx.fixture").write({ text: yml.test.fixture.toString() })
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
  .join("dev.pkgx.test.sh")
  .write({ text, force: true })
  .chmod(0o500)

console.info(sh.string)
