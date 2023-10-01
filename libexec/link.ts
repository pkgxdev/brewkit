#!//usr/bin/env -S pkgx deno run --allow-read --allow-write --allow-env --allow-run=/bin/ln

import { PackageRequirement, Package, Path, utils, plumbing } from "pkgx"
const { link } = plumbing

let pkg: Package | PackageRequirement = utils.pkg.parse(Deno.args[1])
pkg = { project: pkg.project, version: pkg.constraint.single() ?? utils.panic() }

const path = new Path(Deno.args[0])

await link({ pkg, path })
