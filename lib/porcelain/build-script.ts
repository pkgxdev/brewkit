import { hooks, PackageRequirement, utils, Path } from "pkgx"
import { find_in_PATH } from "brewkit/utils.ts"
import { Config } from "brewkit/config.ts"
import undent from "outdent"

const { usePantry, useConfig } = hooks
const { host } = utils

export default async function(config: Config, PATH?: Path): Promise<string> {
  const depset = new Set(config.deps.gas.map(x => x.pkg.project))
  const depstr = (deps: PackageRequirement[]) => deps.map(x => `"+${utils.pkg.str(x)}"`).join(' ')
  let env_plus = `${depstr(config.deps.dry.runtime)} ${depstr(config.deps.dry.build)}`.trim()

  // if no compiler is an explicit dep, add llvm as default (was previously done per-invocation in the shim)
  if (host().platform != 'darwin' && !depset.has('llvm.org') && !depset.has('gnu.org/gcc')) {
    env_plus = `${env_plus} "+llvm.org"`.trim()
  }
  const user_script = await usePantry().getScript(config.pkg, 'build', config.deps.gas, config)

  // Linux sysroot routing — opt-in via `linux-sysroot:` in package.yml.
  // When set, redirects the compiler at a specific glibc / kernel-headers
  // bottle (instead of the build host's libc). Lines emitted into the
  // generated script export CC / CXX / CPP / SYSROOT before the user
  // script runs, so recipes don't need to know the paths themselves.
  // Empty string when the yaml has no `linux-sysroot:` key OR on non-
  // linux hosts — no behaviour change for existing recipes.
  const sysroot_env = await linux_sysroot_block(config)

  const pkgx = find_in_PATH('pkgx')
  const bash = find_in_PATH('bash')
  const gum = find_in_PATH('gum')

  const brewkitd = new Path(new URL(import.meta.url).pathname).parent().parent().parent()
  const brewkit_PATHs = [
    brewkitd.join("libexec"),
    PATH
  ].compact(x => x?.string).join(':')

  const FLAGS = flags()
  if (host().platform == 'darwin') {
    FLAGS.push("export MACOSX_DEPLOYMENT_TARGET=11.0")

    // gcc needs to use Apple’s ar/ranlib combo on darwin almost always or link failure occurs
    // see https://github.com/pkgxdev/brewkit/pull/285
    if (depset.has('gnu.org/binutils')) {
      FLAGS.push("export AR=/usr/bin/ar")
      FLAGS.push("export RANLIB=/usr/bin/ranlib")
    }
  }

  const tmp = (() => {
    switch (host().platform) {
    case 'darwin':
    case 'linux':
      return `export TMPDIR="$HOME/tmp"; mkdir -p "$TMPDIR"`
    case 'windows':
      return `export TMP="$HOME/tmp"; export TEMP="$HOME/tmp"; mkdir -p "$TMP"`
    }
  })

  return undent`
    #!/${bash}

    set -eo pipefail

    ${gum} format "## env"
      export PKGX_HOME="$HOME"
      set -a
      ${env_plus ? `eval "$(CLICOLOR_FORCE=1 ${pkgx} ${env_plus})"` : ''}
      set +a
      export PATH="${brewkit_PATHs}:$PATH"
      ${PATH ? `export CMAKE_PREFIX_PATH="${PATH.parent()}\${CMAKE_PREFIX_PATH:+:\$CMAKE_PREFIX_PATH}"` : ''}

      export PKGX="${pkgx}"
      export HOME=${config.path.home.string}
      export SRCROOT=${config.path.build.string}
      ${tmp()}
      if [ -n "$CI" ]; then
        export FORCE_UNSAFE_CONFIGURE=1
      fi
      mkdir -p $HOME
      ${FLAGS.join('\n  ')}
      ${sysroot_env}

      env -u GH_TOKEN -u GITHUB_TOKEN

    ${gum} format "## pantry script start"
      set -x
      cd ${config.path.build}

    ${user_script}
    `
}

