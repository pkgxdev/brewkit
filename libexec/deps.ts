#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env=TEA_PREFIX,TEA_PANTRY_PATH

import { parseFlags } from "cliffy/flags/mod.ts"
import usePantry from "../lib/usePantry.ts"
import { parse, str } from "utils/pkg.ts"
import { hydrate } from "prefab"

const { flags: { build, test }, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "build"
  }, {
    name: "test"
  }],
})

const pkg = parse(pkgname)
const pantry = usePantry()

/// when building we don’t incorporate the target into the hydration graph
/// because we don’t want it yet: we”re about to build it

const dry = build
  ? (({ runtime, build }) => [...runtime, ...build])(await pantry.getDeps(pkg))
  : [pkg]

const { pkgs: wet } = await hydrate(dry, async (pkg, dry) => {
  const deps = await pantry.getDeps(pkg)
  if (dry && test) {
    return [...deps.runtime, ...deps.test]
  } else {
    return deps.runtime
  }
})

console.log(wet.map(str).join("\n"))
