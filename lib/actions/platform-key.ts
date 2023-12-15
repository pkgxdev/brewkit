#!/usr/bin/env -S pkgx deno run --allow-env --allow-read

import { Command } from "cliffy/command/mod.ts"
import get_config from '../config.ts'
import { utils } from 'pkgx'

let { options: { pkg, platform } } = await new Command()
  .option('--pkg=<pkg>', 'Package name')
  .option('--platform=<platform>', 'Platform name')
  .parse(Deno.args);

platform ??= ((arch, platform) => `${arch}+${platform}`)(utils.host())

const config = await get_config(pkg)

console.log(`${utils.pkg.str(config.pkg)}+${platform}`)
