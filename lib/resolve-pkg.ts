import { Path, utils, hooks, SemVer, semver } from "pkgx"
const { usePantry } = hooks

export default async function(arg?: string) {
  if (!arg) {
    arg ||= Deno.env.get("BREWKIT_PKGJSON")
    arg ||= Deno.env.get("BREWKIT_PKGSPEC")
    arg ||= (await get_pantry_status())?.[0]
    if (!arg) throw new Error(`usage: bk <CMD> <pkgspec>`)
  }

  const { pkg, constraint, path } = await (async (arg: string) => {
    if (arg.startsWith("{")) {
      const json = JSON.parse(arg)
      const project = json.project
      const version = new SemVer(json.version.raw);
      (version as unknown as any).tag = json.version.tag
      const [found] = await usePantry().find(project)
      return {
        pkg: {project, version},
        constraint: new semver.Range(`=${version}`),
        path: found.path
      }
    } else {
      const { constraint, project } = utils.pkg.parse(arg.trim())
      const [found, ...rest] = await usePantry().find(project)
      if (rest.length) throw new Error("ambiguous pkg spec")
      const pkg = await usePantry().resolve({project: found.project, constraint})
      return { constraint, path: found.path, pkg }
    }
  })(arg)

  return {pkg, path, constraint}
}

async function get_pantry_status() {
  const bkroot = new Path(new URL(import.meta.url).pathname).parent().parent()
  const proc = new Deno.Command("bash", {args: [bkroot.join('bin/bk-status').string], stdout: 'piped'}).spawn()
  const [out, { success }] = await Promise.all([proc.output(), proc.status])
  if (success) {
    return new TextDecoder().decode(out.stdout).split(/\s+/).filter(x => x)
  }
}
