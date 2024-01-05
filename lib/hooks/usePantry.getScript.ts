import usePkgxConfig from "libpkgx/hooks/useConfig.ts"
import { Config as BrewkitConfig } from "brewkit/config.ts"
import { SupportedPlatforms, SupportedArchitectures } from "libpkgx/utils/host.ts"
import { isArray, isString, isPlainObject, PlainObject, isPrimitive, isBoolean, isNumber } from "is-what"
import { Package, Installation, hooks, utils, semver, Path, PantryParseError } from "libpkgx"
import undent from "outdent"
import { panic } from "libpkgx/utils/error.ts";

const { validate, host } = utils
const { useMoustaches } = hooks

export const getScript = async (pkg: Package, key: 'build' | 'test', deps: Installation[], config: BrewkitConfig) => {
  const install_path = key == 'build' ? config.path.build_install : config.path.install
  const yml = await hooks.usePantry().project(pkg).yaml()
  const node = yml[key]

  const mm = useMoustaches()
  const tokens = mm.tokenize.all(pkg, deps)
  tokens.push(...tokenizeHost())
  tokens.push({
    from: "pkgx.dir", to: usePkgxConfig().prefix.string
  })
  if (key == 'build') {
    tokens.push({
      from: "srcroot", to: config.path.build.string
    }, {
      from: "props", to: config.path.build.join("props").string
    })
  }

  for (const [index, token] of tokens.entries()) {
    if (token.from == "prefix") {
      tokens[index] = { from: "prefix", to: install_path.string }
    }
  }

  const script = (input: unknown) => {
    if (isString(input)) {
      return mm.apply(input, tokens)
    } else if (!isArray(input)) {
      throw new Error("script node is not string or array")
    }

    return input.map(obj => {
      if (isPlainObject(obj)) {

        const condition = obj["if"]
        if (condition) {
          if (SupportedPlatforms.includes(condition) && host().platform != condition) return ''
          if (SupportedArchitectures.includes(condition) && host().arch != condition) return ''
          if (condition.includes("/")) {
            const [platform, arch] = condition.split("/")
            if (SupportedPlatforms.includes(platform) &&
                SupportedArchitectures.includes(arch) &&
                (host().platform != platform ||
                host().arch != arch)) return ''
          }

          const range = semver.Range.parse(condition)
          if (range && !range.satisfies(pkg.version)) return ''
        }

        let run = obj['run']
        if (isArray(run)) {
          run = run.map(x => mm.apply(x, tokens)).join("\n")
        } else if (!isString(run)) {
          throw new Error('every node in a script YAML array must contain a `run` key')
        } else {
          run = mm.apply(run, tokens)
        }

        let cd = obj['working-directory']
        if (cd) {
          cd = mm.apply(validate.str(cd), tokens)
          run = undent`
            OLDWD="$PWD"
            mkdir -p "${cd}"
            cd "${cd}"
            ${run.trim()}
            cd "$OLDWD"
            unset OLDWD
            `
        }

        run = add_fixture(run, key, obj, tokens)

        return run.trim()
      } else {
        return mm.apply(`${obj}`, tokens).trim()
      }
    }).join("\n\n")
  }

  if (isPlainObject(node)) {
    let raw = script(node.script)

    const pkg_tokens = (tokens => {
      const rv = []
      for (const token of tokens) {
        if (token.from == "prefix") {
          rv.push({from: "prefix", to: install_path.string})
        } else {
          rv.push(token)
        }
      }
      return rv
    })(mm.tokenize.pkg(pkg))

    let wd = node["working-directory"]
    if (wd) {
      wd = mm.apply(wd, [
        ...mm.tokenize.version(pkg.version),
        ...tokenizeHost(),
        ...pkg_tokens
      ])
      raw = undent`
        mkdir -p ${wd}
        cd ${wd}

        ${raw}
        `
    }

    const env = node.env
    if (isPlainObject(env)) {
      raw = `${expand_env(env, pkg, tokens)}\n\n${raw}`
    }
    return raw
  } else {
    return script(node)
  }
}

