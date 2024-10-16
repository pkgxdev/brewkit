#!/usr/bin/env -S pkgx +rsync +git +bash +gum +gh +curl +bzip2 +xz +unzip +lzip +column deno^1 run --ext=ts --allow-env --allow-read --allow-write --allow-run --allow-net

import make_build_script from "brewkit/porcelain/build-script.ts"
import { gum, rsync } from "brewkit/utils.ts"
import fix_up from "brewkit/porcelain/fix-up.ts"
import { Command } from "cliffy/command/mod.ts"
import fetch from "brewkit/porcelain/fetch.ts"
import get_config, { platform_cache } from "brewkit/config.ts"
import { Path, hooks, utils } from "pkgx"
import * as YAML from "deno/yaml/mod.ts"
const { useConfig } = hooks
const { host } = utils

const { options, args } = await new Command()
  .name("build")
  .description("Build pkgx pantry pkgs with brewkit")
  .option("-C, --clean", "Clean everything first")
  .option("-s, --stage", "Stage, do not run build")
  .arguments("[pkgspec]")
  .parse();

if (args.length > 1) {
  throw new Error("too many arguments, we can only handle one pkgspec at a time currently")
}

await gum('computing configuration')
const config = await get_config(args[0])
console.log("pkg:", utils.pkg.str(config.pkg))
console.log("src:", config.path.src)
console.log("build:", config.path.build)
console.log("home:", config.path.home)
console.log("install:", config.path.install)
console.log("build-install:", config.path.build_install)

if (options.clean) {
  gum("cleaning")
  config.path.home.rm({recursive: true})
  config.path.install.rm({recursive: true})
  config.path.build_install.rm({recursive: true})
  config.path.build.rm({recursive: true})
  config.path.src.rm({recursive: true})
  config.path.test.rm({recursive: true})
}

/// warnings
if (config.path.build.string.includes(" ")) {
  console.warn("warn: build directory contains spaces, many many build tools choke, so we’re aborting")
  console.warn("    ", config.path.build.string)
  console.warn("note: we intend to fix this by building to /tmp. open a ticket and we’ll do it")
  Deno.exit(1)
}

const yml = YAML.parse(await config.path.yaml.read()) as any

/// fetch
await gum('fetch & extract')
let fetched: Path | 'git' | 'tarball' | undefined
if (yml.distributable) {
  fetched = await fetch(config)
} else {
  console.log("no srcs, skipping fetch")
}

/// rsync sources & props to build stage
await gum('stage')
if (fetched == 'git') {
  await rsync(config.path.src, config.path.build)
} else if (fetched == 'tarball') {
  await rsync(config.path.src, config.path.build, ['--exclude=.git'])
}

await rsync(config.path.yaml.parent(), config.path.build.join("props"))

/// write out pkgx.yaml
// config.path.build.join("pkgx.yaml").write({ text: YAML.stringify({
//   env: sh.flatten(env),
//   dependencies: deps.reduce((acc, {pkg}) => {
//     acc[pkg.project] = `=${pkg.version}`
//     return acc
//   }, {} as Record<string, string>)
// }), force: true })

/// create toolchain if necessary
const toolchain_PATH = make_toolchain()

/// write script
const script_content = await make_build_script(config, toolchain_PATH)
const script = new Path(`${config.path.build}.sh`)
console.log('writing', script)
script.write({text: script_content, force: true}).chmod(0o755)

if (options.stage) {
  Deno.exit(0)
}

/// run script
await gum('build')

const env: Record<string, string> = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  PKGX_DIR: useConfig().prefix.string
}

// compute sanitized `env` the script will run within
for (const key of [
  'HOME',
  'PKGX_PANTRY_PATH', // otherwise we cannot build against the user’s pantry
  'GITHUB_TOKEN',     // pass through for `gh` and that sort of thing
  'LANG', 'LOGNAME', 'USER', 'TERM'  // prevent POSIX tools from breaking
]) {
  const value = Deno.env.get(key)
  if (value) env[key] = value
}
if (env['GITHUB_TOKEN']) {
  // for `gh`
  env['GH_TOKEN'] = env['GITHUB_TOKEN']
}

platform_cache(() => config.path.home).mkdir('p')  // we’ve indeed found things to break without this

const proc = new Deno.Command(script.string, {clearEnv: true, env}).spawn()
const rv = await proc.status
if (!rv.success) throw new Error(`UR BUILD FAILED WITH CODE ${rv.code} & SIGNAL ${rv.signal}`)

/// move installation products to destination
await gum(`rsync install to final path`)
await rsync(config.path.build_install, config.path.install)
config.path.build_install.rm({recursive: true})

/// fix rpaths and other relocatability issues
await gum('fix-ups')
await fix_up(config)

const ghout = Deno.env.get("GITHUB_OUTPUT")
if (ghout) {
  const { platform, arch } = host()
  const pkgspec = utils.pkg.str(config.pkg)
  const pkgjson = JSON.stringify({
    project: config.pkg.project,
    version: {
      value: config.pkg.version.toString(),
      raw: config.pkg.version.raw,
      tag: config.pkg.version.tag
    }
  })

  Deno.writeTextFileSync(ghout, `pkgspec=${pkgspec}\n`, { append: true})
  Deno.writeTextFileSync(ghout, `pkgjson=${pkgjson}\n`, { append: true})
  Deno.writeTextFileSync(ghout, `project=${config.pkg.project}\n`, { append: true})
  Deno.writeTextFileSync(ghout, `version=${config.pkg.version}\n`, { append: true})
  Deno.writeTextFileSync(ghout, `prefix=${config.path.install.string}\n`, { append: true})
  Deno.writeTextFileSync(ghout, `platform=${platform}\n`, { append: true})
  Deno.writeTextFileSync(ghout, `arch=${arch}\n`, { append: true})
  const ghenv = Deno.env.get("GITHUB_ENV")
  if (ghenv) {
    Deno.writeTextFileSync(ghenv, `BREWKIT_PKGJSON=${pkgjson}\n`, { append: true })
    Deno.writeTextFileSync(ghenv, `BREWKIT_PKGSPEC=${pkgspec}\n`, { append: true })
    Deno.writeTextFileSync(ghenv, `BREWKIT_PREFIX=${config.path.install.string}\n`, { append: true })
  }
}

///////////////////////////////////////////////////////////////////
function make_toolchain() {
  const deps = new Set(config.deps.dry.build.concat(config.deps.dry.runtime).map(x => x.project))

  if (deps.has('llvm.org') || deps.has('gnu.org/gcc')) {
    return
  }

  if (host().platform != "darwin") {
    // rm ∵ // https://github.com/pkgxdev/brewkit/issues/303
    const d = config.path.home.join('toolchain').rm({ recursive: true }).mkdir('p')

    const symlink = (names: string[], {to}: {to: string}) => {
      for (const name of names) {
        const path = d.join(name)
        if (path.exists()) continue
        const target = useConfig().prefix.join('llvm.org/v*/bin', to)
        path.ln('s', { target })
      }
    }

    symlink(["cc", "gcc", "clang"], {to: "clang"})
    symlink(["c++", "g++", "clang++"], {to: "clang++"})
    symlink(["cpp"], {to: "clang-cpp"})

    if (host().platform == "linux") {
      symlink(["ld"], {to: "ld.lld"})
    } else if (host().platform == "windows") {
      symlink(["ld"], {to: "lld-link"})
    }

    symlink(["ld.lld"], {to: "ld.lld"})
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

  return new Path(new URL(import.meta.url).pathname).join("../../share/toolchain/bin")
}
