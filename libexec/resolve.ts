#!/usr/bin/env -S tea -E

/*---
args:
  - deno
  - run
  - --allow-read
  - --allow-net
  - --allow-env=GITHUB_TOKEN
---*/

import { usePantry } from "hooks"
import { parse, str } from "utils/pkg.ts"
import { print } from "utils"

const pantry = usePantry()
const pkg = await pantry.resolve(parse(Deno.args[0]))

await print(`${str(pkg)}\n`)
