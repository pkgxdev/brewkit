import { assertEquals } from "deno/testing/asserts.ts"
import useCache from "../../lib/useCache.ts"
import Path from "path"
import SemVer from "semver"

Deno.test("decode", async test => {
  const cache = useCache()

  const versions = ["1", "1a", "1.2", "1.2a", "1.2.3", "1.2.3a", "1.2.3.4", "1.2.3.4a"] as const
  for (const version of versions) {
    await test.step(`type == bottle, version == ${version}`, () => {
      const stowed = cache.decode(Path.root.join(`project∕foo-${version}+linux+x86-64.tar.gz`)) as any
      assertEquals(stowed.pkg.project, "project/foo")
      assertEquals(stowed.pkg.version, new SemVer(version, { tolerant: true }))
      assertEquals(stowed.type, "bottle")
      assertEquals(stowed.compression, "gz")
      assertEquals(stowed.host, {arch: "x86-64", platform: "linux"})
    })
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
