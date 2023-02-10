#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-read
  - --allow-env=TEA_PREFIX,TEA_PANTRY_PATH
---*/

import { Package, PackageRequirement, Stowage } from "types"
import { usePantry, useCache, useCellar } from "hooks"
import { parseFlags } from "cliffy/flags/mod.ts"
import { parse, str } from "utils/pkg.ts"
import { panic, print } from "utils"

const { flags: { prefix, srcdir, src, testdir }, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "prefix",
    standalone: true
  }, {
    name: "srcdir",
    standalone: true
  }, {
    name: "src",
    standalone: true
  }, {
    name: "testdir",
    standalone: true
  }]
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
} else if (testdir) {
  const path = useCellar().shelf(pkg.project).join(`test-v${pkg.version}`)
  await print(`${path}\n`)
} else {
  Deno.exit(1)
}
