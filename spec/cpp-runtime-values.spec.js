// @ts-check

import assert from "node:assert/strict"
import {access} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"
import {cppRuntime} from "../src/backends/cpp-runtime.js"
import {executeCpp, executeCppArtifacts} from "./support/cpp-toolchain.js"

const profiles = []

for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) profiles.push({optimization, sanitized})
const moduleFrom = source => parse({language: "typescript", filename: "values.ts", source})
const numericFunctions = `function product(left: number, right: number): number { return left * right; }
function sum(left: number, right: number): number { return left + right; }
function subtract(left: number, right: number): number { return left - right; }
function negate(left: number, right: number): number { return -left; }
const maximum: number = sum(product(9007199254740991, 1024), 1023);
const minimum: number = subtract(negate(maximum, 0), 1);
`

describe("C++ scalar bounds and owned string lifetimes", () => {
  it("preserves escaped CR/LF and Unicode/NUL through native execution and CPP normalization", async () => {
    const ordinary = cppRuntime + '\nstd::string join(std::string left, std::string right) { return left + right; }\nint main() { semantifold_print_string(std::string("a\\r\\nb\\000é😀", 11)); return 0; }\n'

    for (const ending of ["\n", "\r\n", "\r"]) {
      const content = ending == "\r" ? cppRuntime + ordinary.slice(cppRuntime.length).replaceAll("\n", ending) : ordinary.replaceAll("\n", ending)
      const module = parse({language: "cpp", filename: "escaped-lines.cpp", source: content})

      for (const profile of profiles) for (const source of [content, generate({language: "cpp", module})]) {
        const result = await executeCppArtifacts({artifacts: [{path: "program.cpp", content: source}]}, profile)

        assert.deepEqual(result.bytes, Buffer.from("a\r\nb\0é😀\n"))
        expect(result.stderr).toEqual("")
        expect(result.status).toEqual(0)
      }
    }
  })

  it("rejects a raw CR literal that the grammar accepts and the native compiler rejects", async () => {
    const content = cppRuntime + '\nstd::string join(std::string left, std::string right) { return left + right; }\nint main() { semantifold_print_string(std::string("a\rb", 3)); return 0; }\n'
    let directory

    await assert.rejects(executeCppArtifacts({artifacts: [{path: "program.cpp", content}]}), error => {
      directory = error.directory
      expect(error.stage).toEqual("compile")
      expect(error.code).toEqual(1)
      assert.match(error.stderr, /missing terminating/u)
      return true
    })
    await assert.rejects(access(directory), error => error.code == "ENOENT")
    assert.throws(() => parse({language: "cpp", filename: "raw-cr.cpp", source: content}), error =>
      error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && error.location?.filename == "raw-cr.cpp" &&
      content.slice(error.location.start.offset, error.location.end.offset) == "a\rb")
  })

  it("prints both signed int64 extrema without locale or signed overflow", async () => {
    const module = moduleFrom(numericFunctions + "console.log(maximum); console.log(minimum);")

    for (const profile of profiles) {
      const result = await executeCpp(module, profile)

      expect(result.stdout).toEqual("9223372036854775807\n-9223372036854775808\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
      await assert.rejects(access(result.directory), error => error.code == "ENOENT")
    }
  })

  it("terminates every dynamic arithmetic overflow with exact status and diagnostics in all profiles", async () => {
    for (const expression of ["sum(maximum, 1)", "subtract(minimum, 1)", "product(9007199254740991, 2048)", "negate(minimum, 0)"]) {
      const module = moduleFrom(numericFunctions + `console.log("before"); console.log(${expression});`)

      for (const profile of profiles) {
        let directory

        await assert.rejects(executeCpp(module, profile), error => {
          directory = error.directory
          return error.stage == "execute" && error.code == 70 && error.signal === null &&
            error.stderr === "semantifold: integer overflow\n" && error.stdout === "before\n"
        })
        await assert.rejects(access(directory), error => error.code == "ENOENT")
      }
    }
  })

  it("keeps long Unicode/NUL copies and returned values independent through repeated concatenation and reassignment", async () => {
    const text = "é\0😀中".repeat(64)
    const source = `function join(left: string, right: string): string {
      const original: string = left;
      let changed: string = left + right;
      changed = changed + original;
      console.log(original);
      return changed;
    }
    const first: string = ${JSON.stringify(text)};
    let second: string = first;
    const result: string = join(second, "尾");
    second = "changed";
    console.log(first); console.log(second); console.log(result); console.log(first === result); console.log(first !== result);`
    const module = moduleFrom(source)
    const content = generate({language: "cpp", module})
    const reparsed = parse({language: "cpp", filename: "program.cpp", source: content})
    const stdout = `${text}\n${text}\nchanged\n${text}尾${text}\nfalse\ntrue\n`

    expect(generate({language: "cpp", module: reparsed})).toEqual(content)
    for (const profile of profiles) {
      const result = await executeCpp(reparsed, profile)

      assert.deepEqual(result.bytes, Buffer.from(stdout))
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
  })

  it("executes caller string value operators and checked helpers before and after CPP normalization", async () => {
    const content = cppRuntime + `
std::string join(std::string left, std::string right) { return left + right; }
bool same(std::string left, std::string right) { return left == right; }
bool different(std::string left, std::string right) { return left != right; }
std::int64_t arithmetic(std::int64_t left, std::int64_t right) {
    const std::int64_t added = semantifold_integer_add(left, right);
    const std::int64_t reduced = semantifold_integer_subtract(added, std::int64_t(1));
    const std::int64_t product = semantifold_integer_multiply(reduced, std::int64_t(2));
    return semantifold_integer_negate(product);
}
int main() {
    std::string result = join(std::string("é\\000", 3), std::string("😀", 4));
    semantifold_print_string(result);
    semantifold_print_boolean(same(result, std::string("é\\000😀", 7)));
    semantifold_print_boolean(different(result, std::string("", 0)));
    semantifold_print_integer(arithmetic(std::int64_t(4), std::int64_t(9)));
    return 0;
}
`
    const module = parse({language: "cpp", filename: "caller.cpp", source: content})
    const expected = "é\0😀\ntrue\ntrue\n-24\n"

    for (const profile of profiles) for (const source of [content, generate({language: "cpp", module})]) {
      const result = await executeCppArtifacts({artifacts: [{path: "program.cpp", content: source}]}, profile)

      assert.deepEqual(result.bytes, Buffer.from(expected))
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
  })

  it("rejects source comment and hex escape mismatches proved by real native output", async () => {
    const ordinary = generate({language: "cpp", module: moduleFrom('function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));')})
    const hidden = ordinary.replace("int main() {\n", "int main() {\n// comment\rsemantifold_print_integer(std::int64_t(99));\n")
    const hex = cppRuntime + '\nstd::string join(std::string left, std::string right) { return left + right; }\nint main() { semantifold_print_string(join(std::string("\\x000041", 1), std::string("", 0))); return 0; }\n'

    for (const [content, expected] of [[hidden, "99\n13\n"], [hex, "A\n"]]) {
      for (const profile of profiles) {
        const result = await executeCppArtifacts({artifacts: [{path: "program.cpp", content}]}, profile)

        assert.deepEqual(result.bytes, Buffer.from(expected))
        expect(result.stderr).toEqual("")
        expect(result.status).toEqual(0)
      }
      assert.throws(() => parse({language: "cpp", filename: "mismatch.cpp", source: content}), error =>
        error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && Boolean(error.location))
    }
  })
})
