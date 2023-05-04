import { assertEquals } from "deno/testing/asserts.ts"
import useCache from "../../lib/useCache.ts"
import Path from "path"
import SemVer from "semver"

Deno.test("decode", async test => {
  const cache = useCache()

  const versions = ["1", "9e" /* pattern of ijg.org */, "1.2", "3.3a" /* pattern of tmux */, "1.2.3", "1.2.3a", "1.2.3.4", "1.2.3.4a"] as const
  const archs = ["x86-64", "aarch64"]
  const platforms = ["linux", "darwin"]
  for (const version of versions) {
    for (const arch of archs) {
      for (const platform of platforms) {
        await test.step(`type == bottle, arch == ${arch}, platform == ${platform}, version == ${version}`, () => {
          const stowed = cache.decode(Path.root.join(`project∕foo-${version}+${platform}+${arch}.tar.gz`)) as any
          assertEquals(stowed.pkg.project, "project/foo")
          assertEquals(stowed.pkg.version, new SemVer(version, { tolerant: true }))
          assertEquals(stowed.type, "bottle")
          assertEquals(stowed.compression, "gz")
          assertEquals(stowed.host, {arch: arch, platform: platform})
        })
      }
    }
  }

  for (const version of versions) {
    await test.step(`type == src, version == ${version}`, () => {
      const stowed = cache.decode(Path.root.join(`project∕foo-${version}.tar.gz`)) as any
      assertEquals(stowed.pkg.project, "project/foo")
      assertEquals(stowed.pkg.version, new SemVer(version, { tolerant: true }))
      assertEquals(stowed.type, "src")
      assertEquals(stowed.extname, ".tar.gz")
    })
  }
})
