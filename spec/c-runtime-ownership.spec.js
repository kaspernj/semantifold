// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse} from "../index.js"
import {executeC, executeCArtifacts} from "./support/c-toolchain.js"

const options = []

for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) options.push({optimization, sanitized})
const moduleFrom = (source) => parse({language: "typescript", filename: "ownership.ts", source})
const numericFunctions = `function product(left: number, right: number): number { return left * right; }
function sum(left: number, right: number): number { return left + right; }
function subtract(left: number, right: number): number { return left - right; }
function negate(left: number, right: number): number { return -left; }
function join(left: string, right: string): string { return left + right; }
const held: string = join("é\\u0000", "😀");
const maximum: number = sum(product(9007199254740991, 1024), 1023);
const minimum: number = subtract(negate(maximum, 0), 1);
`

/** Native linker instrumentation counts only generated malloc/free references. */
function allocationHarness(expected, failAt = 0) {
  return `#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
void *__real_malloc(size_t size);
void __real_free(void *pointer);
void *__wrap_malloc(size_t size);
void __wrap_free(void *pointer);
static void *allocations[16];
static size_t calls = 0;
static size_t allocated = 0;
static size_t released = 0;
static void verify(void) {
    if (allocated != ${expected} || released != allocated) {
        (void)fputs("native ownership count mismatch\\n", stderr);
        _Exit(71);
    }
}
void *__wrap_malloc(size_t size) {
    if (calls++ == 0 && atexit(verify) != 0) _Exit(72);
    if (calls == ${failAt}) return NULL;
    if (allocated == 16) _Exit(73);
    void *pointer = __real_malloc(size);
    if (pointer == NULL) _Exit(74);
    allocations[allocated++] = pointer;
    return pointer;
}
void __wrap_free(void *pointer) {
    for (size_t index = 0; index < allocated; index++) {
        if (allocations[index] == pointer && pointer != NULL) {
            allocations[index] = NULL;
            released++;
            __real_free(pointer);
            return;
        }
    }
    (void)fputs("native invalid or duplicate free\\n", stderr);
    _Exit(75);
}
`
}
const instrument = (expected, failAt) => ({extraSource: allocationHarness(expected, failAt), linkFlags: ["-Wl,--wrap=malloc", "-Wl,--wrap=free"]})
const failure = (stderr, stdout = "") => (error) => error instanceof Error && error.code === 70 &&
  error.signal === null && error.stderr === stderr && error.stdout === stdout

describe("C deterministic arithmetic and arena ownership", () => {
  it("formats both int64 bounds and releases returned/copied/concatenated slices exactly once", async () => {
    const module = moduleFrom(numericFunctions + 'console.log(maximum); console.log(minimum); console.log(held);')

    for (const profile of options) {
      const result = await executeC(module, {...profile, ...instrument(1)})

      expect(result.stdout).toEqual("9223372036854775807\n-9223372036854775808\né\0😀\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
  })

  it("checks add, subtract, multiply and negate overflow and cleans the arena before fatal exit", async () => {
    for (const expression of ["sum(maximum, 1)", "subtract(minimum, 1)", "product(9007199254740991, 2048)", "negate(minimum, 0)"]) {
      const module = moduleFrom(numericFunctions + `console.log(${expression});`)

      for (const profile of options) await assert.rejects(executeC(module, {...profile, ...instrument(1)}), failure("semantifold: integer overflow\n"))
    }
  })

  it("fails deterministically on the second allocation and frees the already returned slice", async () => {
    const module = moduleFrom('function join(left: string, right: string): string { return left + right; } const first: string = join("é", "😀"); console.log(join(first, "\\u0000"));')

    for (const profile of options) await assert.rejects(executeC(module, {...profile, ...instrument(1, 2)}), failure("semantifold: allocation failure\n"))
  })

  it("counts concatenations without charging borrowed copies, parameters, returns or literals", async () => {
    const module = moduleFrom('function join(left: string, right: string): string { const copy: string = left; return copy + right; } ' +
      'const first: string = join("", ""); const copy: string = first; const next: string = join(copy, "é\\u0000😀"); console.log(join(next, next));')

    for (const profile of options) {
      const result = await executeC(module, {...profile, ...instrument(3)})

      expect(result.stdout).toEqual("é\0😀é\0😀\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
  })

  it("checks length addition, metadata size and cumulative arena limits before touching borrowed memory", async () => {
    const set = generateArtifactSet({language: "c", module: moduleFrom('function join(left: string, right: string): string { return left + right; } console.log(join("", ""));')})
    const bodies = [
      "(void)semantifold_allocation_size(SIZE_MAX, 0);",
      "(void)semantifold_allocation_size((size_t)PTRDIFF_MAX, 1);",
      "(void)semantifold_allocation_size((size_t)PTRDIFF_MAX - sizeof(SemantifoldAllocation) + 1, 0);",
      "semantifold_arena_bytes = (size_t)PTRDIFF_MAX; (void)semantifold_allocation_size(0, 0);"
    ]

    for (const body of bodies) for (const profile of options) {
      const native = {artifacts: [{path: "program.c", content: '#include "semantifold_runtime.h"\nint main(void) { ' + body + ' semantifold_cleanup(); return 0; }\n'}, set.artifacts[1]]}

      await assert.rejects(executeCArtifacts(native, profile), failure("semantifold: allocation size\n"))
    }
  })
})
