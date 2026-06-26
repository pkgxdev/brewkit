// bkinterp — static load-time PT_INTERP fixup for bklibcvenv-sealed bins.
// bin/<cmd> -> ../libexec/bkinterp. Locate self via /proc/self/exe, command
// via argv[0]; ensure libexec/<cmd>'s PT_INTERP == prefix/lib/<libc>/<ldso>,
// re-poking only when stale (survives relocation), then exec it directly so
// /proc/self/exe is the real binary. No deps beyond a static musl libc.
//
// Concurrency: under `make -jN` the same wrapped binary is invoked many times
// at once. We must NOT hold a writable fd on the target while other processes
// execve it, or the kernel returns ETXTBSY. So the check is read-only, the
// target is opened writable ONLY when a poke is actually required (first run /
// after a move), and execve is retried on ETXTBSY to cover the brief window
// where another process is mid-poke.
const std = @import("std");
const posix = std.posix;

fn dirname(p: []const u8) []const u8 {
    return std.fs.path.dirname(p) orelse ".";
}

pub fn main() u8 {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    const a = gpa.allocator();

    var selfbuf: [std.fs.max_path_bytes]u8 = undefined;
    const self = std.fs.selfExePath(&selfbuf) catch return 127;
    const prefix = dirname(dirname(self)); // .../libexec/bkinterp -> prefix

    const argv = std.os.argv;
    const arg0 = std.mem.span(argv[0]);
    const cmd = std.fs.path.basename(arg0);

    const target = std.fmt.allocPrintSentinel(a, "{s}/libexec/{s}", .{ prefix, cmd }, 0) catch return 127;

    // --- read PT_INTERP (READ-ONLY: holding a writable fd here would race
    //     concurrent execve()s of the same file → ETXTBSY under make -jN) ---
    var ioff: u64 = 0;
    var isz: u64 = 0;
    var cur_raw: []u8 = &.{};
    {
        const f = std.fs.cwd().openFile(target, .{}) catch return 126;
        defer f.close();
        var hdr: [64]u8 = undefined;
        _ = f.preadAll(&hdr, 0) catch return 126;
        const phoff = std.mem.readInt(u64, hdr[0x20..0x28], .little);
        const phentsize = std.mem.readInt(u16, hdr[0x36..0x38], .little);
        const phnum = std.mem.readInt(u16, hdr[0x38..0x3a], .little);

        var i: u16 = 0;
        while (i < phnum) : (i += 1) {
            var ph: [56]u8 = undefined;
            _ = f.preadAll(&ph, phoff + @as(u64, i) * phentsize) catch return 126;
            if (std.mem.readInt(u32, ph[0..4], .little) == 3) { // PT_INTERP
                ioff = std.mem.readInt(u64, ph[8..16], .little);
                isz = std.mem.readInt(u64, ph[0x20..0x28], .little);
                break;
            }
        }
        if (isz == 0) return 126;
        cur_raw = a.alloc(u8, isz) catch return 127;
        _ = f.preadAll(cur_raw, ioff) catch return 126;
    } // read-only fd closed before any poke / exec

    const cur = std.mem.sliceTo(cur_raw, 0);
    const ldso = std.fs.path.basename(cur);

    // --- find prefix/lib/*/<ldso> ---
    const libdir = std.fmt.allocPrint(a, "{s}/lib", .{prefix}) catch return 127;
    var want: ?[]u8 = null;
    {
        var dir = std.fs.openDirAbsolute(libdir, .{ .iterate = true }) catch return 126;
        defer dir.close();
        var it = dir.iterate();
        while (it.next() catch null) |ent| {
            if (ent.kind != .directory) continue;
            const cand = std.fmt.allocPrint(a, "{s}/{s}/{s}", .{ libdir, ent.name, ldso }) catch continue;
            std.fs.accessAbsolute(cand, .{}) catch continue;
            want = cand;
            break;
        }
    }

    // --- poke ONLY if stale: writable fd is opened and closed immediately, so
    //     the ETXTBSY window is limited to the rare first-run / post-move case ---
    if (want) |w| {
        if (!std.mem.eql(u8, cur, w) and w.len + 1 <= isz) {
            if (std.fs.cwd().openFile(target, .{ .mode = .read_write })) |wf| {
                defer wf.close();
                const buf = a.alloc(u8, isz) catch return 127;
                @memset(buf, 0);
                @memcpy(buf[0..w.len], w);
                _ = wf.pwriteAll(buf, ioff) catch {};
            } else |_| {}
        }
    }

    // --- exec, retrying on ETXTBSY: another process may briefly hold the target
    //     writable while poking it on first run. execveZ returns its error set
    //     only on failure (it is noreturn on success). ---
    var tries: usize = 0;
    while (true) {
        const e = posix.execveZ(target, @ptrCast(argv.ptr), @ptrCast(std.os.environ.ptr));
        if (e == error.FileBusy and tries < 100) {
            tries += 1;
            std.Thread.sleep(std.time.ns_per_ms);
            continue;
        }
        std.debug.print("bkinterp: execve {s}: {}\n", .{ target, e });
        return 127;
    }
}
