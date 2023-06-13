#!/usr/bin/env tea

/*---
args:
  - deno
  - run
  - --allow-net
  - --allow-read
  - --allow-env
  - --allow-write
depdenencies:
  aws.amazon.com/cli: ^2
---*/

import { Package, PackageRequirement, SemVer, Path, semver, hooks, utils, porcelain } from "tea"
import { decode as base64Decode } from "deno/encoding/base64.ts"
const { useOffLicense, usePrefix, useCache } = hooks
const { run } = porcelain
import { basename, dirname } from "deno/path/mod.ts"
import { set_output } from "../utils/gha.ts"
import { sha256 } from "../bottle/bottle.ts"
import { retry } from "deno/async/retry.ts"
import { S3, S3Bucket } from "s3"
import usePantry from "../../lib/usePantry.ts"

//------------------------------------------------------------------------- funcs
function args_get(key: string): string[] {
  const it = Deno.args[Symbol.iterator]()
  while (true) {
    const { value, done } = it.next()
    if (done) throw new Error()
    if (value === `--${key}`) break
  }
  const rv: string[] = []
  while (true) {
    const { value, done } = it.next()
    if (done) return rv
    if (value.startsWith("--")) return rv
    rv.push(value)
  }
}

function assert_pkg(pkg: Package | PackageRequirement) {
  if ("version" in pkg) {
    return pkg
  } else {
    return {
      project: pkg.project,
      version: new SemVer(pkg.constraint),
    }
  }
}

async function get_versions(key: string, pkg: Package, bucket: S3Bucket): Promise<SemVer[]> {
  const prefix = dirname(key)
  const rsp = await bucket.listObjects({ prefix })

  //FIXME? API isn’t clear if these nulls indicate failure or not
  //NOTE if this is a new package then some empty results is expected
  const got = rsp
    ?.contents
    ?.compact((x) => x.key)
    .map((x) => basename(x))
    .filter((x) => x.match(/v.*\.tar\.gz$/))
    .map((x) => x.replace(/v(.*)\.tar\.gz/, "$1")) ??
    []

  // have to add pkg.version as put and get are not atomic
  return [...new Set([...got, pkg.version.toString()])]
    .compact(semver.parse)
    .sort(semver.compare)
}

class ExtBucket {
  name: string
  bucket: S3Bucket

  constructor(name: string, s3: S3) {
    this.bucket = s3.getBucket(name)
    this.name = name
  }
}

async function put(key_: string, body: string | Path | Uint8Array, bucket: ExtBucket, qaRequired: boolean) {
  const key = qaRequired ? `qa/${key_}` : key_
  console.info({ uploading: body, to: key })
  if (!qaRequired) rv.push(`/${key}`)
  if (body instanceof Path) {
    // For really large files, just kick it to the CLI
    if (Deno.statSync(body.string).size > 1024 * 1024 * 1024) {
      console.log("large file (>1GB), using aws cli")
      const filename = body.string
      console.log(["aws", "s3", "cp", filename, `s3://${bucket.name}/${key}`])
      return retry(() => run(["aws", "s3", "cp", filename, `s3://${bucket.name}/${key}`]))
    }
    body = await Deno.readFile(body.string)
  } else if (typeof body === "string") {
    body = encode(body)
  }
  // @ts-ignore typescript doesn't narrow the types properly here
  return retry(()=>bucket.putObject(key, body))
}

//------------------------------------------------------------------------- main

if (Deno.args.length === 0) throw new Error("no args supplied")

const s3 = new S3({
  accessKeyID: Deno.env.get("AWS_ACCESS_KEY_ID")!,
  secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
  region: "us-east-1",
})

const bucket = new ExtBucket(Deno.env.get("AWS_S3_BUCKET")!, s3)
const stagingBucket = new ExtBucket(Deno.env.get("AWS_S3_STAGING_BUCKET")!, s3)

const encode = (() => {
  const e = new TextEncoder()
  return e.encode.bind(e)
})()
const cache = useCache()

const pkgs = args_get("pkgs").map(utils.pkg.parse).map(assert_pkg)
const srcs = args_get("srcs")
const bottles = args_get("bottles")
const checksums = args_get("checksums")
const signatures = args_get("signatures")

const rv: string[] = []
const qa = new Set<string>()

for (const [index, pkg] of pkgs.entries()) {
  const yml = await usePantry().project(pkg.project).yaml()
  const qaRequired = yml?.["test"]?.["qa-required"] === true
  const dst = qaRequired ? stagingBucket : bucket

  const bottle = usePrefix().join(bottles[index])
  const checksum = checksums[index]
  const signature = base64Decode(signatures[index])
  const stowed = cache.decode(bottle)!
  const key = useOffLicense("s3").key(stowed)
  const versions = await get_versions(key, pkg, dst.bucket)

  //FIXME stream the bottle (at least) to S3
  await put(key, bottle, dst, qaRequired)
  await put(`${key}.sha256sum`, `${checksum}  ${basename(key)}`, dst, qaRequired)
  await put(`${key}.asc`, signature, dst, qaRequired)
  await put(`${dirname(key)}/versions.txt`, versions.join("\n"), dst, qaRequired)

  // mirror the sources
  if (srcs[index] != "~") {
    const src = usePrefix().join(srcs[index])
    if (src.isDirectory()) {
      // we almost certainly expanded `~` to the user’s home directory
      continue
    }
    const srcKey = useOffLicense("s3").key({
      pkg: stowed.pkg,
      type: "src",
      extname: src.extname(),
    })
    const srcChecksum = await sha256(src)
    const srcVersions = await get_versions(srcKey, pkg, dst.bucket)
    await put(srcKey, src, dst, qaRequired)
    await put(`${srcKey}.sha256sum`, `${srcChecksum}  ${basename(srcKey)}`, dst, qaRequired)
    await put(`${dirname(srcKey)}/versions.txt`, srcVersions.join("\n"), dst, qaRequired)
  }

  if (qaRequired) {
    qa.add(`${pkg.project}@${pkg.version}`)
  }
}

await set_output("cf-invalidation-paths", rv)
await set_output("qa-required", [JSON.stringify([...qa])])
