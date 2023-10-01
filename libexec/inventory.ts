#!//usr/bin/env -S pkgx deno run --allow-net --allow-env --allow-read

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils, SemVer } from "pkgx"
const { useInventory } = hooks

const { unknown: pkgnames } = parseFlags(Deno.args)

const rv: Record<string, SemVer[]> = {}
for (const pkg of pkgnames.map(utils.pkg.parse)) {
  rv[pkg.project] = await useInventory().get(pkg)
}

if (pkgnames.length == 1) {
  console.info(Object.values(rv)[0].join("\n"))
} else {
  console.info(JSON.stringify(rv, null, 2))
}
