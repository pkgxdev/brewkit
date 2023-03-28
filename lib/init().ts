import { applyConfig, Config, Env } from "hooks/useConfig.ts"
import { isNumber } from "is_what"
import { Verbosity } from "types"
import { flatmap } from "utils"
import Path from "path"

export default function() {
  applyConfig(createConfig())
}

export function createConfig(): Config {
  const env = collectEnv()
  const isCI = !!env.CI
  const execPath = new Path(Deno.execPath())
  const loggerGlobalPrefix = (!Deno.isatty(Deno.stdout.rid) || isCI) ? "tea:" : undefined
  const teaPrefix = findTeaPrefix(env.TEA_PREFIX)
  const verbosity = getVerbosity(env)

  return {
    isCI,
    execPath,
    loggerGlobalPrefix,
    teaPrefix,
    verbosity,
    dryrun: false,
    keepGoing: false,
    verbose: verbosity >= Verbosity.loud,
    debug: verbosity >= Verbosity.debug,
    silent: verbosity <= Verbosity.quiet,
    env,
  }
}

export function collectEnv(): Env {
  return {
    CI: Deno.env.get("CI"),
    CLICOLOR: Deno.env.get("CLICOLOR"),
    CLICOLOR_FORCE: Deno.env.get("CLICOLOR_FORCE"),
    DEBUG: Deno.env.get("DEBUG"),
    GITHUB_ACTIONS: Deno.env.get("GITHUB_ACTIONS"),
    GITHUB_TOKEN: Deno.env.get("GITHUB_TOKEN"),
    NO_COLOR: Deno.env.get("NO_COLOR"),
    PATH: Deno.env.get("PATH"),
    RUNNER_DEBUG: Deno.env.get("RUNNER_DEBUG"),
    SHELL: Deno.env.get("SHELL"),
    SRCROOT: Deno.env.get("SRCROOT"),
    TEA_DIR: Deno.env.get("TEA_DIR"),
    TEA_FILES: Deno.env.get("TEA_FILES"),
    TEA_FORK_BOMB_PROTECTOR: Deno.env.get("TEA_FORK_BOMB_PROTECTOR"),
    TEA_PANTRY_PATH: Deno.env.get("TEA_PANTRY_PATH"),
    TEA_PKGS: Deno.env.get("TEAK_PKGS"),
    TEA_PREFIX: Deno.env.get("TEA_PREFIX"),
    TEA_REWIND: Deno.env.get("TEA_REWIND"),
    VERBOSE: Deno.env.get("VERBOSE"),
    VERSION: Deno.env.get("VERSION")
  }
}

export const findTeaPrefix = (envVar?: string) => {
  return flatmap(envVar, x => new Path(x)) ?? Path.home().join(".tea")
}

function getVerbosity(env: Env): Verbosity {
  const { DEBUG, GITHUB_ACTIONS, RUNNER_DEBUG, VERBOSE } = env
  if (DEBUG == '1') return Verbosity.debug
  if (GITHUB_ACTIONS == 'true' && RUNNER_DEBUG  == '1') return Verbosity.debug
  const verbosity = flatmap(VERBOSE, parseInt)
  return isNumber(verbosity) ? verbosity : Verbosity.normal
}
