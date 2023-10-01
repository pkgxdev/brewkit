import { isArray } from "is-what"
import { Path } from "pkgx"

export async function backticks({ cmd }: { cmd: Path | (string | Path)[]}): Promise<string> {
  const args = isArray(cmd) ? cmd.map(x => `${x}`) : [cmd.string]
  const proc = new Deno.Command(args.shift()!, { args, stdout: "piped" })
  const out = await proc.output()
  const txt = new TextDecoder().decode(out.stdout)
  return txt
}

declare global {
  interface Array<T> {
    uniq(): Array<T>
  }
}

Array.prototype.uniq = function<T>(): Array<T> {
  const set = new Set<T>()
  return this.compact(x => {
    const s = x.toString()
    if (set.has(s)) return
    set.add(s)
    return x
  })
}

export function swallow<T>(fn: () => T) {
  try { return fn() } catch { /*noop*/ }
}
