import { hooks, PackageRequirement, utils, Path } from "pkgx"
import { find_in_PATH } from "brewkit/utils.ts"
import { Config } from "brewkit/config.ts"
import undent from "outdent"

const { usePantry, useConfig } = hooks
const { host } = utils

export default async function(config: Config, PATH?: Path): Promise<string> {
  const depset = new Set(config.deps.gas.map(x => x.pkg.project))
  const depstr = (deps: PackageRequirement[]) => deps.map(x => `"+${utils.pkg.str(x)}"`).join(' ')
  const env_plus = `${depstr(config.deps.dry.runtime)} ${depstr(config.deps.dry.build)}`.trim()
  const user_script = await usePantry().getScript(config.pkg, 'build', config.deps.gas, config)

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
      export PATH="${brewkit_PATHs}:$PATH"
      set -a
      ${env_plus ? `eval "$(CLICOLOR_FORCE=1 ${pkgx} ${env_plus})"` : ''}
      set +a

      export PKGX="${pkgx}"
      export HOME=${config.path.home.string}
      export SRCROOT=${config.path.build.string}
      ${tmp()}
      if [ -n "$CI" ]; then
        export FORCE_UNSAFE_CONFIGURE=1
      fi
      mkdir -p $HOME
      ${FLAGS.join('\n  ')}

      env -u GH_TOKEN -u GITHUB_TOKEN

    ${gum} format "## pantry script start"
      set -x
      cd ${config.path.build}

    ${user_script}
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