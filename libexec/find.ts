#!/usr/bin/env -S deno run --allow-read --allow-env

import { usePantry } from "hooks"

import tea_init from "../lib/init().ts"
tea_init()

const pantry = usePantry()
const arg = Deno.args[0]

for await (const entry of pantry.ls()) {
  if (entry.project === arg) {
    console.log(entry.path.string)
    Deno.exit(0)
  }
  if ((await pantry.getProvides(entry)).includes(arg)) {
    console.log(entry.path.string)
    Deno.exit(0)
  }
}

Deno.exit(1)
