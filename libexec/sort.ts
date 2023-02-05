#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-read={{ tea.prefix }}
---*/

import { parse, str } from "utils/pkg.ts"
import { usePantry } from "hooks"
import { hydrate } from "prefab"

const pantry = usePantry()

const dry = Deno.args.map(parse)
const wet = await hydrate(dry, async (pkg, dry) => {
  const deps = await pantry.getDeps(pkg)
  return dry ? [...deps.build, ...deps.runtime] : deps.runtime
})

console.log(wet.dry.map(str).join("\n"))
