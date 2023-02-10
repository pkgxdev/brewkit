#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-read
  - --allow-net
  - --allow-env=GITHUB_TOKEN,TEA_PANTRY_PATH,TEA_PREFIX
---*/

import { parseFlags } from "cliffy/flags/mod.ts"
import { usePantry, useCellar } from "hooks"
import { parse, str } from "utils/pkg.ts"
import { panic } from "utils"

const { flags, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "cellar",
  }]
})

if (!flags.cellar) {
  const pkg = await usePantry().resolve(parse(pkgname))
  console.log(str(pkg))
} else {
  const { pkg } = await useCellar().has(parse(pkgname)) ?? panic()
  console.log(str(pkg))
}
