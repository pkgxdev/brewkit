import { utils, hooks, PackageRequirement } from "pkgx"

export default async function(input: string, opts?: { latest: 'ok' }): Promise<PackageRequirement & { update?: boolean }> {
  let update = false

  if (opts?.latest && input.endsWith("@latest")) {
    input = input.slice(0, -7)
    update = true
  }

  const rawpkg = utils.pkg.parse(input)

  const projects = await hooks.usePantry().find(rawpkg.project)
  if (projects.length <= 0) throw new Error(`nothing provides: ${input}`)
  if (projects.length > 1) throw new Error(`ambiguous pkg: ${input}: ${projects}`)

  const project = projects[0].project //FIXME libpkgx forgets to correctly assign type
  const constraint = rawpkg.constraint

  return { project, constraint, update }
}
