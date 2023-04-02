#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-net
  - --allow-run=curl
  - --allow-read
  - --allow-write
  - --allow-env
  - --unstable
dependencies:
  curl.se: '*'
---*/

//TODO verify the sha

import { useOffLicense, useCache, useDownload } from "hooks"
import { parseFlags } from "cliffy/flags/mod.ts"
import usePantry from "../lib/usePantry.ts"
import { panic } from "utils"
import { parse } from "utils/pkg.ts"
import { Stowage} from "types"
import Path from "path"

import tea_init from "../lib/init().ts"
tea_init()

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

try {
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
      // first try the original location
      return await download({ dst, src: url })
    } catch (err) {
      try {
        // then try our mirror
        const src = useOffLicense('s3').url(stowage)
        return await download({ dst, src })
      } catch (err2) {
        console.error("mirror:", err2.message)
        throw err
      }
    }
  })()

  console.log(zipfile.string)
} catch (err) {
  console.error(err.message)
  console.error("tea expands the full semantic version, which may mean the URL you are")
  console.error("fetching is now incorrect. Try `version.raw`?")
  Deno.exit(1)
}

async function download({ dst, src }: { dst: Path, src: URL }) {
  if (Deno.env.get("GITHUB_ACTIONS")) {
    // using cURL as deno’s fetch fails for certain sourceforge URLs
    // seemingly due to SSL certificate issues. cURL basically always works ¯\_(ツ)_/¯
    const proc = new Deno.Command("curl", {
      args: ["--fail", "--location", "--output", dst.string, src.toString()]
    })
    const status = await proc.spawn().status
    if (!status.success) {
      console.error({ dst, src })
      throw new Error(`cURL failed to download ${src}`)
    }
  } else {
    // locally using our download function as it knows how to cache properly
    await useDownload().download({ dst, src })
  }
  return dst
}
