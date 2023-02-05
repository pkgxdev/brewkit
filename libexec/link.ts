#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-read
  - --allow-write
---*/

import { PackageRequirement, Package } from "types"
import { parse } from "utils/pkg.ts"
import { panic } from "utils"
import { link } from "prefab"
import Path from "path"

let pkg: Package | PackageRequirement = parse(Deno.args[0])
pkg = { project: pkg.project, version: pkg.constraint.single() ?? panic() }

const path = new Path(Deno.args[1])

await link({ pkg, path })
