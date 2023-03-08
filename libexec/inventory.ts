#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parseFlags } from "cliffy/flags/mod.ts"
import { useInventory } from "hooks"
import SemVer from "semver"
import { parse } from "utils/pkg.ts"

const { unknown: pkgnames } = parseFlags(Deno.args)

const rv: Record<string, SemVer[]> = {}
for (const pkg of pkgnames.map(parse)) {
  rv[pkg.project] = await useInventory().get(pkg)
}

if (pkgnames.length == 1) {
  console.log(Object.values(rv)[0].join("\n"))
} else {
  console.log(JSON.stringify(rv, null, 2))
}
