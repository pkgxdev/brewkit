#!/usr/bin/env -S deno run --allow-read --allow-env=TEA_PREFIX,TEA_PANTRY_PATH,SRCROOT,GITHUB_TOKEN --allow-write --allow-net

import { Package, PackageRequirement, Stowage } from "types"
import { flatmap, panic, print, host } from "utils"
import { parseFlags } from "cliffy/flags/mod.ts"
import { useCache, useCellar } from "hooks"
import usePantry from "../lib/usePantry.ts"
import { parse, str } from "utils/pkg.ts"
import Path from "path"

const { flags: { prefix, srcdir, src, testdir, versions }, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "prefix",
    standalone: true
  }, {
    name: "srcdir",
    standalone: true
  }, {
    name: "src",
    standalone: true
  }, {
    name: "testdir",
    standalone: true
  }, {
    name: "versions",
    standalone: true
  }]
})

let pkg: PackageRequirement | Package = parse(pkgname)

if (versions) {
  const versions = await usePantry().getVersions(pkg)
  await print(versions.sort().join("\n"))
  Deno.exit(0)
}

const version = pkg.constraint.single() ?? panic()
pkg = {project: pkg.project, version }

if (src) {
  const { url } = await usePantry().getDistributable(pkg) ?? {}
  if (!url) {
    console.error("warn: pkg has no srcs: ", str(pkg))
    Deno.exit(0)  // NOT AN ERROR EXIT CODE THO
  }
  const stowage: Stowage = { pkg, type: 'src', extname: url.path().extname() }
  const path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  const cache_path = useCache().path(stowage)
  if (path?.join("projects").isDirectory()) {
    await print(`${path.join("srcs", cache_path.basename())}`)
  } else {
    await print(cache_path.string)
  }
} else if (prefix) {
  const path = useCellar().keg(pkg)
  await print(path.string)
} else if (srcdir) {
  let path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  if (path?.join("projects").isDirectory()) {
    const project = pkg.project.replaceAll("/", "∕")
    const platform = host().platform
    path = path.join("builds").join(`${project}-${pkg.version}+${platform}`)
  } else {
    path = new Path(Deno.makeTempDirSync())
  }
  await print(path.string)
} else if (testdir) {
  let path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  if (path?.join("projects").isDirectory()) {
    const project = pkg.project.replaceAll("/", "∕")
    const platform = host().platform
    path = path.join("testbeds").join(`${project}-${pkg.version}+${platform}`)
  } else {
    path = new Path(Deno.makeTempDirSync())
  }
  await print(path.string)
} else {
  Deno.exit(1)
}
