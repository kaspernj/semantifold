// @ts-check

/** Exact Zig 0.15.2 standard-library-only support; the frontend checks every token before collapse. */
export const zigRuntime = `const std = @import("std");

var semantifold_arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);

fn semantifold_fail(message: []const u8) noreturn {
    std.fs.File.stderr().writeAll(message) catch {};
    std.process.exit(70);
}

fn semantifold_integer_add(left: i64, right: i64) i64 {
    const result = @addWithOverflow(left, right);
    if (result[1] != 0) semantifold_fail("semantifold: integer overflow\\n");
    return result[0];
}

fn semantifold_integer_subtract(left: i64, right: i64) i64 {
    const result = @subWithOverflow(left, right);
    if (result[1] != 0) semantifold_fail("semantifold: integer overflow\\n");
    return result[0];
}

fn semantifold_integer_multiply(left: i64, right: i64) i64 {
    const result = @mulWithOverflow(left, right);
    if (result[1] != 0) semantifold_fail("semantifold: integer overflow\\n");
    return result[0];
}

fn semantifold_integer_negate(value: i64) i64 {
    return semantifold_integer_subtract(0, value);
}

fn semantifold_string_concat(left: []const u8, right: []const u8) []const u8 {
    const size = @addWithOverflow(left.len, right.len);
    if (size[1] != 0) semantifold_fail("semantifold: allocation failure\\n");
    const bytes = semantifold_arena.allocator().alloc(u8, size[0]) catch semantifold_fail("semantifold: allocation failure\\n");
    @memcpy(bytes[0..left.len], left);
    @memcpy(bytes[left.len..], right);
    return bytes;
}

fn semantifold_string_equal(left: []const u8, right: []const u8) bool {
    return std.mem.eql(u8, left, right);
}

fn semantifold_string_not_equal(left: []const u8, right: []const u8) bool {
    return !std.mem.eql(u8, left, right);
}

fn semantifold_write(value: []const u8) void {
    const stdout = std.fs.File.stdout();
    stdout.writeAll(value) catch semantifold_fail("semantifold: output failure\\n");
    stdout.writeAll("\\n") catch semantifold_fail("semantifold: output failure\\n");
}

fn semantifold_print_integer(value: i64) void {
    var buffer: [20]u8 = undefined;
    const bytes = std.fmt.bufPrint(&buffer, "{d}", .{value}) catch semantifold_fail("semantifold: output failure\\n");
    semantifold_write(bytes);
}

fn semantifold_print_boolean(value: bool) void {
    semantifold_write(if (value) "true" else "false");
}

fn semantifold_print_string(value: []const u8) void {
    semantifold_write(value);
}
`

/** Fixed native-host Zig build with only the selected optimization option and no package resolution. */
export const zigBuild = `const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const executable = b.addExecutable(.{
        .name = "semantifold-generated",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        }),
    });
    b.installArtifact(executable);

    const tests = b.addTest(.{ .root_module = executable.root_module });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Compile and run tests");
    test_step.dependOn(&run_tests.step);
}
`
