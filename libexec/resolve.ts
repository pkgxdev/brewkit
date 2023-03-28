#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import usePantry from "../lib/usePantry.ts"
import { parse, str } from "utils/pkg.ts"
import { useCellar } from "hooks"

import tea_init from "../lib/init().ts"
tea_init()

const { flags, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "cellar",
  }]
})

if (!flags.cellar) {
  const pkg = await usePantry().resolve(parse(pkgname))
  console.log(str(pkg))
} else {
  const entry = await useCellar().has(parse(pkgname))
  if (!entry) {
    throw new Error(`${pkgname} not installed in $TEA_PREFIX`)
  }
  console.log(str(entry.pkg))
}
