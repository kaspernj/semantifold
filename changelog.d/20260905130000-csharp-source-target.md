Add C# as the seventh Tasks 001–004 frontend and a deterministic two-artifact .NET 10/C# 14 target.

The official `tree-sitter-c-sharp@0.23.5` registry grammar is pinned and qualified for Node 24, native ABI/recovery behavior, and exact UTF-16 provenance. C# generation is available through `generateArtifactSet()` as mapped `Program.cs` plus a fixed synthetic `Semantifold.csproj`; legacy single-artifact generation fails closed. The canonical toolchain now discovers .NET SDK 10 and acceptance models restore, compile, and execute as separate real stages.

C# string emission escapes every source line terminator, including NEL, and backend validation rejects intrinsic keyword spellings and semantic function names that would hide inherited `object` members under warnings-as-errors compilation.
