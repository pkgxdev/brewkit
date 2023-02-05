#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-read={{ tea.prefix }}
---*/

import { usePantry, useCache } from "hooks"
import { parse, str } from "utils/pkg.ts"
import { Package, PackageRequirement, Stowage } from "types"
import { panic, print } from "utils"
import useCellar from "../../cli/src/hooks/useCellar.ts"
import { parseFlags } from "cliffy/flags/mod.ts"

const { flags: { prefix, srcdir, src }, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "prefix",
    standalone: true
  }, {
    name: "srcdir",
    standalone: true
  }, {
    name: "src",
    standalone: true
  }],
})

let pkg: PackageRequirement | Package = parse(pkgname)
const version = pkg.constraint.single() ?? panic()
pkg = {project: pkg.project, version }

if (src) {
  const { url } = await usePantry().getDistributable(pkg) ?? {}
  if (url) {
    const stowage: Stowage = { pkg, type: 'src', extname: url.path().extname() }
    await print(`${useCache().path(stowage)}\n`)
  } else {
    console.error("warn: pkg has no srcs: ", str(pkg))
    // NOT AN ERROR EXIT CODE THO
  }
} else if (prefix) {
  const path = useCellar().keg(pkg)
  await print(`${path}\n`)
} else if (srcdir) {
  const path = useCellar().shelf(pkg.project).join(`src-v${pkg.version}`)
  await print(`${path}\n`)
} else {
  Deno.exit(1)
}
