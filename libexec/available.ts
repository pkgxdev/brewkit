#!/usr/bin/env -S deno run --allow-env --allow-read

import { parseFlags } from "cliffy/flags/mod.ts"
import { usePantry } from "hooks"
import { parse } from "utils/pkg.ts"

import tea_init from "../lib/init().ts"
tea_init()

const { unknown: pkgnames } = parseFlags(Deno.args)

const pantry = usePantry()

for(const pkg of pkgnames.map(parse)) {
  if (!await pantry.available(pkg)) {
    Deno.exit(1)
  }
}
