const std = @import("std");

var semantifold_arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);

pub fn main() void {
    defer semantifold_arena.deinit();
    std.process.exit(0);
}
