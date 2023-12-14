#!/usr/bin/env -S pkgx +git deno --allow-env

import get_config from "brewkit/config.ts"
import { utils } from "pkgx"

interface Package {
  project: string
  pkgspec: string
  version: string
  version_raw: string
  version_tag: string
}

const rv: Package[] = []
for (const arg of Deno.args) {
  const config = await get_config(arg)
  rv.push({
    project: config.pkg.project,
    pkgspec: utils.pkg.str(config.pkgspec),
    version: config.pkg.version.toString(),
    version_raw: config.pkg.version.raw,
    version_tag: config.pkg.version.tag,
  })
}

console.log(JSON.stringify(rv, null, 2))
