// deno-lint-ignore-file no-cond-assign
import { Package, PackageRequirement, Installation } from "types"
import { host, flatmap, undent, validate_plain_obj, validate_str, validate_arr, pkg, TeaError } from "utils"
import { isNumber, isPlainObject, isString, isArray, isPrimitive, PlainObject, isBoolean } from "is_what"
import { validatePackageRequirement } from "utils/hacks.ts"
import { useCellar, usePrefix, usePantry as usePantryBase } from "hooks"
import { pantry_paths, ls } from "hooks/usePantry.ts"
import useGitHubAPI from "./useGitHubAPI.ts"
import useGitLabAPI from "./useGitLabAPI.ts"
import SemVer, * as semver from "semver"
import Path from "path"

interface Entry {
  dir: Path
  yml: () => Promise<PlainObject>
  versions: Path
}

export interface Interpreter {
  project: string // FIXME: should probably be a stronger type
  args: string[]
}

export default function usePantry() {
  const foo = usePantryBase()
  return {
    getClosestPackageSuggestion,
    getVersions,
    getDistributable,
    getScript,
    getYAML,
    getPlatforms,
    resolve,
    ...foo,
    getDeps
  }
}

/// returns ONE LEVEL of deps, to recurse use `hydrate.ts`
const getDeps = async (pkg: Package | PackageRequirement) => {
  const yml = await entry(pkg).yml()
  const runtime = parse_pkgs_node(yml.dependencies)
  const build = parse_pkgs_node(yml.build?.dependencies)
  const test = parse_pkgs_node(yml.test?.dependencies)
  return { runtime, build, test }
}

// deno-lint-ignore no-explicit-any
function parse_pkgs_node(node: any) {
  if (!node) return []
  node = validate_plain_obj(node)
  platform_reduce(node)

  const rv: PackageRequirement[] = []
  for (const [project, constraint] of Object.entries(node)) {
    rv.compact_push(validatePackageRequirement({ project, constraint }))
  }
  return rv
}

async function resolve(spec: Package | PackageRequirement): Promise<Package> {
  const constraint = "constraint" in spec ? spec.constraint : new semver.Range(`=${spec.version}`)
  const versions = await getVersions(spec)
  const version = constraint.max(versions)
  if (!version) throw new Error(`not-found: version: ${pkg.str(spec)}`)
  console.debug({selected: version})
  return { project: spec.project, version };
}

//TODO take `T` and then type check it
const getYAML = (pkg: Package | PackageRequirement) => {
  const foo = entry(pkg)
  return {
    path: foo.dir.join("package.yml").isFile() ?? foo.dir.join("package.yaml"),
    parse: foo.yml
  }
}

const getPlatforms = async (pkg: Package | PackageRequirement) => {
  let { platforms } = await entry(pkg).yml()
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
    return validate_str(yml.distributable.url)
  } else if (isString(yml.distributable)) {
    return yml.distributable
  } else if (yml.distributable === null || yml.distributable === undefined) {
    return
  } else {
    throw new Error(`invalid distributable node: ${yml.distributable}`)
  }
}

const getGitDistribution = ({ pkg, git, ref }: { pkg: Package, git: string, ref: string }) => {
  if (!git.startsWith("git+")) throw new Error(`invalid git url; explicitly use git+https:// or git+ssh://: ${git}`)

  const url = new URL(git.replace(/^git\+http/, 'http'))

  const moustaches = useMoustaches()

  const ref_ = moustaches.apply(ref, [
    ...moustaches.tokenize.version(pkg.version),
    ...moustaches.tokenize.host()
  ])

  return { url, ref: ref_, stripComponents: 0, type: 'git' }
}

