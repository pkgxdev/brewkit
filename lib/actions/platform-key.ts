#!/usr/bin/env -S pkgx deno run --allow-env --allow-read

import { Command } from "cliffy/command/mod.ts"
import get_config from '../config.ts'
import { utils } from 'pkgx'

let { options: { pkg, platform } } = await new Command()
  .option('--pkg=<pkg>', 'Package name').allowEmpty()
  .option('--platform=<platform>', 'Platform name')
  .parse(Deno.args);

platform ??= (({arch, platform}) => `${platform}+${arch}`)(utils.host())

const config = await get_config(pkg as string | undefined)

console.log(`${encodeURIComponent(utils.pkg.str(config.pkg))}+${platform}`)
