#!/usr/bin/env -S tea -E

/*---
dependencies:
  gnu.org/tar: ^1
  tukaani.org/xz: ^5
  sourceware.org/bzip2: ^1
  info-zip.org/unzip: ^6
args:
  - deno
  - run
  - --allow-net
  - --allow-read
  - --allow-run=tar,unzip
  - --allow-write
  - --allow-env
---*/

//TODO verify the sha
//TODO only allow writes to Deno.args[1]

import { Package, PackageRequirement, Path, utils, hooks } from "tea"
const { useSourceUnarchiver, usePantry } = hooks
import { parseFlags } from "cliffy/flags/mod.ts"
const { panic } = utils

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

let pkg: Package | PackageRequirement = utils.pkg.parse(pkgname)
pkg = { project: pkg.project, version: pkg.constraint.single() ?? panic() }

const dstdir = Path.cwd().join(outputDir)

if (!dstdir.isDirectory() || dstdir.exists()?.isEmpty()) {
  const zipfile = new Path(unknown[0])
  const { stripComponents } = await pantry.getDistributable(pkg) ?? {}
  await useSourceUnarchiver().unarchive({ dstdir, zipfile, stripComponents })
} else {
  console.error("notice: already extracted: skipping")
}
