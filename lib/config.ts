import useConfig from "libpkgx/hooks/useConfig.ts"
import { Path, Package, PackageRequirement, utils, hooks, plumbing, Installation } from "pkgx"
const { flatmap, host } = utils
const { usePantry } = hooks
const { hydrate } = plumbing
import resolve_pkg from "./resolve-pkg.ts"

export interface Config {
  pkg: Package
  pkgspec: PackageRequirement
  path: ConfigPath
  deps: {
    dry: {
      runtime: PackageRequirement[]
      build: PackageRequirement[]
      test: PackageRequirement[]
    },
    wet: PackageRequirement[],
    gas: Installation[]
  }
}

export interface ConfigPath {
  yaml: Path /// the package.yml
  pantry: Path /// the pantry we found this yaml in
  src: Path /// full path to extracted sources
  tarball_dir: Path /// full path to the directory to store tarballs
  build: Path /// {{brewroot}}/builds/foo-1.2.3
  install: Path /// ${PKGX_DIR:-$HOME/.pkgx}}/foo-1.2.3
  build_install: Path /// ${PKGX_DIR:-$HOME/.pkgx}}/foo-1.2.3+brewing
  home: Path /// we make a new HOME for robust builds and your own system’s sanity
  test: Path /// where we stage and run tests
  cache: Path // persistent cache between builds, use for big things like AI models
}

export default async function config(arg?: string): Promise<Config> {
  const { pkg, path, constraint } = await resolve_pkg(arg)

  //FIXME shouldn't be here, but fixing things properly is outside my time allotments nowadays
  if (!await hooks.usePantry().project(pkg.project).available()) {
    console.warn("warn: project not available on this platform")
    Deno.exit(2)
  }

  let pantry = path
  for (let x = 0, N = pkg.project.split('/').length + 1; x < N; x++) {
    pantry = pantry.parent()
  }

  if (Deno.env.get("PKGX_PANTRY_PATH")) {
    const checkout = new Path(Deno.env.get("PKGX_PANTRY_PATH")!)
    const slug = pkg.project.replace(/\//g, "__")  //FIXME use real folders probs
    const pkgspec = `${slug}-${pkg.version}`
    return await construct_config({
      home: checkout.join('homes', pkgspec),
      src: checkout.join('srcs', pkgspec),
      build: checkout.join('builds', pkgspec),
      test:  checkout.join('testbeds', pkgspec),
      tarball_dir: checkout.join('srcs'),
    })
  } else {
    const {platform, arch} = host()
    const datahome = platform_datahome().join("brewkit")
    const bkroot = datahome.join(`${platform}+${arch}`, pkg.project, `v${pkg.version}`)
    return await construct_config({
      home: bkroot,
      src: bkroot.join('src'),
      build: bkroot.join('build'),
      test: bkroot.join('testbed'),
      tarball_dir: datahome
    })
  }

  async function construct_config({home, src, build, test, tarball_dir}: {home: Path, src: Path, build: Path, test: Path, tarball_dir: Path, suffix?: string}): Promise<Config> {
    const dry = await usePantry().getDeps(pkg)

    const { pkgs: wet } = await hydrate(dry.runtime.concat(dry.build))
    let installs = []

    try {
      const gas = await plumbing.resolve(wet)
      // predetermining these just for the build script generation step
      installs = gas.pkgs.map(pkg => ({
        pkg,
        path: useConfig().prefix.join(pkg.project, `v${pkg.version}`)
      }))
    } catch {
      console.warn("Failed to resolve dependencies, will spit out non-dependency config")
    }

    const cache = platform_cache()
    const install =  useConfig().prefix.join(pkg.project, `v${pkg.version}`)
    const build_install = new Path(`${install.string}+brewing`)

    return {
      pkg,
      pkgspec: {project: pkg.project, constraint},
      deps: {
        dry,
        wet,
        gas: installs
      },
      path: {
        cache,
        pantry,
        yaml: path,
        src,
        build,
        install,
        home,
        test,
        build_install,
        tarball_dir
      }
    }
  }
}

export function platform_cache(home = Path.home) {
  return flatmap(Deno.env.get('XDG_CACHE_HOME'), Path.abs) ?? (platform =>
    platform == 'darwin' ? home().join('Library/Caches') : home().join(".cache")
  )(host().platform)
}

function platform_datahome() {
  return flatmap(Deno.env.get('XDG_DATA_HOME'), Path.abs) ?? (platform =>
    platform == 'darwin' ? Path.home().join('Library/Application Support') : Path.home().join(".local/share")
  )(host().platform)
}