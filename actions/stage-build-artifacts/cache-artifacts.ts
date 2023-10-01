#!/usr/bin/env -S pkgx deno run -A

import { utils, Path } from "pkgx"
import { S3 } from "s3"
const { panic } = utils

const usage = "usage: cache-artifacts.ts {REPO} {REF} {destname} {file}"
const repo = Deno.args[0] ?? panic(usage);
const ref = Deno.args[1] ?? panic(usage);
const dest = Deno.args[2] ?? panic(usage);
const artifacts = Deno.args[3] ?? panic(usage);

if (!repo.startsWith("pkgxdev/")) throw new Error(`offical pkgxdev repos only: ${repo}`)
const pr = parseInt(ref.replace(/refs\/pull\/(\d+)\/merge/, "$1"))
if (isNaN(pr)) throw new Error(`invalid ref: ${ref}`)

console.info({artifacts})
console.info({file: Path.cwd().join(artifacts)})
console.info({exists: Path.cwd().join(artifacts).isFile()})
console.info({cwd: Path.cwd()})
const file = Path.cwd().join(artifacts).isFile() ?? panic(`invalid archive: ${Path.cwd().join(artifacts)}`)

const s3 = new S3({
  accessKeyID: Deno.env.get("AWS_ACCESS_KEY_ID")!,
  secretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
  region: "us-east-1",
})
const bucket = s3.getBucket(Deno.env.get("AWS_S3_BUCKET")!)

const key = `pull-request/${repo.split("/")[1]}/${pr}/${dest}`
const body = await Deno.readFile(file.string)

console.info({ uploadingTo: key })
await bucket.putObject(key, body)
