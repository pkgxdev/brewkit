import { Package, PackageRequirement, SemVer, semver, utils, hooks } from "libtea"
import { isNumber, isPlainObject, isString, isArray, PlainObject } from "is-what"
import { getScript } from "./usePantry.getScript.ts"
import useGitLabAPI from "./useGitLabAPI.ts"
import useGitHubAPI from "./useGitHubAPI.ts"

const { flatmap, validate } = utils
const { useMoustaches } = hooks

export interface Interpreter {
  project: string
  args: string[]
}

export default function() {
  const foo = hooks.usePantry()
  return {
    getVersions,
    getDistributable,
    getScript,
    getPlatforms,
    resolve,
    getDeps,
    filepath,
    ...foo
  }
}

const getDeps = async (pkg: Package | PackageRequirement) => {
  const { parse_pkgs_node, project } = hooks.usePantry()
  const yml = await project(pkg).yaml()
  const runtime = parse_pkgs_node(yml.dependencies)
  const build = parse_pkgs_node(yml.build?.dependencies)
  const test = parse_pkgs_node(yml.test?.dependencies)
  return { runtime, build, test }
}

async function resolve(spec: Package | PackageRequirement): Promise<Package> {
  const constraint = "constraint" in spec ? spec.constraint : new semver.Range(`=${spec.version}`)
  const versions = await getVersions(spec)
  const version = constraint.max(versions)
  if (!version) {
    console.error({versions})
    throw new Error(`not-found: version: ${utils.pkg.str(spec)}`)
  }
  console.debug({selected: version})
  return { project: spec.project, version };
}

const getPlatforms = async (pkg: Package | PackageRequirement) => {
  let { platforms } = await hooks.usePantry().project(pkg).yaml()
  if (!platforms) return ["linux/x86-64", "linux/aarch64", "darwin/x86-64", "darwin/aarch64"]
  if (isString(platforms)) platforms = [platforms]
  if (!isArray(platforms)) throw new Error(`invalid platform node: ${platforms}`)
  const rv = []
  for (const platform of platforms) {
    if (platform.match(/^(linux|darwin)\/(aarch64|x86-64)$/)) rv.push(platform)
    else if (platform.match(/^(linux|darwin)$/)) rv.push(`${platform}/x86-64`, `${platform}/aarch64`)
    else throw new Error(`invalid platform: ${platform}`)
  }
  return rv
}

const getRawDistributableURL = (yml: PlainObject) => {
  if (isPlainObject(yml.distributable)) {
    return validate.str(yml.distributable.url)
  } else if (isString(yml.distributable)) {
    return yml.distributable
  } else if (yml.distributable === null || yml.distributable === undefined) {
    return
  } else {
    throw new Error(`invalid distributable node: ${yml.distributable}`)
  }
}

const getGitDistribution = ({ pkg, url: urlstr, ref }: { pkg: Package, url: string, ref: string }) => {
  if (!ref) {
    throw new Error("distributable.ref is required because we mirror source tarballs even when cloning from git")
  }

  const url = new URL(urlstr.replace(/^git\+http/, 'http'))

  const moustaches = useMoustaches()

  ref = moustaches.apply(ref, [
    ...moustaches.tokenize.version(pkg.version),
    ...moustaches.tokenize.host()
  ])

  return { url, ref, stripComponents: 0, type: 'git' }
}

const getDistributable = async (pkg: Package) => {
  const moustaches = useMoustaches()

  const yml = await hooks.usePantry().project(pkg).yaml()

  if (yml.distributable?.git) {
    console.warn("brewkit: using distributable.git instead of distributable.url is deprecated")
    return getGitDistribution({ pkg, ...yml.distributable})
  }
  if (yml.distributable?.url?.startsWith("git")) {
    return getGitDistribution({ pkg, ...yml.distributable})
  }

  let urlstr = getRawDistributableURL(yml)
  if (!urlstr) return
  let stripComponents: number | undefined
  if (isPlainObject(yml.distributable)) {
    stripComponents = flatmap(yml.distributable["strip-components"], coerceNumber)
  }

  urlstr = moustaches.apply(urlstr, [
    ...moustaches.tokenize.version(pkg.version),
    ...moustaches.tokenize.host()
  ])

  const url = new URL(urlstr)

  return { url, ref: undefined, stripComponents, type: 'url' }
}

// deno-lint-ignore no-explicit-any
function coerceNumber(input: any) {
  if (isNumber(input)) return input
}

/// returns sorted versions
async function getVersions(spec: { project: string }): Promise<SemVer[]> {
  const files = hooks.usePantry().project(spec)
  const versions = await files.yaml().then(x => x.versions)

  if (isArray(versions)) {
    return versions.map(raw => new SemVer(validate.str(raw)))
  } else if (isPlainObject(versions)) {
    return handleComplexVersions(versions)
  } else {
    throw new Error(`couldn’t parse versions for ${spec.project}`)
  }
}

//SRC https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

function handleComplexVersions(versions: PlainObject): Promise<SemVer[]> {
  if (versions.github) return handleGitHubVersions(versions)
  if (versions.gitlab) return handleGitLabVersions(versions)
  if (versions.url) return handleURLVersions(versions)

  const keys = Object.keys(versions)
  const first = keys.length > 0 ? keys[0] : "undefined"
  throw new Error(`couldn’t parse version scheme for ${first}`)
}

