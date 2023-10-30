#!//usr/bin/env -S pkgx deno run --allow-read --allow-env --allow-write --allow-net

import { utils, hooks, Package, PackageRequirement, Stowage, Path } from "pkgx"
const { host, flatmap, pkg: { parse, str } } = utils
import { parseFlags } from "cliffy/flags/mod.ts"
const { useCache, useCellar, usePantry } = hooks
const { panic } = utils

const { flags: { prefix, srcdir, src, testdir, blddir, versions, ...flags }, unknown: [pkgname] } = parseFlags(Deno.args, {
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
    name: "blddir",
    aliases: ["build-dir"],
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
  console.info(versions.sort().join("\n"))
  Deno.exit(0)
}

const {version} = await usePantry().resolve(pkg) ?? panic()
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
    return { pkg, type: 'src', extname: new Path(url.pathname).extname() }
  })()
  const path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  const cache_path = useCache().path(stowage)
  if (path?.join("projects").isDirectory()) {
    console.info(`${path.join("srcs", cache_path.basename())}`)
  } else {
    console.info(cache_path.string)
  }
} else if (prefix) {
  const path = useCellar().keg(pkg)
  console.info(path.string)
} else if (blddir) {
  let path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  if (path?.join("projects").isDirectory()) {
    const project = pkg.project.replaceAll("/", "∕")
    const platform = host().platform
    path = path.join("builds").join(`${project}-${pkg.version}+${platform}`)
  } else {
    path = new Path(Deno.makeTempDirSync())
  }
  console.info(path.string)
} else if (testdir) {
  let path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  if (path?.join("projects").isDirectory()) {
    const project = pkg.project.replaceAll("/", "∕")
    const platform = host().platform
    path = path.join("testbeds").join(`${project}-${pkg.version}+${platform}`)
  } else {
    path = new Path(Deno.makeTempDirSync())
  }
  console.info(path.string)
} else if (flags.url) {
  const { url } = await usePantry().getDistributable(pkg) ?? {}
  if (url) {
    console.info(url.toString())
  } else {
    console.error("null")
    Deno.exit(2)
  }
} else if (srcdir) {
  let path = flatmap(Deno.env.get("SRCROOT"), x => new Path(x))
  if (path?.join("projects").isDirectory()) {
    const project = pkg.project.replaceAll("/", "∕")
    path = path.join("srcs").join(`${project}-${pkg.version}`)
  } else {
    path = new Path(Deno.makeTempDirSync())
  }
  console.info(path.string)
} else {
  Deno.exit(1)
}
