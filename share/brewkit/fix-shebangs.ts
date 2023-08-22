#!/usr/bin/env -S deno run -A

import { Path } from "tea"
import undent from "outdent"

const has_shebang = (() => {
  const encoder = new TextDecoder()
  return (buf: Uint8Array) => {
    return encoder.decode(buf) == '#!'
  }
})()

for (const path of Deno.args) {
  if (!Path.cwd().join(path).isFile()) continue

  console.debug({ path })

  const rid = await Deno.open(path, { read: true })
  try {
    const buf = new Uint8Array(2)
    await rid.read(buf)
    if (!has_shebang(buf)) continue
  } finally {
    rid.close()
  }

  //FIXME this could be pretty damn efficient if we can find the time
  //NOTE as it stands this is HIDEOUSLY inefficient

  const contents = await Deno.readFile(path)
  const txt = new TextDecoder().decode(contents)
  const [line0, ...lines] = txt.split("\n") //lol

  const match = line0.match(/^#!\s*(\/[^\s]+)/)
  if (!match) throw new Error()
  const interpreter = match[1]

  switch (interpreter) {
  case "/usr/bin/env":
  case "/bin/sh":
    console.log({ line0, path })
    console.log("^^ skipped acceptable shebang")
    continue
  }

  const shebang = `#!/usr/bin/env ${new Path(interpreter).basename()}`

  const rewrite = undent`
    ${shebang}
    ${lines.join("\n")}
    `

  console.log({rewrote: path, to: `#!/usr/bin/env ${interpreter}`})

  const stat = Deno.lstatSync(path)
  const needs_chmod = stat.mode && !(stat.mode & 0o200)
  if (needs_chmod) Deno.chmodSync(path, 0o666)
  await Deno.writeFile(path, new TextEncoder().encode(rewrite))
  if (needs_chmod) Deno.chmodSync(path, stat.mode!)
}
