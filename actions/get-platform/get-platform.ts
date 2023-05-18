#!/usr/bin/env tea

/*---
args:
  - deno
  - run
  - --allow-read
  - --allow-env
  - --allow-write
---*/

import { parse, str } from "utils/pkg.ts"
import { panic } from "utils"
import tea_init from "../../lib/init().ts"
import usePantry from "../../lib/usePantry.ts"

// These are only needed if we switch back to GHA runners

// const exceptions: { [project: string]: number } = {
//   "deno.land": 4,
//   "ziglang.org": 8,
// }

const requiresMacOS12 = ["github.com/realm/SwiftLint"]

tea_init()

const packages = Deno.env.get("PROJECTS")?.trim().split(" ").filter(x => x).map(parse)

type Output = {
  os: OS,
  buildOs: OS,
  container?: string,
  testMatrix: { os: OS, container?: string }[]
  available: string
}

type OS = string | string[]

const platform = Deno.env.get("PLATFORM") ?? panic("$PLATFORM not set")

const available = await (async () => {
  const pantry = usePantry()
  const platform_ = platform.replace(/\+/, "/")

  if (!packages) return ""

  const rv = []

  for (const pkg of packages) {
    const a = await pantry.getPlatforms(pkg)
    if (a.includes(platform_)) rv.push(pkg)
  }

  return rv.map(str).join(" ")
})()

const output: Output = (() => {
  switch(platform) {
  case "darwin+x86-64": {
    // Some packages need macOS 12
    const os = (() => {
      if (packages?.some(pkg => requiresMacOS12.includes(pkg.project)))
        return ["self-hosted", "macOS", "X64"]
      return "macos-11"
    })()
    return {
      os,
      buildOs: ["self-hosted", "macOS", "X64"],
      testMatrix: [{ os }],
      available,
    }
  }
  case "darwin+aarch64": {
    const os = ["self-hosted", "macOS", "ARM64"]
    return {
      os,
      buildOs: os,
      testMatrix: [{ os }],
      available,
    }
  }
  case "linux+aarch64": {
    const os = ["self-hosted", "linux", "ARM64"]
    return {
      os,
      buildOs: os,
      testMatrix: [{ os }],
      available,
    }
  }
  case "linux+x86-64": {
    // buildOs: sizedUbuntu(packages),
    const os = "ubuntu-latest"
    return {
      os,
      buildOs: ["self-hosted", "linux", "X64"],
      testMatrix: [
        { os, container: "ubuntu:focal", 'name-extra': "(ubuntu focal)" },
        { os, container: "debian:buster-slim", 'name-extra': "(debian buster)" },
      ],
      available,
    }
  }
  default:
    panic(`Invalid platform description: ${platform}`)
}})()

const rv = `os=${JSON.stringify(output.os)}\n` +
  `build-os=${JSON.stringify(output.buildOs)}\n` +
  `container=${JSON.stringify(output.container)}\n` +
  `test-matrix=${JSON.stringify(output.testMatrix)}\n` +
  `available=${output.available}\n`

Deno.stdout.write(new TextEncoder().encode(rv))

if (Deno.env.get("GITHUB_OUTPUT")) {
  const envFile = Deno.env.get("GITHUB_OUTPUT")!
  await Deno.writeTextFile(envFile, rv, { append: true})
}

// Leaving this in case we need to switch back to GHA runners

// function sizedUbuntu(packages: (Package | PackageRequirement)[]): string {
//   const size = Math.max(2, ...packages.map(p => exceptions[p.project] ?? 2))

//   if (size == 2) {
//     return "ubuntu-latest"
//   } else if ([4, 8, 16].includes(size)) {
//     return `ubuntu-latest-${size}-cores`
//   } else {
//     panic(`Invalid size: ${size}`)
//   }
// }