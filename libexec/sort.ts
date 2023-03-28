#!/usr/bin/env -S deno run --allow-read --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import usePantry from "../lib/usePantry.ts"
import { parse, str } from "utils/pkg.ts"
import { hydrate } from "prefab"

import tea_init from "../lib/init().ts"
tea_init()

const { flags: { delimiter: separator }, unknown: args } = parseFlags(Deno.args, {
  flags: [{
    name: "delimiter",
    aliases: ["d"],
    type: "string",
    default: "\n",
    required: false
  }],
})


const pantry = usePantry()

const dry = args.map(parse)
const wet = await hydrate(dry, async (pkg, dry) => {
  const deps = await pantry.getDeps(pkg)
  return dry ? [...deps.build, ...deps.runtime] : deps.runtime
})

console.log(wet.dry.map(str).join(separator))
