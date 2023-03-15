import { Stowed, SupportedArchitecture, SupportedPlatform } from "types"
import SemVer from "semver"
import Path from "path"

export default function() {
  return { decode }
}

function decode(path: Path): Stowed | undefined {
  const match = path.basename().match(`^(.*)-(\\d+\\.\\d+\\.\\d+.*?)(\\+(.+?)\\+(.+?))?\\.tar\\.[gx]z$`)
  if (!match) return
    const [_, p, v, host, platform, arch] = match
    // Gotta undo the package name manipulation to get the package from the bottle
    const project = p.replaceAll("∕", "/")
    const version = new SemVer(v)
    if (!version) return
    const pkg = { project, version }
    if (host) {
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
    } else {
      return {
        pkg, type: 'src', path,
        extname: path.extname(),
      }
    }
}
