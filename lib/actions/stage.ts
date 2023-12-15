#!/usr/bin/env -S pkgx deno run --allow-read --allow-env --allow-write

import { hooks, Path } from "pkgx"
import get_config from '../config.ts'

const config = await get_config(Deno.args[1])

const pkg = config.pkg
const { path } = await hooks.useCellar().resolve(pkg)

const stage = new Path(Deno.args[0])

path.mv({ into: stage.join(pkg.project).mkdir('p') })

console.log(stage)
