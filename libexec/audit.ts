#!/usr/bin/env -S deno run --allow-env --allow-read

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils } from "tea"
import { swallow } from "../lib/utils.ts"

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

  // Enforce some naming conventions

  // project must be a FQDN
  if (!pkg.project.match(/\./) || swallow(() => new URL(`https://${pkg.project}`)) === undefined) {
    console.error(`error: ${pkg.project} is not a valid project name. Please use a fully qualified URL to the canonical project page.`)
    Deno.exit(1)
  // project should not start with www
  } else if (pkg.project.match(/^www\./)) {
    console.error(`error: ${pkg.project} *is* a valid project name, but you started with \`www\`, which we find unsightly. Maybe try \`${pkg.project.replace(/^www\./, '')}\`?`)
    Deno.exit(1)
  // project should not start with a protocol
  // note that this isn't possible on a mac, as far as I can tell, but better safe than sorry.
  } else if (pkg.project.match(/^(ht|f)tps?:\/\//)) {
    console.error(`error: ${pkg.project} *is* a valid project name, but you started with a protocol, which we would prefer not. Maybe try \`${pkg.project.replace(/^(ht|f)tps?:\/\//, '')}\`?`)
    Deno.exit(1)
  // project name should only contain letters, numbers, dashes, underscores, dots, and slashes
  // this might be handled by the URL check above, but better safe than sorry. Certainly, URLs
  // can have colons, question marks, percent signs and ampersands.
  } else if (pkg.project.match(/[^a-zA-Z0-9\-_\.\/]/)) {
    console.error(`error: ${pkg.project} contains characters we don't like. Maybe try \`${pkg.project.replace(/[^a-zA-Z0-9\-_\.\/]/g, '')}\`?`)
    Deno.exit(1)
  }
}

if (missing.length) {
  console.error(`error: missing executables:\n${missing.map(([pkg, provide]) => pkg + ' => ' + provide).join('\n')}`)
  Deno.exit(1)
}
