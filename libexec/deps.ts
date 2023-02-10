#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-net
  - --allow-read
  - --allow-env=TEA_PREFIX,TEA_PANTRY_PATH
---*/

import { parseFlags } from "cliffy/flags/mod.ts"
import { parse, str } from "utils/pkg.ts"
import { usePantry } from "hooks"
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

const rv = await hydrate([pkg], async (pkg, dry) => {
  const deps = await pantry.getDeps(pkg)
  if (dry && build) {
    return [...deps.build, ...deps.runtime]
  } else if (dry && test) {
    return [...deps.test, ...deps.runtime]
  } else {
    return deps.runtime
  }
})

console.log(rv.wet.map(str).join("\n"))
