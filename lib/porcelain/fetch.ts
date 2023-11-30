import { hooks, utils, Stowage, Path, Package } from "pkgx"
import usePantry from "brewkit/hooks/usePantry.ts"
import { Config, ConfigPath } from "brewkit/config.ts";

const { useOffLicense } = hooks
const pantry = usePantry()

export default async function fetch({pkg, path: {tarball_dir, src: dstdir}}: Pick<Config, 'pkg'> & {path: Pick<ConfigPath, 'tarball_dir' | 'src'>}) {
  const { url, ref, type, stripComponents } = await pantry.getDistributable(pkg) ?? {}

  if (!url) {
    throw new Error(`warn: pkg has no srcs: ${utils.pkg.str(pkg)}`)
  }

  if (dstdir.isDirectory() && !dstdir.isEmpty()) {
    return dstdir
  }

  if (type === "git") {
    return clone({ dst: dstdir, src: url, ref })
  } else {
    const zipfile = await download(url, tarball_dir, pkg)
    await hooks.useSourceUnarchiver().unarchive({ dstdir, zipfile, stripComponents })
    if (!Deno.env.get("CI")) {
      const cwd = dstdir.string
      await new Deno.Command("git", {args: ["init"], cwd}).spawn().status
      await new Deno.Command("git", {args: ["add", "."], cwd}).spawn().status
    }
    return dstdir
  }
}

// Clones a git repo, then builds a src tarball from it
// This allows our system to treat git repos as if they were
// tarballs, improving internal consistency
async function clone({ dst, src, ref }: { dst: Path, src: URL, ref?: string }) {
  if (dst.join(".git").isDirectory()) {
    return dst
  }

  // ensure the parent dir exists
  dst.parent().mkdir('p')

  const tmp = Path.mktemp({})

  const args = [
    "clone",
    "--quiet",
    "--depth=1"
  ]
  if (ref) {
    args.push("--branch", ref)
  }
  args.push(
    src.toString(),
    tmp.string,
  )

  // Clone the specific ref to our temp dir
  const proc = new Deno.Command("git", {
    args,
    // `git` uses stderr for... non errors, and --quiet
    // doesn't touch them
    stderr: "null",
  })
  const status = await proc.spawn().status
  if (!status.success) {
    throw new Error(`git failed to clone ${src} to ${dst}`)
  }

  return dst
}

async function download(url: URL, dstdir: Path, pkg: Package) {
  let slug = pkg.project.replace(/\//g, "∕")  // this is a unicode separator
  slug += `-${pkg.version}`
  const tarball = dstdir.join(slug + new Path(url.pathname).extname())

  if (tarball.isFile()) {
    return tarball
  }

  try {
    // first try the original location
    return await curl({ dst: tarball, src: url })
  } catch (err) {
    try {
      // then try our mirror
      const stowage: Stowage = { pkg, type: 'src', extname: new Path(url.pathname).extname() }
      const src = useOffLicense('s3').url(stowage)
      return await curl({ dst: tarball, src })
    } catch (err2) {
      err.cause = err2
      throw err
    }
  }
}

async function curl({ dst, src }: { dst: Path, src: URL }) {
  //NOTE we always use curl as deno’s fetch barfs on sourceforge’s SSL for some reason
  dst.parent().mkdir('p')
  // using cURL as deno’s fetch fails for certain sourceforge URLs
  // seemingly due to SSL certificate issues. cURL basically always works ¯\_(ツ)_/¯
  const proc = new Deno.Command("curl", {
    args: ["--fail", "--location", "--output", dst.string, src.toString()]
  })
  const status = await proc.spawn().status
  if (!status.success) {
    console.error({ dst, src })
    throw new Error(`cURL failed to download ${src}`)
  }
  return dst
}
