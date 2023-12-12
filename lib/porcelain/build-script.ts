import { hooks, PackageRequirement, utils, Path } from "pkgx"
import { find_in_PATH } from "brewkit/utils.ts"
import { Config } from "brewkit/config.ts"
import undent from "outdent"

const { usePantry, useConfig } = hooks
const { host } = utils

export default async function(config: Config, PATH?: Path): Promise<string> {
  const depstr = (deps: PackageRequirement[]) => deps.map(x => `+${utils.pkg.str(x)}`).join(' ')
  const env_plus = `${depstr(config.deps.dry.runtime)} ${depstr(config.deps.dry.build)}`.trim()
  const user_script = await usePantry().getScript(config.pkg, 'build', config.deps.gas, config.path.build_install)

  const pkgx = find_in_PATH('pkgx')
  const bash = find_in_PATH('bash')
  const gum = find_in_PATH('gum')

  const brewkitd = new Path(new URL(import.meta.url).pathname).parent().parent().parent()
  const brewkit_PATHs = [
    brewkitd.join("share/brewkit"),
    PATH
  ].compact(x => x?.string).join(':')

  const FLAGS = flags()
  if (host().platform == 'darwin') {
    FLAGS.push("export MACOSX_DEPLOYMENT_TARGET=11.0")
  }

  return undent`
    #!/${bash}

    set -eo pipefail

    ${gum} format "## env"
      export PATH="${brewkit_PATHs}:$PATH"
      set -a
      ${env_plus ? `eval "$(CLICOLOR_FORCE=1 ${pkgx} ${env_plus})"` : ''}
      set +a

      export PKGX="${pkgx}"
      export SRCROOT=${config.path.build.string}
      #TODO export XDG_CACHE_HOME="${config.path.cache.string}"
      export HOME=${config.path.home.string}
      if [ -n "$CI" ]; then
        export FORCE_UNSAFE_CONFIGURE=1
      fi
      mkdir -p $HOME
      ${flags().join('\n')}

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