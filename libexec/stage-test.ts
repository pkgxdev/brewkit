#!//usr/bin/env -S pkgx deno run --allow-read --allow-write --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils, Path } from "pkgx"
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
  env['PATH'].unshift(new Path(new URL(import.meta.url).pathname).parent().parent().join("share/toolchain/bin").string)

  //COPY PASTA from stage.ts
  const d = dstdir.join('dev.pkgx.bin').mkdir()
  const symlink = (names: string[], {to}: {to: string}) => {
    for (const name of names) {
      const path = d.join(name)
      if (path.exists()) continue
      const target = useConfig().prefix.join('llvm.org/v*/bin', to)
      path.ln('s', { target })
    }
  }

  symlink(["ar"], {to: "llvm-ar"})
  symlink(["as"], {to: "llvm-as"})
  symlink(["cc", "gcc", "clang"], {to: "clang"})
  symlink(["c++", "g++", "clang++"], {to: "clang++"})
  symlink(["cpp"], {to: "clang-cpp"})
  symlink(["ld"], {to: "lld"})
  symlink(["lld"], {to: "lld"})
  symlink(["ld64.lld"], {to: "ld64.lld"})
  symlink(["lld-link"], {to: "lld-link"})
  symlink(["objcopy"], {to: "llvm-objcopy"})
  symlink(["readelf"], {to: "llvm-readelf"})
  symlink(["strip"], {to: "llvm-strip"})
  symlink(["nm"], {to: "llvm-nm"})
  symlink(["ranlib"], {to: "llvm-ranlib"})
  symlink(["strings"], {to: "llvm-strings"})
}

let text = undent`
  #!/usr/bin/env bash

  set -e
  set -o pipefail
  set -x

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
