#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net

import { parseFlags } from "cliffy/flags/mod.ts"
import { usePantry, useInventory } from "hooks"
import * as semver from "semver"
import tea_init from "../lib/init().ts"

tea_init()

const { unknown: [query] } = parseFlags(Deno.args)
const pantry = usePantry()

const encoder = new TextEncoder()
const print = (x: string) => Deno.stdout.write(encoder.encode(x))

const outputted: Set<string> = new Set()

for await (const pkg of pantry.ls()) {
  // often we are dealing with two pantries that are mostly the same during dev/debug
  if (outputted.has(pkg.project)) continue

  let output = false
  const bins: string[] = []
  for (const bin of await pantry.getProvides(pkg).swallow() ?? []) {
    if (bin.includes(query)) {
      output = true
      bins.push(bin)
    }
  }
  if (output) {
    print(`${pkg.project}: ${bins.join(', ')}`)
  } else if (pkg.project.includes(query)) {
    print(pkg.project.trim())
    output = true
  }
  if (output) {
    const rq = { project: pkg.project, constraint: new semver.Range('*') }
    const got = await useInventory().select(rq)
    print(`: ${got}\n`)
  }

  outputted.add(pkg.project)
}
