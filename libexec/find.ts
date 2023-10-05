#!/usr/bin/env -S pkgx deno run --allow-read --allow-env

import { hooks } from "pkgx"
const { find } = hooks.usePantry()

for (const arg of Deno.args) {
  const rv = await find(arg)

  if (rv.length > 1) {
    console.error("multiple matches: " + rv.map(({project}) => project).join(' '))
    Deno.exit(1)
  }
  if (rv.length == 0) {
    console.error("no matches for: " + arg)
    Deno.exit(2)
  }

  if (Deno.env.get("_PATHS")) {
    console.info(rv[0].path.string)
  } else {
    console.info(rv[0].project)
  }
}
