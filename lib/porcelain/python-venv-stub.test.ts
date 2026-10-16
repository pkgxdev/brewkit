import { assert, assertEquals } from "deno/testing/asserts.ts"

const stub = new URL("../../share/brewkit/python-venv-stub.py", import.meta.url).pathname

// layout mirrors an installed pkg: <root>/bin/<cmd> is the stub, <root>/venv is the venv
async function fixture() {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "venv-stub-" }))
  await Deno.mkdir(`${root}/bin`)
  await Deno.mkdir(`${root}/venv/bin`, { recursive: true })
  await Deno.copyFile(stub, `${root}/bin/tool`)
  await Deno.chmod(`${root}/bin/tool`, 0o755)
  // stale, as if the pkg were relocated or python moved
  await Deno.writeTextFile(`${root}/venv/pyvenv.cfg`, "home = /nowhere\n")
  await Deno.writeTextFile(`${root}/venv/bin/tool`, "#!/old/place/python\nimport sys\nprint('ok')\n")
  await Deno.chmod(`${root}/venv/bin/tool`, 0o755)
  await Deno.symlink("/old/place/python", `${root}/venv/bin/python`)
  return root
}

async function listing(root: string) {
  const out: string[] = []
  for await (const e of Deno.readDir(`${root}/venv`)) out.push(e.name)
  for await (const e of Deno.readDir(`${root}/venv/bin`)) out.push(`bin/${e.name}`)
  return out.sort()
}

Deno.test("parallel runs neither fail nor add files", async () => {
  const root = await fixture()
  try {
    // the stub's own shebang is `env python`; run it with python3 explicitly
    const run = () => new Deno.Command("python3", { args: [`${root}/bin/tool`], stdout: "piped", stderr: "piped" }).output()
    const results = await Promise.all(Array.from({ length: 24 }, run))
    for (const r of results) {
      assert(r.success, new TextDecoder().decode(r.stderr))
      assertEquals(new TextDecoder().decode(r.stdout), "ok\n")
    }
    // nothing may be added to the tree, ever
    assertEquals(await listing(root), ["bin", "bin/python", "bin/tool", "pyvenv.cfg"])
    const shebang = (await Deno.readTextFile(`${root}/venv/bin/tool`)).split("\n")[0]
    assertEquals(shebang, `#!${root}/venv/bin/python`)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test("current venv is not rewritten", async () => {
  const root = await fixture()
  try {
    const run = () => new Deno.Command("python3", { args: [`${root}/bin/tool`] }).output()
    await run()
    const mtimes = async () => (await Promise.all(
      ["pyvenv.cfg", "bin/tool"].map(f => Deno.stat(`${root}/venv/${f}`)))).map(x => x.mtime!.getTime())
    const before = await mtimes()
    await new Promise(r => setTimeout(r, 50))
    await run()
    assertEquals(await mtimes(), before)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

// a relocated pkg keeps its interpreter and cfg but its shebangs point at the old venv path
Deno.test("stale shebang is fixed even when cfg and symlink are current", async () => {
  const root = await fixture()
  try {
    const run = () => new Deno.Command("python3", { args: [`${root}/bin/tool`], stdout: "piped", stderr: "piped" }).output()
    await run()
    const tool = `${root}/venv/bin/tool`
    await Deno.writeTextFile(tool, "#!/old/place/python\nprint('ok')\n")
    const r = await run()
    assert(r.success, new TextDecoder().decode(r.stderr))
    assertEquals((await Deno.readTextFile(tool)).split("\n")[0], `#!${root}/venv/bin/python`)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
