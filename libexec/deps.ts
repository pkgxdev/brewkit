#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-net
  - --allow-read={{tea.prefix}}
---*/

import { parseFlags } from "cliffy/flags/mod.ts"
import { parse, str } from "utils/pkg.ts"
import { usePantry } from "hooks"
import { hydrate } from "prefab"

const { flags: { build }, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "build"
  }],
})

const pkg = parse(pkgname)
const pantry = usePantry()

const rv = await hydrate([pkg], async (pkg, dry) => {
  const deps = await pantry.getDeps(pkg)
  return (dry && build) ? [...deps.build, ...deps.runtime] : deps.runtime
})

console.log(rv.wet.map(str).join("\n"))
