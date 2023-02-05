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
  - --allow-read={{tea.prefix}}
  - --allow-env=GITHUB_TOKEN
---*/

//TODO verify the sha
//TODO only allow writes to Deno.args[1]

import { usePantry, useSourceUnarchiver } from "hooks"
import { parseFlags } from "cliffy/flags/mod.ts"
import { parse } from "utils/pkg.ts"
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
const pkg = await pantry.resolve(parse(pkgname))
const dstdir = Path.cwd().join(outputDir)
const zipfile = new Path(unknown[0])
const { stripComponents } = await pantry.getDistributable(pkg) ?? {}
await useSourceUnarchiver().unarchive({ dstdir, zipfile, stripComponents })