function expand_env(env: PlainObject, pkg: Package, tokens: { from: string, to: string }[]): string {
  return Object.entries(expand_env_obj(env, pkg, tokens)).map(([key,value]) => {
    // weird POSIX string escaping/concat stuff
    // eg. export FOO="bar ""$baz"" bun"
    value = `"${value.trim().replace(/"/g, '""')}"`
    while (value.startsWith('""')) value = value.slice(1)  //FIXME lol better pls
    while (value.endsWith('""')) value = value.slice(0,-1) //FIXME lol better pls

    return `export ${key}=${value}`
  }).join("\n")
}

function add_fixture(run: string, key: string, obj: any, tokens: { from: string, to: string }[]) {
  let fixture_key = key == 'build' ? 'prop' : 'fixture'
  let fixture = obj[fixture_key]
  if (!fixture) return run

  let extname = `${fixture['extname'] || ''}`
  while (extname.startsWith('.')) extname = extname.slice(1)

  const contents = isPlainObject(fixture) ? (fixture['content'] ?? fixture['contents'] ?? panic()) : fixture

  fixture_key = fixture_key.toUpperCase()

  const chmod_if_shebang = contents.startsWith("#!") ? `chmod +x $${fixture_key}\n` : ""

  fixture = useMoustaches().apply(validate.str(contents), tokens).replaceAll('$', '\\$')
  return undent`
    OLD_${fixture_key}=$${fixture_key}
    ${fixture_key}=$(mktemp)${extname ? `.${extname}` : ''}

    cat <<DEV_PKGX_EOF > $${fixture_key}
    ${fixture}
    DEV_PKGX_EOF
    ${chmod_if_shebang}
    ${run}

    rm -f $${fixture_key}*

    if test -n "$OLD_${fixture_key}"; then
      ${fixture_key}=$OLD_${fixture_key}
    else
      unset ${fixture_key}
    fi
    `
}

//FIXME these are copy pasta from usePantry because we build to a different prefix so need control over the moustaches
export function expand_env_obj(env_: PlainObject, pkg: Package, tokens: { from: string, to: string }[]): Record<string, string> {
  const env = {...env_}

  platform_reduce(env)

  const rv: Record<string, string> = {}

  for (let [key, value] of Object.entries(env)) {
    if (isArray(value)) {
      value = value.map(x => transform(x)).join(" ")
    } else {
      value = transform(value)
    }

    if (Deno.build.os == 'windows') {
      // we standardize on UNIX directory separators
      // NOTE hopefully this won’t break anything :/
      value = value.replaceAll('/', '\\')
    }

    rv[key] = value
  }

  return rv

  // deno-lint-ignore no-explicit-any
  function transform(value: any): string {
    if (!isPrimitive(value)) throw new PantryParseError(pkg.project, undefined, JSON.stringify(value))

    if (isBoolean(value)) {
      return value ? "1" : "0"
    } else if (value === undefined || value === null) {
      return "0"
    } else if (isString(value)) {
      const mm = useMoustaches()
      const home = Path.home().string
      const obj = [
        { from: 'home', to: home },      // remove, stick with just ~
        ...tokens
      ]
      return mm.apply(value, obj)
    } else if (isNumber(value)) {
      return value.toString()
    }

    const e = new Error("unexpected error")
    e.cause = value
    throw e
  }
}

function platform_reduce(env: PlainObject) {
  const sys = host()
  for (const [key, value] of Object.entries(env)) {
    const [os, arch] = (() => {
      let match = key.match(/^(darwin|linux)\/(aarch64|x86-64)$/)
      if (match) return [match[1], match[2]]
      if ((match = key.match(/^(darwin|linux)$/))) return [match[1]]
      if ((match = key.match(/^(aarch64|x86-64)$/))) return [,match[1]]
      return []
    })()

    if (!os && !arch) continue
    delete env[key]
    if (os && os != sys.platform) continue
    if (arch && arch != sys.arch) continue

    const dict = validate.obj(value)
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

//TODO replace `hw` with `host`
export function tokenizeHost() {
  const { arch, target, platform } = host()
  return [
    { from: "hw.arch",        to: arch },
    { from: "hw.target",      to: target },
    { from: "hw.platform",    to: platform },
    { from: "hw.concurrency", to: navigator.hardwareConcurrency.toString() },
  ]
}
