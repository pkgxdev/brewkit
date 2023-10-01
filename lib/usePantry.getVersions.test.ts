import { assertEquals, assert } from "deno/testing/asserts.ts"
import { _parse } from "./usePantry.getVersions.ts"
import { SemVer } from "libpkgx"

Deno.test("versions array", async () => {
  const foo = await _parse([3, "1.2.3", "v2.3.4"])
  assert(foo[0].eq(new SemVer("3.0.0")))
  assert(foo[1].eq(new SemVer("1.2.3")))
  assert(foo[2].eq(new SemVer("2.3.4")))
  assertEquals(foo.length, 3)
})

Deno.test("single version", async () => {
  const foo = await _parse("3")
  assert(foo[0].eq(new SemVer("3.0.0")))
  assertEquals(foo.length, 1)
})
