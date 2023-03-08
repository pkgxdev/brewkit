#!/usr/bin/env -S deno run --allow-read --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import { usePantry } from "hooks"

const { flags: { fullPath }, unknown } = parseFlags(Deno.args, {
  flags: [{
    name: "full-path"
  }]
})

const pantry = usePantry()

for (const arg of unknown) {
  let found = false
  for await (const entry of pantry.ls()) {
    if (entry.project === arg || (await pantry.getProvides(entry)).includes(arg)) {
      if (fullPath) {
        console.log(entry.path.string)
      } else {
        console.log(entry.project)
      }
      found = true
      break
    }
  }
  if (!found) Deno.exit(1)
}
