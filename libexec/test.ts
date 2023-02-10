#!/usr/bin/env -S tea -E

//TODO limit writes to $PWD/out

/*---
dependencies:
  gnu.org/bash: '*'
args:
  - deno
  - run
  - --allow-net
  - --allow-run
  - --allow-read
  - --allow-write={{cwd}}/out/test
  - --allow-env
  - --unstable
---*/

import { Installation, Package, PackageRequirement } from "types"
import { usePantry, useFlags, usePrefix, useCellar } from "hooks"
import useShellEnv, { expand } from "hooks/useShellEnv.ts"
import { run, undent, pkg as pkgutils, panic } from "utils"
import { resolve, install, hydrate, link } from "prefab"
import Path from "path"

useFlags()
const pantry = usePantry()

const rq = pkgutils.parse(Deno.args[0])
const pkg = await useCellar().has(rq) ?? panic()
await test(pkg)

async function test(self: Installation) {
  const yml = await pantry.getYAML(self.pkg).parse()
  const deps = await deps4(self.pkg)
  const installations = await prepare(deps)

  // if we are testing multiple packages, they might not
  // get linked when they're tested.
  await link(self)

  const env = await useShellEnv({ installations })

  env['PATH'].push("$PATH")

  let text = undent`
    #!/usr/bin/env bash

    set -e
    set -o pipefail
    set -x

    export TEA_PREFIX=${usePrefix()}

    ${expand(env)}

    `

  const tmp = Path.mktmp({ prefix: pkgutils.str(self.pkg) })

  try {
    if (yml.test.fixture) {
      const fixture = tmp.join("fixture.tea").write({ text: yml.test.fixture.toString() })
      text += `export FIXTURE="${fixture}"\n\n`
    }

    const cwd = tmp.join("wd").mkdir()

    text += `cd "${cwd}"\n\n`

    text += await pantry.getScript(self.pkg, 'test', installations)
    text += "\n"

    for await (const [path, {name, isFile}] of pantry.getYAML(self.pkg).path.parent().ls()) {
      if (isFile && name != 'package.yml') {
        path.cp({ into: cwd })
      }
    }

    const cmd = tmp
      .join("test.sh")
      .write({ text, force: true })
      .chmod(0o500)
    await run({ cmd, cwd })
    tmp.rm({ recursive: true })
  } catch (e) {
    console.info("due to error, didn’t delete:", tmp)
    throw e
  }
}


//TODO install step in CI should do this for test requirements also
async function prepare(reqs: (Package | PackageRequirement)[]) {
  const { pending, installed } = await resolve(reqs)
  for await (const pkg of pending) {
    const installation = await install(pkg)
    await link(installation)
    installed.push(installation)
  }
  return installed
}

async function deps4(pkg: Package) {
  return (await hydrate(pkg, async (pkg, dry) => {
    const { runtime, test } = await pantry.getDeps(pkg)
    return dry ? [...runtime, ...test] : runtime
  })).pkgs
}
