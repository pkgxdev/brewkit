import { Stowed, SupportedArchitecture, SupportedPlatform } from "types"
import SemVer from "semver"
import Path from "path"

export default function() {
  return { decode }
}

const bottleRegex = `^(.*)-(\\d+[:alpha:]*?(.\\d+[:alpha:]*?)*)\\+(.+?)\\+(.+?)\\.tar\\.[gx]z$`
const srcRegex = `^(.*)-(\\d+[:alpha:]*?(.\\d+[:alpha:]*?)*)\\.tar\\.[gx]z$`

function decode(path: Path): Stowed | undefined {
  const bottleMatch = path.basename().match(bottleRegex)
  if (bottleMatch) {
    const [_1, p, v, _2, platform, arch] = bottleMatch
    // Gotta undo the package name manipulation to get the package from the bottle
    const project = p.replaceAll("∕", "/")
    const version = new SemVer(v, { tolerant: true })
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
    const version = new SemVer(v, { tolerant: true })
    if (!version) return
    const pkg = { project, version }
    return {
      pkg, type: 'src', path,
      extname: path.extname(),
    }
  }
}
