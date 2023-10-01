#!//usr/bin/env -S pkgx deno run --allow-read --allow-env

import { hooks } from "pkgx"
const { usePantry } = hooks

const pantry = usePantry()
const arg = Deno.args[0]

for await (const entry of pantry.ls()) {
  if (entry.project === arg) {
    console.info(entry.path.string)
    Deno.exit(0)
  }
  if ((await pantry.project(entry).provides()).includes(arg)) {
    console.info(entry.path.string)
    Deno.exit(0)
  }
}

Deno.exit(1)
