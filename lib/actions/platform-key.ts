#!/usr/bin/env -S pkgx deno run --allow-env --allow-read

import { Command } from "cliffy/command/mod.ts"
import get_config from '../resolve-pkg.ts'
import { utils } from 'pkgx'

let { options: { pkg, platform } } = await new Command()
  .option('--pkg=[type:string]', 'Package name')
  .option('--platform=[type:string]', 'Platform name')
  .parse(Deno.args);

if (platform === true) platform = undefined
// ^^ unfortunate that we need to accept empty string due to GITHUB ACTIONS
// BEING SUPER GOOD and Cliffy then takes that to mean “true” as it
// interprets it as FLAG ON
platform ??= (({arch, platform}) => `${platform}+${arch}`)(utils.host())
if (pkg === true) pkg = undefined

const config = await get_config(pkg as string | undefined)

console.log(`${utils.pkg.str(config.pkg).replace('/', '_')}+${platform}`)
