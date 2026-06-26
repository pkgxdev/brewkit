// bkinterp — static load-time PT_INTERP fixup for bklibcvenv-sealed bins.
// bin/<cmd> -> ../libexec/bkinterp. Locate self via /proc/self/exe, command
// via argv[0]; ensure libexec/<cmd>'s PT_INTERP == prefix/lib/<libc>/<ldso>,
// re-poking only when stale (survives relocation), then exec it directly so
// /proc/self/exe is the real binary. No deps beyond a static musl libc.
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

    // --- read PT_INTERP from the target ELF ---
    const f = std.fs.cwd().openFile(target, .{ .mode = .read_write }) catch
        std.fs.cwd().openFile(target, .{}) catch return 126;
    var hdr: [64]u8 = undefined;
    _ = f.preadAll(&hdr, 0) catch return 126;
    const phoff = std.mem.readInt(u64, hdr[0x20..0x28], .little);
    const phentsize = std.mem.readInt(u16, hdr[0x36..0x38], .little);
    const phnum = std.mem.readInt(u16, hdr[0x38..0x3a], .little);

    var i: u16 = 0;
    var ioff: u64 = 0;
    var isz: u64 = 0;
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
    const cur_raw = a.alloc(u8, isz) catch return 127;
    _ = f.preadAll(cur_raw, ioff) catch return 126;
    const cur = std.mem.sliceTo(cur_raw, 0);
    const ldso = std.fs.path.basename(cur);

    // --- find prefix/lib/*/<ldso> ---
    const libdir = std.fmt.allocPrint(a, "{s}/lib", .{prefix}) catch return 127;
    var want: ?[]u8 = null;
    var d = std.fs.openDirAbsolute(libdir, .{ .iterate = true }) catch return 126;
    defer d.close();
    var it = d.iterate();
    while (it.next() catch null) |ent| {
        if (ent.kind != .directory) continue;
        const cand = std.fmt.allocPrint(a, "{s}/{s}/{s}", .{ libdir, ent.name, ldso }) catch continue;
        std.fs.accessAbsolute(cand, .{}) catch continue;
        want = cand;
        break;
    }

    // --- poke if stale ---
    if (want) |w| {
        if (!std.mem.eql(u8, cur, w) and w.len + 1 <= isz) {
            const buf = a.alloc(u8, isz) catch return 127;
            @memset(buf, 0);
            @memcpy(buf[0..w.len], w);
            _ = f.pwriteAll(buf, ioff) catch {};
        }
    }

    // Close BEFORE exec: the kernel returns ETXTBSY if we execve a file that
    // is still open for writing.
    f.close();

    // --- exec the real binary (execveZ returns its error set on failure only) ---
    const e = posix.execveZ(target, @ptrCast(argv.ptr), @ptrCast(std.os.environ.ptr));
    std.debug.print("bkinterp: execve {s}: {}\n", .{ target, e });
    return 127;
}