const getDistributable = async (pkg: Package) => {
  const moustaches = useMoustaches()

  const yml = await entry(pkg).yml()

  if (yml.distributable?.git) { return getGitDistribution({ pkg, ...yml.distributable}) }

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

const getScript = async (pkg: Package, key: 'build' | 'test', deps: Installation[]) => {
  const yml = await entry(pkg).yml()
  const node = yml[key]

  const mm = useMoustaches()
  const script = (input: unknown) => {
    const tokens = mm.tokenize.all(pkg, deps)
    if (isArray(input)) input = input.map(obj => {
      if (isPlainObject(obj)) {
        let run = obj['run']
        if (!isString(run)) throw new Error('every node in a script YAML array must contain a `run` key')
        let cd = obj['working-directory']
        if (cd) {
          cd = mm.apply(validate_str(cd), tokens)
          run = undent`
            OLDWD="$PWD"
            mkdir -p "${cd}"
            cd "${cd}"
            ${run.trim()}
            cd "$OLDWD"
            unset OLDWD
            `
        }
        let fixture_key = key == 'build' ? 'prop' : 'fixture'
        let fixture = obj[fixture_key]
        if (fixture) {
          fixture_key = fixture_key.toUpperCase()
          fixture = mm.apply(validate_str(fixture), tokens)
          run = undent`
            OLD_${fixture_key}=$${fixture_key}
            ${fixture_key}=$(mktemp)

            cat <<XYZ_TEA_EOF > $${fixture_key}
            ${fixture}
            XYZ_TEA_EOF

            ${run}

            rm -f $${fixture_key}

            if test -n "$${fixture_key}"; then
              ${fixture_key}=$OLD_${fixture_key}
            else
              unset ${fixture_key}
            fi
            `
        }

        return run.trim()
      } else {
        return `${obj}`.trim()
      }
    }).join("\n\n")
    return mm.apply(validate_str(input), tokens)
  }

  if (isPlainObject(node)) {
    let raw = script(node.script)

    let wd = node["working-directory"]
    if (wd) {
      wd = mm.apply(wd, [
        ...mm.tokenize.version(pkg.version),
        ...mm.tokenize.host(),
        ...tokenizePackage(pkg)
      ])
      raw = undent`
        mkdir -p ${wd}
        cd ${wd}

        ${raw}
        `
    }

    const env = node.env
    if (isPlainObject(env)) {
      raw = `${expand_env(env, pkg, deps)}\n\n${raw}`
    }
    return raw
  } else {
    return script(node)
  }
}

const getProvides = async (pkg: { project: string }) => {
  const yml = await entry(pkg).yml()
  const node = yml["provides"]
  if (!node) return []
  if (!isArray(node)) throw new Error("bad-yaml")

  return node.compact(x => {
    if (isPlainObject(x)) {
      x = x["executable"]
    }
    if (isString(x)) {
      if (x.startsWith("bin/")) return x.slice(4)
      if (x.startsWith("sbin/")) return x.slice(5)
    }
  })
}

// deno-lint-ignore no-explicit-any
function coerceNumber(input: any) {
  if (isNumber(input)) return input
}

function entry({ project }: { project: string }): Entry {
  for (const prefix of pantry_paths()) {
    if (!prefix.exists()) throw new TeaError('not-found: pantry', { path: prefix.parent() })
    const dir = prefix.join(project)
    const filename = dir.join("package.yml")
    if (!filename.exists()) continue
    const yml = async () => {
      try {
        const yml = await filename.readYAML()
        if (!isPlainObject(yml)) throw null
        return yml
      } catch (cause) {
        throw new TeaError('parser: pantry: package.yml', {cause, project, filename})
      }
    }
    const versions = dir.join("versions.txt")
    return { dir, yml, versions }
  }

  throw new TeaError('not-found: pantry: package.yml', {project}, )
}

async function getClosestPackageSuggestion(input: string) {
  let choice: string | undefined
  let min = Infinity
  for await (const {project} of ls()) {
    if (min == 0) break

    getProvides({ project }).then(provides => {
      if (provides.includes(input)) {
        choice = project
        min = 0
      }
    })

    const dist = levenshteinDistance(project, input)
    if (dist < min) {
      min = dist
      choice = project
    }
  }
  return choice
}

function levenshteinDistance (str1: string, str2:string):number{
  const track = Array(str2.length + 1).fill(null).map(() =>
    Array(str1.length + 1).fill(null))
  for (let i = 0; i <= str1.length; i += 1) {
     track[0][i] = i
  }
  for (let j = 0; j <= str2.length; j += 1) {
     track[j][0] = j
  }
  for (let j = 1; j <= str2.length; j += 1) {
     for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1
        track[j][i] = Math.min(
           track[j][i - 1] + 1, // deletion
           track[j - 1][i] + 1, // insertion
           track[j - 1][i - 1] + indicator, // substitution
        );
     }
  }
  return track[str2.length][str1.length]
}