function handleGitHubVersions(versions: PlainObject): Promise<SemVer[]> {
  const [user, repo, ...types] = validate.str(versions.github).split("/")
  const type = types?.join("/").chuzzle() ?? 'releases/tags'

  const ignore = parseIgnore(versions.ignore)

  const strip = parseStrip(versions.strip)

  switch (type) {
  case 'releases':
  case 'releases/tags':
  case 'tags':
    break
  default:
    throw new Error()
  }

  const fetch = useGitHubAPI().getVersions({ user, repo, type })

  return handleAPIResponse({ fetch, ignore, strip })
}

function handleGitLabVersions(versions: PlainObject): Promise<SemVer[]> {
  const [server, project, type] = (() => {
    let input = validate.str(versions.gitlab)
    const rv = []

    if (input.includes(":")) {
      rv.push(input.split(":")[0])
      input = input.split(":")[1]
    } else {
      rv.push("gitlab.com")
    }

    if (input.match(/\/(releases|tags)$/)) {
      const i = input.split("/")
      rv.push(i.slice(0, -1).join("/"))
      rv.push(i.slice(-1)[0])
    } else {
      rv.push(input)
      rv.push("releases")
    }

    return rv
  })()

  const ignore = parseIgnore(versions.ignore)

  const strip = parseStrip(versions.strip)

  switch (type) {
  case 'releases':
  case 'tags':
    break
  default:
    throw new Error()
  }

  const fetch = useGitLabAPI().getVersions({ server, project, type })

  return handleAPIResponse({ fetch, ignore, strip })
}

function parseIgnore(ignore: string | string[] | undefined): RegExp[] {
  const arr = (() => {
    if (!ignore) return []
    if (isString(ignore)) return [ignore]
    return validate.arr(ignore)
  })()
  return arr.map(input => {
    let rx = validate.str(input)
    if (!(rx.startsWith("/") && rx.endsWith("/"))) {
      rx = escapeRegExp(rx)
      rx = rx.replace(/(x|y|z)\b/g, '\\d+')
      rx = `^${rx}$`
    } else {
      rx = rx.slice(1, -1)
    }
    return new RegExp(rx)
    })
}

function parseStrip(strip: string | string[] | undefined): (x: string) => string {
  let s = strip
  if (!s) return x => x
  if (!isArray(s)) s = [s]
  // deno-lint-ignore no-explicit-any
  const rxs = s.map((rx: any) => {
    if (!isString(rx)) throw new Error()
    if (!(rx.startsWith("/") && rx.endsWith("/"))) throw new Error()
    return new RegExp(rx.slice(1, -1))
  })
  return x => {
    for (const rx of rxs) {
      x = x.replace(rx, "")
    }
    return x
  }
}

interface APIResponseParams {
  // deno-lint-ignore no-explicit-any
  fetch: AsyncGenerator<string, any, unknown>
  ignore: RegExp[]
  strip: (x: string) => string
}

async function handleAPIResponse({ fetch, ignore, strip }: APIResponseParams): Promise<SemVer[]> {
  const rv: SemVer[] = []
  for await (const pre_strip_name of fetch) {
    let name = strip(pre_strip_name)

    if (ignore.some(x => x.test(name))) {
      console.debug({ignoring: pre_strip_name, reason: 'explicit'})
    } else {
      // An unfortunate number of tags/releases/other
      // replace the dots in the version with underscores.
      // This is parser-unfriendly, but we can make a
      // reasonable guess if this is happening.
      // But find me an example where this is wrong.
      if (name.includes("_") && !name.includes(".")) {
        name = name.replace(/_/g, ".")
      }

      // A fair number of tags or "versions" are just yyyy-mm-dd.
      // Since we're being permissive about underscores, we can
      // probably make the same kind of guess about dashes.
      if (name.includes("-") && !name.includes(".")) {
        name = name.replace(/-/g, ".")
      }

      const v = semver.parse(name)
      if (!v) {
        console.debug({ignoring: pre_strip_name, reason: 'unparsable'})
      } else if (v.prerelease.length <= 0) {
        console.debug({ found: v.toString(), from: pre_strip_name });
        // used by some packages
        (v as unknown as {tag: string}).tag = pre_strip_name
        rv.push(v)
      } else {
        console.debug({ignoring: pre_strip_name, reason: 'prerelease'})
      }
    }
  }

  if (rv.length == 0) {
    console.warn("no versions parsed. Re-run with DEBUG=1 to see output.")
  }

  return rv
}

async function handleURLVersions(versions: PlainObject): Promise<SemVer[]> {
  const rv: SemVer[] = []
  const url = validate.str(versions.url)
  const matcher = validate.str(versions.match)

  const body = await fetch(url).then(x => x.text())
  const matches = body.matchAll(new RegExp(matcher.slice(1, -1), 'g'))

  const strip = versions.strip
  for (const match of matches) {
    let m = ((x: string) => {
      if (!strip) return x
      if (isString(strip)) return x.replace(new RegExp(strip.slice(1, -1)), "")
      if (isArray(strip)) {
        for (const rx of strip) {
          x = x.replace(new RegExp(rx.slice(1, -1)), "")
        }
        return x
      }
      throw new Error()
    })(match[0])

    // We'll handle dates > calver automatically. For now.
    const calver = m.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (calver) {
      m = `${calver[1]}.${calver[2]}.${calver[3]}`
    }

    const v = semver.parse(m)
    // Lots of times the same string will appear as both the HREF and
    // the text of the link. We don't want to double count.
    if (v && !rv.find(vx => vx.raw === v.raw)) rv.push(v)
  }
  return rv
}

//FIXME inefficient, should be in libtea as part of .project()
async function filepath(project: string) {
  for await (const pkg of hooks.usePantry().ls()) {
    if (project == pkg.project) return pkg.path
  }
  throw new Error(`package.yml not found: ${project}`)
}
