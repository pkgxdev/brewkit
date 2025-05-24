#!//usr/bin/env -S pkgx +git +gh deno^1 run --allow-env --allow-read --allow-run --allow-net --ext=ts

import { Command } from "cliffy/command/mod.ts"
import { swallow } from "brewkit/utils.ts"
import get_config from "brewkit/config.ts"
import { Package } from "pkgx"
import { hooks } from "pkgx"
import { isString } from "is-what";

const { useCellar, usePantry, useMoustaches } = hooks

const { args } = await new Command()
  .name("bk audit")
  .description("Audit pkgx pantry pkgs for common issues")
  .arguments("[pkgspec]")
  .parse();

if (args.length > 1) {
  throw new Error("too many arguments, we can only handle one pkgspec at a time currently")
}

const config = await get_config(args[0])

const pantry = usePantry()
const cellar = useCellar()
const moustaches = useMoustaches()

const missing: [string, string][] = []

if (!config.pkg) {
  fail('error: no packages specified')
}

await audit_provides(config.pkg)
await audit_names(config.pkg)
await audit_display_name_is_unique(config.pkg)


//////////////////////////////////////////////////////////////////////////////////

async function audit_provides(pkg: Package) {
  const { path, pkg: { version } } = await cellar.resolve(pkg)
  const versionMap = moustaches.tokenize.version(version)

  // Ensure all `provides:` are present

  for (const provide of await pantry.project(pkg).provides()) {
    const name = moustaches.apply(provide, versionMap)
    const bin = path.join('bin', name)
    const sbin = path.join('sbin', name)
    if (!bin.isExecutableFile() && !sbin.isExecutableFile()) {
      missing.push([pkg.project, name])
    }
  }

  if (missing.length) {
    fail(`error: missing executables:\n${missing.map(([pkg, provide]) => pkg + ' => ' + provide).join('\n')}`)
  }
}

function audit_names(pkg: Package) {
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

async function audit_display_name_is_unique(pkg: Package) {
  const display_name = await get_display_name(pkg.project)
  if (!display_name) return
  if (!isString(display_name)) fail("display-name is not string")

  for await (const entry of usePantry().ls()) {
    if (entry.project == pkg.project) continue
    if (await get_display_name(entry.project) == display_name) {
      fail(`error: display-name is not unique, (see: ${entry.project})`)
    }
  }

  async function get_display_name(project: string) {
    return await usePantry().project(project).yaml().then(x => x.display_name) as string | undefined
  }
}

function fail(msg: string) {
  console.error(msg)
  Deno.exit(1)
}
