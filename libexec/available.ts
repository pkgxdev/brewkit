#!/usr/bin/env -S deno run --allow-env --allow-read

import { parseFlags } from "cliffy/flags/mod.ts"
import { hooks, utils } from "tea"

const { parse } = utils.pkg
const { usePantry } = hooks
const { unknown: pkgnames } = parseFlags(Deno.args)

for(const pkg of pkgnames.map(parse)) {
  if (!await usePantry().project(pkg).available()) {
    Deno.exit(1)
  }
}
