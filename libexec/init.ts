#!/usr/bin/env -S deno run

const arg = Deno.args[0]

let project: string

const url = swallow(() => new URL(arg))
if (url) {
  project = url.hostname + url.pathname
} else if (arg) {
  project = arg
} else {
  const { stdout } = await new Deno.Command("sample-blend.rb").output()
  project = new TextDecoder().decode(stdout).trim()
  project = `wip/${project}`
}

console.info(project)

function swallow<T>(fn: () => T) {
  try { return fn() } catch { /*noop*/ }
}
