#!/usr/bin/env tea

/*---
dependencies:
  deno.land: '>=1.32<1.36.1'
args:
  - deno
  - run
  - --allow-read
  - --allow-env
  - --allow-write
---*/

import { utils, hooks } from "tea"
const { parse, str } = utils.pkg
const { usePantry } = hooks
const { panic } = utils

// These are only needed if we switch back to GHA runners

// const exceptions: { [project: string]: number } = {
//   "deno.land": 4,
//   "ziglang.org": 8,
// }

const requiresMacOS12 = ["github.com/realm/SwiftLint"]

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
        return "macos-12"
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
        { os, container: "ubuntu:latest", 'name-extra': "(ubuntu latest)" },
        { os, container: "ubuntu:focal", 'name-extra': "(ubuntu focal)" },
        { os, container: "debian:buster-slim", 'name-extra': "(debian buster)" },
      ],
      available,
    }
  }
  default:
    throw new Error(`Invalid platform description: ${platform}`)
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