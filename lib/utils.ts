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

export async function gum(title: string) {
  await new Deno.Command("gum", {args: ['format', `# ${title}`]}).spawn().status
}

export function find_pkgx() {
  return find_in_PATH('pkgx')
}
export function find_in_PATH(program: string) {
  for (const part of Deno.env.get("PATH")?.split(":") ?? []) {
    const path = (Path.abs(part) || Path.cwd().join(part)).join(program)
    if (path.isExecutableFile()) {
      return path
    }
  }
  throw new Error(`couldn't find \`${program}\` binary`)
}

export async function rsync(from: Path, to: Path, additional_args: string[] = []) {
  console.log(`rsync ${from.string} ${to.string}`)
  to.parent().mkdir('p')
  const v = Deno.env.get("VERBOSE") ? 'v' : ''
  const args = [`-a${v}`, '--delete', ...additional_args, `${from.string}/`, to.string]
  const {success} = await new Deno.Command("rsync", {args}).spawn().status
  if (!success) throw new Error("rsync failed")
}
