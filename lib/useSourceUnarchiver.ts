import { Unarchiver, TarballUnarchiver, ZipUnarchiver } from "./Unarchiver.ts"
import { Path } from "tea"

//FIXME assuming strip 1 on components is going to trip people up

interface Options {
  dstdir: Path    /// must be empty
  zipfile: Path
  stripComponents?: number
}

interface Response {
  unarchive(opts: Options): Promise<Path>
}

export default function useSourceUnarchiver(): Response {
  const unarchive = async (opts: Options) => {

    let unarchiver: Unarchiver
    if (ZipUnarchiver.supports(opts.zipfile)) {
      const dstdir = opts.dstdir.mkpath()
      unarchiver = new ZipUnarchiver({ ...opts, dstdir })
    } else if (TarballUnarchiver.supports(opts.zipfile) || opts.stripComponents !== undefined) {
      //FIXME we need to determine file type from the magic bytes
      // rather than assume tarball if not zip
      opts.dstdir.mkpath()
      unarchiver = new TarballUnarchiver({ ...opts })
    } else {
      // the “tarball” is actually just a single file like beyondgrep.com
      return opts.zipfile.cp({ into: opts.dstdir.mkpath() })
    }

    const cmd = unarchiver.args().map(x => x.toString())
    const proc = new Deno.Command(cmd.shift()!, { args: cmd })

    if (!(await proc.spawn().status).success) {
      throw new Error(`unarchiving failed: ${opts.zipfile}`)
    }

    return opts.dstdir
  }
  return { unarchive }
}
