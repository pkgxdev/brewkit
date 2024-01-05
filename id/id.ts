#!/usr/bin/env -S pkgx +git +gh deno run --allow-env --allow-net --allow-write --allow-sys --allow-run=gh --allow-read

import get_config from "brewkit/config.ts"

const config = await get_config(Deno.args[0])

const ghout = Deno.env.get("GITHUB_OUTPUT")

Deno.writeTextFileSync(ghout!, `value=${config.pkg.version.toString()}\n`, {append: true})
if (config.pkg.version.raw) {
  Deno.writeTextFileSync(ghout!, `raw=${config.pkg.version.raw}\n`, {append: true})
}
if (config.pkg.version.tag) {
  Deno.writeTextFileSync(ghout!, `tag=${config.pkg.version.tag}\n`, {append: true})
}

const json = {
  project: config.pkg.project,
  version: {
    value: config.pkg.version.toString(),
    raw: config.pkg.version.raw,
    tag: config.pkg.version.tag
  }
}

Deno.writeTextFileSync(ghout!, `json=${JSON.stringify(json)}\n`, {append: true})

Deno.writeTextFileSync(Deno.env.get("GITHUB_ENV")!, `BREWKIT_PKGJSON=${JSON.stringify(json)}\n`, {append: true})

console.log(`::notice::${JSON.stringify(json)}`)
