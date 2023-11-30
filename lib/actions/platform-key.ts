#!/usr/bin/env -S pkgx deno run --allow-env

import { utils } from 'pkgx'
const { arch, platform } = utils.host()
console.log(`${platform}+${arch}`)