/// Emit `export CC=… CXX=… CPP=… SYSROOT=…` if the package.yml has a
/// `linux-sysroot:` key. Resolves the libc bottle from the package's
/// installed deps so the recipe doesn't need to know the absolute path.
///
/// YAML schema (top-level key, scalar form):
///
///   linux-sysroot: gnu.org/glibc=~2.28
///   build:
///     dependencies:
///       gnu.org/glibc: ~2.28               # MUST also be a build dep
///       kernel.org/linux-headers: ^7       # auto-picked-up if present
///
/// `linux-sysroot:` points at the libc you want the compiler routed to.
/// kernel-headers are auto-detected from `build.dependencies` (if
/// `kernel.org/linux-headers` is among them, its include dir is
/// prepended to -isystem; if not, only the libc's headers are wired).
///
/// The libc package MUST already be a `build.dependencies` entry (so
/// it's installed and resolved); this directive routes existing deps,
/// it doesn't add them.
///
/// No-op on non-linux hosts and on recipes without a `linux-sysroot:`
/// key — no behaviour change for existing recipes.
///
/// Naming rationale (@jhheider review feedback on pkgxdev/brewkit#343):
/// top-level + `linux-`-prefixed makes the platform context explicit at
/// read-time. Alternate name `build.sysroot.libc:` (nested) was
/// rejected because it didn't surface the linux-only scope.
async function linux_sysroot_block(config: Config): Promise<string> {
  if (host().platform !== 'linux') return ''

  const yml = await usePantry().project(config.pkg).yaml() as Record<string, unknown>
  const want_libc = yml['linux-sysroot'] as string | undefined
  if (!want_libc) return ''

  const libc_project = want_libc.split(/[=<>~^]/)[0]
  const libc_install = config.deps.gas.find(i => i.pkg.project === libc_project)
  if (!libc_install) {
    throw new Error(`linux-sysroot='${want_libc}' but ${libc_project} is not in the resolved deps — declare it as a build.dependencies entry`)
  }

  // Auto-detect kernel-headers from build.dependencies if present.
  // (No separate directive needed — if you declared the kernel-headers
  // bottle as a build dep, you want it on the sysroot's -isystem path.)
  const khdr_install = config.deps.gas.find(i => i.pkg.project === 'kernel.org/linux-headers')
  const khdr_path = khdr_install?.path.string

  const ldso = (() => {
    switch (host().arch) {
      case 'x86-64':  return 'ld-linux-x86-64.so.2'
      case 'aarch64': return 'ld-linux-aarch64.so.1'
      default: throw new Error(`linux-sysroot unsupported on ${host().arch}`)
    }
  })()

  const libc = libc_install.path.string
  const isystems = [
    `-isystem ${libc}/include`,
    khdr_path ? `-isystem ${khdr_path}/include` : null,
  ].filter(Boolean).join(' ')
  const wrap = `-nostdinc ${isystems} -B ${libc}/lib -Wl,--enable-new-dtags,--dynamic-linker=${libc}/lib/${ldso},--rpath=${libc}/lib`

  return undent`
      # sysroot routing (linux-sysroot in package.yml)
      export SYSROOT=${libc}
      export CC="\${CC:-gcc} ${wrap}"
      export CXX="\${CXX:-g++} ${wrap} -nostdinc++"
      export CPP="\${CPP:-gcc} ${wrap} -E"
  `
}

function flags(): string[] {
  const {platform, arch} = host()
  const is_linux_x86_64 = platform == 'linux' && arch == 'x86-64'

  const LDFLAGS = (() => {
    switch (platform) {
    case 'darwin':
      return `-Wl,-rpath,${useConfig().prefix.string}`
    case 'linux':
      if (arch != 'x86-64') return
      return '-pie'
    }
  })()

  const rv: [string, string][] = []
  if (LDFLAGS) {
    rv.push(['LDFLAGS', LDFLAGS])
  }
  if (is_linux_x86_64) {
    rv.push(['CFLAGS', '-fPIC'], ['CXXFLAGS', '-fPIC'])
  }

  return rv.map(([key, value]) => `export ${key}="${value} $${key}"`)
}