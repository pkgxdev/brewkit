#!/usr/bin/env -S tea +gnu.org/tar^1.34 +tukaani.org/xz^5 +zlib.net^1 +gnupg.org^2 +deno.land>=1.32<1.36.1 deno run -A

import { encode as base64Encode } from "deno/encoding/base64.ts"
import { Installation, Path, hooks, utils } from "tea"
import { backticks } from "../../lib/utils.ts"
import { encode } from "deno/encoding/hex.ts"
import { set_output } from "../utils/gha.ts"
import { crypto } from "deno/crypto/mod.ts"
import * as ARGV from "../utils/args.ts"

const { useCellar, usePrefix, useCache } = hooks
const cellar = useCellar()
const { panic } = utils

//-------------------------------------------------------------------------- main

if (import.meta.main) {
  const compression = Deno.env.get("COMPRESSION") == 'xz' ? 'xz' : 'gz'
  const gpgKey = Deno.env.get("GPG_KEY_ID") ?? panic("missing GPG_KEY_ID")
  const checksums: string[] = []
  const signatures: string[] = []
  const bottles: Path[] = []

  for await (const pkg of ARGV.pkgs()) {
    console.info({ bottling: pkg })

    const installation = await cellar.resolve(pkg)
    const path = await bottle(installation, compression)
    const checksum = await sha256(path)
    const signature = await gpg(path, gpgKey)

    console.info({ bottled: path })

    bottles.push(path)
    checksums.push(checksum)
    signatures.push(signature)
  }

  await set_output("bottles", bottles.map(b => b.relative({ to: usePrefix() })))
  await set_output("checksums", checksums)
  await set_output("signatures", signatures)
}


//------------------------------------------------------------------------- funcs
export async function bottle({ path: kegdir, pkg }: Installation, compression: 'gz' | 'xz'): Promise<Path> {
  const tarball = useCache().path({ pkg, type: 'bottle', compression })
  const z = compression == 'gz' ? 'z' : 'J'
  const cwd = usePrefix()
  const cmd = ["tar", `c${z}f`, tarball, kegdir.relative({ to: cwd })].map(x => x.toString())
  const { success } = await Deno.run({ cmd, cwd: cwd.string }).status()
  if (!success) throw new Error("failed to bottle via tar")
  return tarball
}

export async function sha256(file: Path): Promise<string> {
  return await Deno.open(file.string, { read: true })
    .then(file => crypto.subtle.digest("SHA-256", file.readable))
    .then(buf => new TextDecoder().decode(encode(new Uint8Array(buf))))
}

async function gpg(file: Path, gpgKey: string): Promise<string> {
  const rv = await backticks({
    cmd: [
      "gpg",
      "--detach-sign",
      "--armor",
      "--output",
      "-",
      "--local-user",
      gpgKey,
      file.string
    ]
  })
  return base64Encode(rv)
}