#!//usr/bin/env -S pkgx deno run --allow-read --allow-net --allow-env

const { useCellar, usePantry } = hooks
import { parseFlags } from "cliffy/flags/mod.ts"
import { utils, hooks } from "pkgx"
const { parse, str } = utils.pkg

const { flags, unknown: [pkgname] } = parseFlags(Deno.args, {
  flags: [{
    name: "cellar",
  }]
})

if (!flags.cellar) {
  const pkg = await usePantry().resolve(parse(pkgname))
  console.info(str(pkg))
} else {
  const entry = await useCellar().has(parse(pkgname))
  if (!entry) {
    throw new Error(`${pkgname} not installed in $PKGX_DIR`)
  }
  console.info(str(entry.pkg))
}
