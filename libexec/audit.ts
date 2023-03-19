#!/usr/bin/env -S deno run --allow-env --allow-read

import { parseFlags } from "cliffy/flags/mod.ts"
import { useCellar, usePantry } from "hooks"
import { parse } from "utils/pkg.ts"

const { unknown: pkgnames } = parseFlags(Deno.args)

const pantry = usePantry()
const cellar = useCellar()

const missing = []

for(const pkg of pkgnames.map(parse)) {
  const { path } = await cellar.resolve(pkg)
  for (const provide of await pantry.getProvides(pkg)) {
    const bin = path.join('bin', provide)
    const sbin = path.join('bin', provide)
    if (!bin.isExecutableFile() && !sbin.isExecutableFile()) missing.push([pkg.project, provide])
  }
}

if (missing.length) {
  console.error(`error: missing executables:\n${missing.map(([pkg, provide]) => pkg + ' => ' + provide).join('\n')}`)
  Deno.exit(1)
}
