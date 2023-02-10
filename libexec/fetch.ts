#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-net
  - --allow-read
  - --allow-write={{ tea.prefix }}
  - --allow-env
---*/

//TODO verify the sha

import { usePantry, useDownload, useOffLicense, useCache } from "hooks"
import { parseFlags } from "cliffy/flags/mod.ts"
import { parse } from "utils/pkg.ts"
import { Stowage} from "types"
import { print, panic } from "utils"
import Path from "path"

const { download } = useDownload()
const pantry = usePantry()

const { flags, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "output-dir",
    type: "string"
  }, {
    name: "o",
    type: "string"
  }]
})

const pkg = await pantry.resolve(parse(pkgname))
const { url } = await pantry.getDistributable(pkg) ?? {}

if (!url) {
  console.error("warn: pkg has no srcs: ", pkg)
  Deno.exit(0)
}

const zipfile = await (async () => {
  const stowage: Stowage = { pkg, type: 'src', extname: url.path().extname() }

  const dst = (() => {
    if (flags.outputDir) {
      const filename = useCache().path(stowage).basename()
      return Path.cwd().join(flags.outputDir, filename)
    } else {
      return Path.cwd().join(flags.o ?? panic())
    }
  })()

  try {
    // first try our mirror
    const src = useOffLicense('s3').url(stowage)
    return await download({ dst, src })
  } catch {
    // oh well, try original location then
    return await download({ dst, src: url })
  }
})()

await print(`${zipfile}\n`)
