#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=TEA_PREFIX,TEA_PANTRY_PATH --allow-run=/bin/ln

import { PackageRequirement, Package } from "types"
import { parse } from "utils/pkg.ts"
import { panic } from "utils"
import { link } from "prefab"
import Path from "path"

let pkg: Package | PackageRequirement = parse(Deno.args[1])
pkg = { project: pkg.project, version: pkg.constraint.single() ?? panic() }

const path = new Path(Deno.args[0])

await link({ pkg, path })
