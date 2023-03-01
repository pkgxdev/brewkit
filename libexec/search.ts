#!/usr/bin/env -S tea -E deno run --allow-env --allow-read --allow-net

import { parseFlags } from "cliffy/flags/mod.ts"
import { usePantry, useInventory, useFlags } from "hooks"
import * as semver from "semver"

useFlags()

const { unknown: [query] } = parseFlags(Deno.args)
const pantry = usePantry()

const encoder = new TextEncoder()
const print = (x: string) => Deno.stdout.write(encoder.encode(x))

for await (const pkg of pantry.ls()) {
  let output = false
  const bins: string[] = []
  for (const bin of await pantry.getProvides(pkg)) {
    if (bin.startsWith(query)) {
      output = true
      bins.push(bin)
    }
  }
  if (output) {
    print(`${pkg.project}: ${bins.join(', ')}`)
  } else if (pkg.project.startsWith(query)) {
    print(pkg.project.trim())
    output = true
  }
  if (output) {
    const rq = { project: pkg.project, constraint: new semver.Range('*') }
    const got = await useInventory().select(rq)
    print(`: ${got}\n`)
  }
}
