#!/usr/bin/env -S pkgx +git +gh deno^1 run --allow-env --allow-net --allow-write --allow-run=gh,pkgx --allow-read

import resolve_pkg from "brewkit/resolve-pkg.ts"

const { pkg } = await resolve_pkg(Deno.args[0])

const ghout = Deno.env.get("GITHUB_OUTPUT")

Deno.writeTextFileSync(ghout!, `value=${pkg.version.toString()}\n`, {append: true})
if (pkg.version.raw) {
  Deno.writeTextFileSync(ghout!, `raw=${pkg.version.raw}\n`, {append: true})
}
if (pkg.version.tag) {
  Deno.writeTextFileSync(ghout!, `tag=${pkg.version.tag}\n`, {append: true})
}

const json = {
  project: pkg.project,
  version: {
    value: pkg.version.toString(),
    raw: pkg.version.raw,
    tag: pkg.version.tag
  }
}

Deno.writeTextFileSync(ghout!, `json=${JSON.stringify(json)}\n`, {append: true})

Deno.writeTextFileSync(Deno.env.get("GITHUB_ENV")!, `BREWKIT_PKGJSON=${JSON.stringify(json)}\n`, {append: true})

console.log(`::notice::${JSON.stringify(json)}`)
