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

import { hooks, utils, Stowage, Path } from "tea"
import { parseFlags } from "cliffy/flags/mod.ts"
import usePantry from "../lib/usePantry.ts"

const { useOffLicense, useCache, useDownload } = hooks
const pantry = usePantry()
const { panic } = utils

const { flags, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "output-dir",
    type: "string"
  }, {
    name: "o",
    type: "string"
  }]
})

const pkg = await pantry.resolve(utils.pkg.parse(pkgname))
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
      } else {
        return { pkg, type: 'src', extname: new Path(url.pathname).extname() }
      }
    })()

    const dst = (() => {
      if (flags.outputDir) {
        const filename = useCache().path(stowage).basename()
        return Path.cwd().join(flags.outputDir, filename)
      } else {
        return Path.cwd().join(flags.o ?? panic())
      }
    })()

    if (type === "git") return clone({ dst, src: url, ref })

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

  console.info(zipfile.string)
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

// Clones a git repo, then builds a src tarball from it
// This allows our system to treat git repos as if they were
// tarballs, improving internal consistency
async function clone({ dst, src, ref }: { dst: Path, src: URL, ref?: string }) {
  if (dst.isFile()) {
    console.info("using cached tarball")
    return dst
  }

  const tmp = Path.mktemp({})

  const args = [
    "clone",
    "--quiet",
    "--depth=1"
  ]
  if (ref) {
    args.push("--branch", ref)
  }
  args.push(
    src.toString(),
    tmp.string,
  )

  // Clone the specific ref to our temp dir
  const proc = new Deno.Command("git", {
    args,
    // `git` uses stderr for... non errors, and --quiet
    // doesn't touch them
    stderr: "null",
  })
  const status = await proc.spawn().status
  if (!status.success) {
    console.error({ dst, src })
    throw new Error(`git failed to clone ${src}`)
  }

  // Create a tarball from the temp dir
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