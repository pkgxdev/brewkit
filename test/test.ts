#!/usr/bin/env -S pkgx +bash +gum +gh +rsync deno^1 run --ext=ts --allow-env --allow-read --allow-write --allow-net --allow-run

//TODO net required because we go to github for version info, but really we should require
// a built product that is then recorded for us to use

import { Package, PackageRequirement, Path, hooks, utils } from "pkgx"
import { gum, find_pkgx, rsync, find_in_PATH } from "brewkit/utils.ts"
import get_config, { platform_cache } from "brewkit/config.ts"
import * as YAML from "deno/yaml/mod.ts"
import undent from "outdent"
import useConfig from "libpkgx/hooks/useConfig.ts";
const { usePantry } = hooks

await gum('computing configuration')
const config = await get_config(Deno.args[0])
console.log("pkg:", utils.pkg.str(config.pkg))
console.log("testbed:", config.path.test)
console.log("home:", config.path.home)
console.log("install:", config.path.install)

const yml = YAML.parse(await config.path.yaml.read()) as any
if (!yml.test) throw "no `test` node in package.yml"

await gum("stage")
await rsync(config.path.yaml.parent(), config.path.test, ['--exclude=package.yml'])


await gum('writing test script')

const pkgx = find_pkgx()
const bash = find_in_PATH('bash')
const gum_ = find_in_PATH('gum')

const depstr = (deps: (PackageRequirement | Package)[]) => deps.map(x => `"+${utils.pkg.str(x)}"`).join(' ')
const env_plus = `${depstr([config.pkg])} ${depstr(config.deps.dry.runtime)} ${depstr(config.deps.dry.test)}`.trim()

const user_script = await usePantry().getScript(config.pkg, 'test', config.deps.gas, config)

const script_text = undent`
  #!${bash}

  set -eo pipefail

  ${gum_} format "## env"
    export PKGX_HOME="$HOME"
    set -a
    eval "$(CLICOLOR_FORCE=1 ${pkgx} ${env_plus})" || exit $?
    set +a

  command_not_found_handle() {
    echo "::warning::\\\`$1\\\` is not an explicit dependency!" 1>&2
    case $1 in
    cc|c++|ld)
      ${pkgx} +llvm.org -- "$@";;
    *)
      ${pkgx} "$@";;
    esac
  }

  export HOME="${config.path.home}"
  mkdir -p "$HOME"

  ${fixture()}

  env -u GH_TOKEN -u GITHUB_TOKEN

  ${gum_} format "## pantry script start"
  set -x
  cd "${config.path.test}"

  ${user_script}
  `

function fixture() {
  if (yml.test.fixture) {
    const fixture = config.path.test.join("dev.pkgx.fixture").write({ text: yml.test.fixture.toString() })
    return `export FIXTURE="${fixture}"`
  } else {
    return ''
  }
}

const script = new Path(`${config.path.test}.sh`)
console.log("writing", script)
script.write({ force: true, text: script_text }).chmod(0o755)

await gum("test")

const env: Record<string, string> = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  PKGX_DIR: useConfig().prefix.string
}
for (const key of ['HOME', 'PKGX_PANTRY_PATH', 'GITHUB_TOKEN', 'LANG', 'LOGNAME', 'USER', 'TERM']) {
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
if (!rv.success) throw new Error(`UR TEST FAILED WITH CODE ${rv.code} & SIGNAL ${rv.signal}`)
