#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-net
  - --allow-run=curl,git,tar
  - --allow-read
  - --allow-write
  - --allow-env
  - --unstable
dependencies:
  curl.se: '*'
  git-scm.org: '*'
  gnu.org/tar: '*'
  tukaani.org/xz: '*'
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
const { url, ref, type } = await pantry.getDistributable(pkg) ?? {}

if (!url) {
  console.error("warn: pkg has no srcs: ", pkg)
  Deno.exit(0)
}

try {
  const zipfile = await (async () => {
    const stowage: Stowage = (() => {
      if (type === "git") {
        return { pkg, type: 'src', extname: `.tar.xz` }
      }
      return { pkg, type: 'src', extname: url.path().extname() }
    })()

    const dst = (() => {
      if (flags.outputDir) {
        const filename = useCache().path(stowage).basename()
        return Path.cwd().join(flags.outputDir, filename)
      } else {
        return Path.cwd().join(flags.o ?? panic())
      }
    })()

    if (type === "git") return clone({ dst, src: url, ref: ref! })

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

async function clone({ dst, src, ref }: { dst: Path, src: URL, ref: string }) {
  const tmp = Path.mktemp({})
  const proc = new Deno.Command("git", {
    args: [
      "clone",
      "--quiet",
      "--depth=1",
      "--branch",
      ref,
      src.toString(),
      tmp.string,
    ],
    // `git` uses stderr for... non errors, and --quiet
    // doesn't touch them
    stderr: "null",
  })
  const status = await proc.spawn().status
  if (!status.success) {
    console.error({ dst, src })
    throw new Error(`git failed to clone ${src}`)
  }

  const proc2 = new Deno.Command("tar", {
    args: [
      "-C",
      tmp.string,
      // Prevents `tar: Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'`
      // when unpacking on darwin
      "--no-xattrs",
      "-czf",
      dst.string,
      ".",
    ]
  })
  const status2 = await proc2.spawn().status
  if (!status2.success) {
    console.error({ dst, src })
    throw new Error(`tar failed to create ${dst}`)
  }
  return dst
}