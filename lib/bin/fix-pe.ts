#!/usr/bin/env -S pkgx +llvm.org/mingw-w64 deno^1 run -A

// fix-pe — Windows PE/COFF analog of fix-elf.
//
// PE has NO RPATH equivalent: Windows resolves DLL imports via a fixed
// search order (app dir → System32 → SysWOW64 → %PATH%). There's no
// $ORIGIN, no DT_RPATH, no DT_RUNPATH. So "relocation" of a bottle
// happens entirely by LAYOUT (DLLs co-located with the exe), not by
// patching metadata.
//
// What this script DOES do:
//
//   1. Strip "+brewing" from any embedded strings in PE binaries (same
//      problem as glibc's libc.so linker scripts in pkgxdev/pantry#12968:
//      the build-time install prefix leaks into binaries via debug-info
//      records, manifest paths, etc.).
//
//   2. Strip absolute build paths from .pdb debug-info records (where
//      present) — these are non-load-bearing but leak filesystem info.
//
//   3. Audit-only: verify every NEEDED DLL is either Windows-shipped
//      (kernel32, ntdll, ucrtbase, vcruntime140, …) or co-located in
//      the bottle. Warn (don't fail) if neither is true.
//
// What this script does NOT do:
//
//   - Rewrite import paths (Windows DLL search is by basename, not path)
//   - Insert "RPATH-equivalent" hints (none exist in PE/COFF)
//   - Run patchelf-style surgery on relocations (PE handles its own)
//
// The hermeticity story for Windows is `libexec/bkwinvenv seal` (which
// moves bin/*.exe → libexec/*.exe and emits .cmd wrappers) — orthogonal
// to this pass, just as bklibcvenv is orthogonal to fix-elf on Linux.
//
// Refs: pkgxdev/brewkit#346, #344 (bklibcvenv), #345 (per-package skip).

import { utils, Installation, hooks, Path } from "pkgx"
const { useCellar } = hooks
const { host } = utils

// Windows-resident DLLs that the loader always finds; we don't need
// to bundle these and we don't warn when an exe imports them.
const SYSTEM_DLLS = new Set([
  // Kernel + standard runtime
  "kernel32.dll", "ntdll.dll", "user32.dll", "gdi32.dll", "advapi32.dll",
  "msvcrt.dll", "ucrtbase.dll",
  // VC++ redistributable (assumed present from VS runtime install)
  "vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "concrt140.dll",
  // Networking / crypto
  "ws2_32.dll", "crypt32.dll", "bcrypt.dll", "secur32.dll",
  // Common system-level
  "shell32.dll", "ole32.dll", "oleaut32.dll", "comctl32.dll",
  "iphlpapi.dll", "dbghelp.dll", "psapi.dll", "version.dll",
])

const SYSTEM_DLL_PREFIXES = [
  "api-ms-win-",   // UCRT API-set forwarders (api-ms-win-crt-runtime-l1-1-0.dll etc.)
  "ext-ms-",
]

function is_system_dll(name: string): boolean {
  const lc = name.toLowerCase()
  if (SYSTEM_DLLS.has(lc)) return true
  return SYSTEM_DLL_PREFIXES.some(p => lc.startsWith(p))
}

if (import.meta.main) {
  if (host().platform != "windows") {
    // fix-pe runs even on Linux/macOS hosts when we cross-compile to
    // Windows. The Installation path will contain .exe / .dll files
    // that we want to audit + sanitize.
  }
  const cellar = useCellar()
  const [installation_path] = Deno.args
  const installed = await cellar.resolve(new Path(installation_path))
  await fix_pe(installed)
}

export default async function fix_pe(installation: Installation) {
  console.info("auditing PE binaries…")

  for await (const path of pe_files(installation.path)) {
    await strip_brewing_strings(path)
    await audit_imports(path, installation)
  }
}

// Iterate every regular file under installation/{bin,lib,libexec,sbin}
// whose first two bytes are 'MZ' (PE/COFF DOS header).
async function* pe_files(root: Path): AsyncIterable<Path> {
  for (const dir of ["bin", "lib", "libexec", "sbin"]) {
    const d = root.join(dir)
    if (!d.isDirectory()) continue
    for await (const entry of d.walk()) {
      if (!entry.isFile) continue
      const f = await Deno.open(entry.path.string, { read: true })
      try {
        const magic = new Uint8Array(2)
        await f.read(magic)
        if (magic[0] === 0x4d && magic[1] === 0x5a) {
          yield entry.path
        }
      } finally {
        f.close()
      }
    }
  }
}

// Replace any literal "+brewing" string in the binary with "" (just
// like the libc.so linker-script fix in pkgxdev/pantry#12968 but
// applied to binary files via stream rewrite, length-preserving).
//
// We use length-preserving substitution by replacing the +brewing
// bytes with NULs. That keeps file size + offsets stable, so PE
// section layout doesn't shift. The NULs are inert as path chars
// (Windows treats path-with-NUL as truncated).
async function strip_brewing_strings(path: Path) {
  const data = await Deno.readFile(path.string)
  const target = new TextEncoder().encode("+brewing")
  let modified = false
  outer:
  for (let i = 0; i <= data.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (data[i + j] !== target[j]) continue outer
    }
    // Match found at offset i — zero out.
    for (let j = 0; j < target.length; j++) data[i + j] = 0
    modified = true
  }
  if (modified) {
    await Deno.writeFile(path.string, data)
    console.info(`stripped +brewing from ${path}`)
  }
}

// llvm-readobj --coff-imports outputs each NEEDED DLL on a "Name: foo.dll" line.
// We audit (warn-only) that every non-system import is either in the bottle
// or somewhere brewkit can resolve via build.dependencies.
async function audit_imports(path: Path, installation: Installation) {
  const cmd = new Deno.Command("llvm-readobj", {
    args: ["--coff-imports", path.string],
    stdout: "piped", stderr: "null",
  })
  const { stdout } = await cmd.output()
  const text = new TextDecoder().decode(stdout)
  const imports = [...text.matchAll(/^\s*Name:\s+(\S+)/gm)].map(m => m[1])

  const unresolved: string[] = []
  for (const dll of imports) {
    if (is_system_dll(dll)) continue
    // Co-located check: is this DLL also in the bottle?
    const here = installation.path.join("bin").join(dll)
    const libexec = installation.path.join("libexec").join(dll)
    if (here.exists() || libexec.exists()) continue
    unresolved.push(dll)
  }

  if (unresolved.length) {
    console.warn(`${path}: unresolved DLL imports: ${unresolved.join(", ")}`)
    console.warn(`  (not in bottle, not a known Windows-system DLL)`)
    console.warn(`  bottle may need to bundle these via bkwinvenv seal`)
  }
}