/// returns sorted versions
async function getVersions(spec: { project: string }): Promise<SemVer[]> {
  const files = entry(spec)
  const versions = await files.yml().then(x => x.versions)

  if (isArray(versions)) {
    return versions.map(raw => new SemVer(validate_str(raw)))
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
  const [user, repo, ...types] = validate_str(versions.github).split("/")
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
    let input = validate_str(versions.gitlab)
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
    return validate_arr(ignore)
  })()
  return arr.map(input => {
    let rx = validate_str(input)
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
  const url = validate_str(versions.url)
  const matcher = validate_str(versions.match)

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

/// expands platform specific keys into the object
/// expands inplace because JS is nuts and you have to suck it up
function platform_reduce(env: PlainObject) {
  const sys = host()
  for (const [key, value] of Object.entries(env)) {
    const [os, arch] = (() => {
      let match = key.match(/^(darwin|linux)\/(aarch64|x86-64)$/)
      if (match) return [match[1], match[2]]
      if (match = key.match(/^(darwin|linux)$/)) return [match[1]]
      if (match = key.match(/^(aarch64|x86-64)$/)) return [,match[1]]
      return []
    })()

    if (!os && !arch) continue
    delete env[key]
    if (os && os != sys.platform) continue
    if (arch && arch != sys.arch) continue

    const dict = validate_plain_obj(value)
    for (const [key, value] of Object.entries(dict)) {
      // if user specifies an array then we assume we are supplementing
      // otherwise we are replacing. If this is too magical let us know
      if (isArray(value)) {
        if (!env[key]) env[key] = []
        else if (!isArray(env[key])) env[key] = [env[key]]
        //TODO if all-platforms version comes after the specific then order accordingly
        env[key].push(...value)
      } else {
        env[key] = value
      }
    }
  }
}

function expand_env_obj(env_: PlainObject, pkg: Package, deps: Installation[]): Record<string, string> {
  const env = {...env_}

  platform_reduce(env)

  const rv: Record<string, string> = {}

  for (let [key, value] of Object.entries(env)) {
    if (isArray(value)) {
      value = value.map(transform).join(" ")
    } else {
      value = transform(value)
    }

    rv[key] = value
  }

  return rv

  // deno-lint-ignore no-explicit-any
  function transform(value: any): string {
    if (!isPrimitive(value)) throw new Error(`invalid-env-value: ${JSON.stringify(value)}`)

    if (isBoolean(value)) {
      return value ? "1" : "0"
    } else if (value === undefined || value === null) {
      return "0"
    } else if (isString(value)) {
      const mm = useMoustaches()
      return mm.apply(value, mm.tokenize.all(pkg, deps))
    } else if (isNumber(value)) {
      return value.toString()
    }
    throw new Error("unexpected-error")
  }
}

function expand_env(env: PlainObject, pkg: Package, deps: Installation[]): string {
  return Object.entries(expand_env_obj(env, pkg, deps)).map(([key,value]) => {
    // weird POSIX string escaping/concat stuff
    // eg. export FOO="bar ""$baz"" bun"
    value = `"${value.trim().replace(/"/g, '""')}"`
    while (value.startsWith('""')) value = value.slice(1)  //FIXME lol better pls
    while (value.endsWith('""')) value = value.slice(0,-1) //FIXME lol better pls

    return `export ${key}=${value}`
  }).join("\n")
}


//////////////////////////////////////////// useMoustaches() additions
import useMoustachesBase from "hooks/useMoustaches.ts"

function useMoustaches() {
  const base = useMoustachesBase()

  const deps = (deps: Installation[]) => {
    const map: {from: string, to: string}[] = []
    for (const dep of deps ?? []) {
      map.push({ from: `deps.${dep.pkg.project}.prefix`, to: dep.path.string })
      map.push(...useMoustaches().tokenize.version(dep.pkg.version, `deps.${dep.pkg.project}.version`))
    }
    return map
  }

  const tea = () => [{ from: "tea.prefix", to: usePrefix().string }]

  const all = (pkg: Package, deps_: Installation[]) => [
    ...deps(deps_),
    ...tokenizePackage(pkg),
    ...tea(),
    ...base.tokenize.version(pkg.version),
    ...base.tokenize.host(),
  ]

  return {
    apply: base.apply,
    tokenize: {
      ...base.tokenize,
      deps, pkg, tea, all
    }
  }
}

function tokenizePackage(pkg: Package) {
  return [{ from: "prefix", to: useCellar().keg(pkg).string }]
}