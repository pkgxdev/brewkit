import { RunOptions } from "hooks/useRun.ts"
import { isArray } from "is_what"

export async function backticks(opts: RunOptions): Promise<string> {
  const cmd = isArray(opts.cmd) ? opts.cmd.map(x => `${x}`) : [opts.cmd.string]
  const cwd = opts.cwd?.toString()
  console.verbose({ cwd, ...opts, cmd })
  const proc = Deno.run({ ...opts, cwd, cmd, stdout: "piped" })
  const out = await proc.output()
  const txt = new TextDecoder().decode(out)
  return txt
}
