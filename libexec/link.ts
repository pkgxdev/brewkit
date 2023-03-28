#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run=/bin/ln

import { PackageRequirement, Package } from "types"
import { parse } from "utils/pkg.ts"
import { panic } from "utils"
import { link } from "prefab"
import Path from "path"

import tea_init from "../lib/init().ts"
tea_init()

let pkg: Package | PackageRequirement = parse(Deno.args[1])
pkg = { project: pkg.project, version: pkg.constraint.single() ?? panic() }

const path = new Path(Deno.args[0])

await link({ pkg, path })
