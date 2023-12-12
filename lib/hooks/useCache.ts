import { SupportedArchitecture, SupportedPlatform } from "libpkgx/utils/host.ts"
import { hooks, SemVer, Stowed, Path } from "libpkgx"
const { useCache } = hooks

export default function() {
  const foo = useCache()
  return { ...foo, decode }
}

const bottleRegex = `^(.*)-(\\d+(\\.\\d+)*[a-z]?)\\+(.+?)\\+(.+?)\\.tar\\.[gx]z$`
const srcRegex = `^(.*)-(\\d+(\\.\\d+)*[a-z]?)\\.tar\\.[gx]z$`

function decode(path: Path): Stowed | undefined {
  const bottleMatch = path.basename().match(bottleRegex)
  if (bottleMatch) {
    const [_1, p, v, _2, platform, arch] = bottleMatch
    // Gotta undo the package name manipulation to get the package from the bottle
    const project = p.replaceAll("∕", "/")
    const version = new SemVer(v)
    if (!version) return
    const pkg = { project, version }
    const compression = path.extname() == '.tar.gz' ? 'gz' : 'xz'
    return {
      pkg,
      type: 'bottle',
      host: {
        platform: platform as SupportedPlatform,
        arch: arch as SupportedArchitecture
      },
      compression,
      path
    }
  }

  const srcMatch = path.basename().match(srcRegex)
  if (srcMatch) {
    const [_, p, v] = srcMatch
    // Gotta undo the package name manipulation to get the package from the bottle
    const project = p.replaceAll("∕", "/")
    const version = new SemVer(v)
    if (!version) return
    const pkg = { project, version }
    return {
      pkg, type: 'src', path,
      extname: path.extname(),
    }
  }
}
