#!/usr/bin/env -S deno run --allow-read --allow-env

import { parseFlags } from "cliffy/flags/mod.ts"
import { utils, prefab, hooks } from "tea"
const { parse, str } = utils.pkg
const { usePantry } = hooks
const { hydrate } = prefab

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

console.info(wet.dry.map(str).join(separator))
