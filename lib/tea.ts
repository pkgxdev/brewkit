export * from "libtea"

import usePantry from "./usePantry.ts"
import useCache from "./useCache.ts"
import useSourceUnarchiver from "./useSourceUnarchiver.ts"
import { hooks as tea_hooks } from "libtea"

function usePrefix() {
  return tea_hooks.useConfig().prefix
}

const hooks = { ...tea_hooks, useSourceUnarchiver, usePantry, useCache, usePrefix }
export { hooks }


//// verbosity
import { isNumber } from "is-what"

function getVerbosity(env: Record<string, string>): Verbosity {
  const { DEBUG, GITHUB_ACTIONS, RUNNER_DEBUG, VERBOSE } = env

  if (DEBUG == '1') return Verbosity.debug
  if (GITHUB_ACTIONS == 'true' && RUNNER_DEBUG  == '1') return Verbosity.debug

  const verbosity = VERBOSE ? parseInt(VERBOSE) : undefined
  return isNumber(verbosity) ? verbosity : Verbosity.normal
}

export enum Verbosity {
  quiet = -1,
  normal = 0,
  loud = 1,
  debug = 2,
  trace = 3
}

(() => {
  const verbosity = getVerbosity(Deno.env.toObject())

  function noop() {}
  if (verbosity < Verbosity.debug) console.debug = noop
  if (verbosity < Verbosity.loud) console.log = noop
  if (verbosity < Verbosity.normal) {
    console.info = noop
    console.warn = noop
    console.log = noop
    console.error = noop
  }
})()
