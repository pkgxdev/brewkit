#!/usr/bin/env -S pkgx deno run --allow-env --allow-read

import { Command } from "cliffy/command/mod.ts"
import get_config from '../config.ts'
import { utils } from 'pkgx'

let { options: { pkg, platform } } = await new Command()
  .option('--pkg=[type:string]', 'Package name')
  .option('--platform=<platform>', 'Platform name')
  .parse(Deno.args);

platform ??= (({arch, platform}) => `${platform}+${arch}`)(utils.host())

if (pkg === true) pkg = undefined //fuck knows what Cliffy is doing here

const config = await get_config(pkg as string | undefined)

console.log(`${encodeURIComponent(utils.pkg.str(config.pkg))}+${platform}`)
