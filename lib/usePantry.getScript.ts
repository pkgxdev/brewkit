import { SupportedPlatforms } from "https://raw.githubusercontent.com/teaxyz/lib/v0.4.2/src/utils/host.ts"
import { isArray, isString, isPlainObject, PlainObject } from "is-what"
import { Package, Installation, hooks, utils, semver } from "libtea"
import undent from "outdent"

const { validate, host } = utils
const { useMoustaches } = hooks

export const getScript = async (pkg: Package, key: 'build' | 'test', deps: Installation[]) => {
  const yml = await hooks.usePantry().project(pkg).yaml()
  const node = yml[key]

  const mm = useMoustaches()
  const script = (input: unknown) => {
    const tokens = mm.tokenize.all(pkg, deps)
    if (isArray(input)) input = input.map(obj => {
      if (isPlainObject(obj)) {

        const condition = obj["if"]
        if (condition) {
          if (SupportedPlatforms.includes(condition) && host().platform != condition) return ''

          const range = semver.Range.parse(condition)
          if (range && !range.satisfies(pkg.version)) return ''
        }

        let run = obj['run']
        if (!isString(run)) throw new Error('every node in a script YAML array must contain a `run` key')

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

        let fixture_key = key == 'build' ? 'prop' : 'fixture'
        let fixture = obj[fixture_key]
        if (fixture) {
          fixture_key = fixture_key.toUpperCase()
          fixture = mm.apply(validate.str(fixture), tokens)
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
    return mm.apply(validate.str(input), tokens)
  }

  if (isPlainObject(node)) {
    let raw = script(node.script)

    let wd = node["working-directory"]
    if (wd) {
      wd = mm.apply(wd, [
        ...mm.tokenize.version(pkg.version),
        ...mm.tokenize.host(),
        ...mm.tokenize.pkg(pkg)
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

function expand_env(env: PlainObject, pkg: Package, deps: Installation[]): string {
  const { expand_env_obj } = hooks.usePantry()
  return Object.entries(expand_env_obj(env, pkg, deps)).map(([key,value]) => {
    // weird POSIX string escaping/concat stuff
    // eg. export FOO="bar ""$baz"" bun"
    value = `"${value.trim().replace(/"/g, '""')}"`
    while (value.startsWith('""')) value = value.slice(1)  //FIXME lol better pls
    while (value.endsWith('""')) value = value.slice(0,-1) //FIXME lol better pls

    return `export ${key}=${value}`
  }).join("\n")
}
