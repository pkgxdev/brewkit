#!//usr/bin/env -S pkgx deno run --allow-net --allow-read --allow-env --allow-write --allow-run=cp

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils, Path } from "pkgx"
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
  blddir.rm().parent().mkdir('p')
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
const sup_PATH = [new Path(new URL(import.meta.url).pathname).parent().parent().join("share/brewkit")]

if (!deps.find(({pkg}) => pkg.project == 'llvm.org' || pkg.project == 'gnu.org/gcc')) {
  /// add our helper cc toolchain unless the package has picked its own toolchain
  sup_PATH.push(new Path(new URL(import.meta.url).pathname).parent().parent().join("share/toolchain/bin"))

  if (host().platform != "darwin") {
    const symlink = (names: string[], {to}: {to: string}) => {
      const d = blddir.join('dev.pkgx.bin').mkdir()
      for (const name of names) {
        const path = d.join(name)
        if (path.exists()) continue
        const target = prefix.join('llvm.org/v*/bin', to)
        path.ln('s', { target })
      }
    }

    symlink(["cc", "gcc", "clang"], {to: "clang"})
    symlink(["c++", "g++", "clang++"], {to: "clang++"})
    symlink(["cpp"], {to: "clang-cpp"})

    symlink(["ld"], {to: "lld"})
    symlink(["lld"], {to: "lld"})
    symlink(["ld64.lld"], {to: "ld64.lld"})
    symlink(["lld-link"], {to: "lld-link"})

    symlink(["ar"], {to: "llvm-ar"})
    symlink(["as"], {to: "llvm-as"})
    symlink(["nm"], {to: "llvm-nm"})
    symlink(["objcopy"], {to: "llvm-objcopy"})
    symlink(["ranlib"], {to: "llvm-ranlib"})
    symlink(["readelf"], {to: "llvm-readelf"})
    symlink(["strings"], {to: "llvm-strings"})
    symlink(["strip"], {to: "llvm-strip"})
  }
}

/// calc env
const sh = useShellEnv()
const old_home = Deno.env.get("HOME")
Deno.env.set("HOME", blddir.string)  //lol side-effects beware!
const env = await sh.map({ installations: deps })
Deno.env.set("HOME", old_home!)

if (host().platform == 'darwin') env['MACOSX_DEPLOYMENT_TARGET'] = ['11.0']

env['PATH'] ??= []
env['PATH'].push("/usr/bin", "/bin", "/usr/sbin", "/sbin", useConfig().prefix.join('pkgx.sh/v*/bin').string)

if (host().platform == 'linux' && host().target == 'x86-64') {
  env['LDFLAGS'] = [`${env['LDFLAGS']?.[0] ?? ''} -pie`.trim()]
  env['CFLAGS'] = [`${env['CFLAGS']?.[0] ?? ''} -fPIC`.trim()]
  env['CXXFLAGS'] = [`${env['CXXFLAGS']?.[0] ?? ''} -fPIC`.trim()]
}

const text = undent`
  #!/bin/bash

  set -exo pipefail

  cd "${blddir}"

  export HOME="${blddir}/dev.pkgx.home"
  export SRCROOT="${blddir}"
  export PREFIX=${flags.prefix}
  export PKGX_DIR=${prefix.string}
  ${sh.expand(env)}

  mkdir -p "$HOME"

  export PATH=${sup_PATH.map(x => x.string).join(':')}:"$PATH"
  export CFLAGS="-w $CFLAGS"  # warnings are noise

  ${pantry_sh}
  `

/// write out build script
const script = blddir.join("dev.pkgx.build.sh").write({ text, force: true }).chmod(0o755)

/// write out pkgx.yaml so dev-env works
import * as YAML from "deno/yaml/stringify.ts"

blddir.join("pkgx.yaml").write({ text: YAML.stringify({
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
