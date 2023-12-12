import { isNumber, isPlainObject, isString, isArray, PlainObject } from "is-what"
import { Package, PackageRequirement, semver, utils, hooks } from "libpkgx"
import { getScript } from "./usePantry.getScript.ts"
import getVersions from "./usePantry.getVersions.ts"

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

//FIXME inefficient, should be in libpkgx as part of .project()
async function filepath(project: string) {
  for await (const pkg of hooks.usePantry().ls()) {
    if (project == pkg.project) return pkg.path
  }
  throw new Error(`package.yml not found: ${project}`)
}
