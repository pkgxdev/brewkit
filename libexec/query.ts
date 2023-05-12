#!/usr/bin/env -S deno run --allow-read --allow-env --allow-write --allow-net

import { Package, PackageRequirement, Stowage } from "types"
import { flatmap, panic, host } from "utils"
import { parseFlags } from "cliffy/flags/mod.ts"
import { useCache, useCellar } from "hooks"
import usePantry from "../lib/usePantry.ts"
import { parse, str } from "utils/pkg.ts"
import Path from "path"

import tea_init from "../lib/init().ts"
tea_init()

const { flags: { prefix, srcdir, src, testdir, versions, ...flags }, unknown: [pkgname] } = parseFlags(Deno.args, {
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
  }, {
    name: "url",
    standalone: true
  }]
})

let pkg: PackageRequirement | Package = parse(pkgname)

if (versions) {
  const versions = await usePantry().getVersions(pkg)
  console.log(versions.sort().join("\n"))
  Deno.exit(0)
}

const version = pkg.constraint.single() ?? panic()
pkg = {project: pkg.project, version }

if (src) {
  const { url, type } = await usePantry().getDistributable(pkg) ?? {}
  if (!url) {
    console.error("warn: pkg has no srcs: ", str(pkg))
    Deno.exit(0)  // NOT AN ERROR EXIT CODE THO
  }
  const stowage: Stowage = (() => {
    if (type === 'git')
      return { pkg, type: 'src', extname: '.tar.xz' }
    return { pkg, type: 'src', extname: url.path().extname() }
  })()
  const path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  const cache_path = useCache().path(stowage)
  if (path?.join("projects").isDirectory()) {
    await console.log(`${path.join("srcs", cache_path.basename())}`)
  } else {
    await console.log(cache_path.string)
  }
} else if (prefix) {
  const path = useCellar().keg(pkg)
  await console.log(path.string)
} else if (srcdir) {
  let path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  if (path?.join("projects").isDirectory()) {
    const project = pkg.project.replaceAll("/", "∕")
    const platform = host().platform
    path = path.join("builds").join(`${project}-${pkg.version}+${platform}`)
  } else {
    path = new Path(Deno.makeTempDirSync())
  }
  await console.log(path.string)
} else if (testdir) {
  let path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  if (path?.join("projects").isDirectory()) {
    const project = pkg.project.replaceAll("/", "∕")
    const platform = host().platform
    path = path.join("testbeds").join(`${project}-${pkg.version}+${platform}`)
  } else {
    path = new Path(Deno.makeTempDirSync())
  }
  await console.log(path.string)
} else if (flags.url) {
  const { url } = await usePantry().getDistributable(pkg) ?? {}
  if (url) {
    console.log(url.toString())
  } else {
    console.error("null")
    Deno.exit(2)
  }
} else {
  Deno.exit(1)
}
