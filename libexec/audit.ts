#!//usr/bin/env -S pkgx deno run --allow-env --allow-read

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils } from "pkgx"
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

  // Ensure all `provides:` are present

  for (const provide of await pantry.project(pkg).provides()) {
    const name = moustaches.apply(provide, versionMap)
    const bin = path.join('bin', name)
    const sbin = path.join('sbin', name)
    if (!bin.isExecutableFile() && !sbin.isExecutableFile()) missing.push([pkg.project, name])
  }

  if (missing.length) {
    fail(`error: missing executables:\n${missing.map(([pkg, provide]) => pkg + ' => ' + provide).join('\n')}`)
  }

  // Enforce some naming conventions

  // project must be a FQDN
  if (!pkg.project.match(/\./) || swallow(() => new URL(`https://${pkg.project}`)) === undefined) {
    fail(`error: ${pkg.project} is not a valid project name. Please use a fully qualified URL to the canonical project page.`)
  // project should not start with www
  } else if (pkg.project.match(/^www\./)) {
    fail(`error: ${pkg.project} *is* a valid project name, but you started with \`www\`, which we find unsightly. Maybe try \`${pkg.project.replace(/^www\./, '')}\`?`)
  // project should not start with a protocol
  // note that this isn't possible on a mac, as far as I can tell, but better safe than sorry.
  } else if (pkg.project.match(/^(ht|f)tps?:\/\//)) {
    fail(`error: ${pkg.project} *is* a valid project name, but you started with a protocol, which we would prefer not. Maybe try \`${pkg.project.replace(/^(ht|f)tps?:\/\//, '')}\`?`)
  // project name should only contain letters, numbers, dashes, underscores, dots, and slashes
  // this might be handled by the URL check above, but better safe than sorry. Certainly, URLs
  // can have colons, question marks, percent signs and ampersands.
  } else if (pkg.project.match(/[^a-zA-Z0-9\-_\.\/]/)) {
    fail(`error: ${pkg.project} contains characters we don't like. Maybe try \`${pkg.project.replace(/[^a-zA-Z0-9\-_\.\/]/g, '')}\`?`)
  }
}


function fail(msg: string) {
  console.error(msg)
  Deno.exit(1)
}
