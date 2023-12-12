#!/usr/bin/env -S pkgx deno run --allow-read --allow-env --allow-write

import { hooks, utils, Path } from "pkgx"

const pkg = utils.pkg.parse(Deno.args[1]?.trim() || Deno.env.get('BREWKIT_PKGSPEC')!)
const { path } = await hooks.useCellar().resolve(pkg)

const stage = new Path(Deno.args[0])

path.mv({ into: stage.join(pkg.project).mkdir('p') })

console.log(stage)
