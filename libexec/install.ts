#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=tar,/bin/ln --allow-net --allow-env --unstable

import { useCellar, useInventory } from "hooks"
import { parse, str } from "utils/pkg.ts"
import { install, link } from "prefab"
import { Installation } from "types"
import { panic } from "utils"

const cellar = useCellar()
const inventory = useInventory()

let installation: Installation | undefined
const rv: Installation[] = []
for (const pkg of Deno.args.map(parse)) {
  if (!(installation = await cellar.has(pkg))) {
    const version = await inventory.select(pkg) ?? panic(`${str(pkg)} not found`)
    installation = await install({ project: pkg.project, version })
    await link(installation)
  }
  rv.push(installation)
}

console.log(rv.map(({path})=>path).join("\n"))
