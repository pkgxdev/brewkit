#!/usr/bin/env -S deno run --allow-env --allow-read

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils } from "tea"

const { useCellar, usePantry, useMoustaches } = hooks
const { parse } = utils.pkg
const { unknown: pkgnames } = parseFlags(Deno.args)

const pantry = usePantry()
const cellar = useCellar()
const moustaches = useMoustaches()

const missing = []

for(const pkg of pkgnames.map(parse)) {
  const { path, pkg: { version } } = await cellar.resolve(pkg)
  const versionMap = moustaches.tokenize.version(version)

  for (const provide of await pantry.project(pkg).provides()) {
    const name = moustaches.apply(provide, versionMap)
    const bin = path.join('bin', name)
    const sbin = path.join('sbin', name)
    if (!bin.isExecutableFile() && !sbin.isExecutableFile()) missing.push([pkg.project, name])
  }
}

if (missing.length) {
  console.error(`error: missing executables:\n${missing.map(([pkg, provide]) => pkg + ' => ' + provide).join('\n')}`)
  Deno.exit(1)
}
