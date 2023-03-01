#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-net
  - --allow-read
  - --allow-env=TEA_PREFIX,TEA_PANTRY_PATH
---*/

import { parseFlags } from "cliffy/flags/mod.ts"
import { parse, str } from "utils/pkg.ts"
import { usePantry } from "hooks"
import { hydrate } from "prefab"

const { flags: { build, test }, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "build"
  }, {
    name: "test"
  }],
})

const pkg = parse(pkgname)
const pantry = usePantry()

/// we don’t hydrate([pkg]) because that means [pkg] is incorporated into the graph
/// which (surprisignly) we don’t want, eg. if we're building go, it requires itself
/// but we don’t want the build graph to include that specific version of go since
/// we haven't yet built it.

const { runtime: dry, ...deps } = await pantry.getDeps(pkg)
if (build) dry.push(...deps.build)
if (test) dry.push(...deps.test)

const { pkgs: wet } = await hydrate(dry)

console.log(wet.map(str).join("\n"))
