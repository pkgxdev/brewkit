#!/usr/bin/env -S tea -E

/*---
dependencies:
  gnu.org/tar: 1
  tukaani.org/xz: 5
  sourceware.org/bzip2: 1
args:
  - deno
  - run
  - --allow-net
  - --allow-read
  - --allow-run=tar,unzip
  - --allow-write
  - --allow-env=TEA_PREFIX,TEA_PANTRY_PATH,GITHUB_TOKEN
---*/

//TODO verify the sha
//TODO only allow writes to Deno.args[1]

import usePantry from "../lib/usePantry.ts"
import useSourceUnarchiver from "../lib/useSourceUnarchiver.ts"
import { Package, PackageRequirement } from "types"
import { parseFlags } from "cliffy/flags/mod.ts"
import { parse } from "utils/pkg.ts"
import { panic } from "utils"
import Path from "path"

const { flags: { outputDir, pkg: pkgname }, unknown } = parseFlags(Deno.args, {
  flags: [{
    name: "output-dir",
    type: "string",
    required: true
  }, {
    name: "pkg",
    type: "string",
    required: true
  }],
})

const pantry = usePantry()

let pkg: Package | PackageRequirement = parse(pkgname)
pkg = { project: pkg.project, version: pkg.constraint.single() ?? panic() }

const dstdir = Path.cwd().join(outputDir)
const zipfile = new Path(unknown[0])
const { stripComponents } = await pantry.getDistributable(pkg) ?? {}
await useSourceUnarchiver().unarchive({ dstdir, zipfile, stripComponents })
