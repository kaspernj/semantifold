// @ts-check

import assert from "node:assert/strict"
import {access, readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse} from "../index.js"
import {cppRuntime} from "../src/backends/cpp-runtime.js"
import {executeC} from "./support/c-toolchain.js"
import {executeCpp, executeCppArtifacts} from "./support/cpp-toolchain.js"

const cases = [
  ["checked arithmetic", "function calculate(left: number, right: number): number { const twice: number = right * 2; let result: number = -left + twice; result = result - 1; return result } console.log(calculate(3, 10))", "16\n"],
  ["owned returned UTF-8 values", 'function combine(left: string, right: string): string { const copy: string = left; let result: string = copy + right; result = result + copy; return result } console.log(combine("é\\u0000😀", "中"))', "é\0😀中é\0😀\n"],
  ["nested eager calls", "function mark(left: number, right: number): number { console.log(left); return right } function add(left: number, right: number): number { return left + right } console.log(add(mark(1, 10), mark(2, 20)) * mark(3, 2))", "1\n2\n3\n60\n"],
  ["short-circuit effects and fallthrough", 'function probe(flag: boolean, label: string): boolean { console.log(label); return flag } function choose(flag: boolean, fallback: string): string { if (flag && probe(true, "right")) { return "yes" } return fallback } console.log(choose(probe(false, "left"), "no")); if (probe(true, "or-left") || probe(false, "skipped")) { console.log("done") }', "left\nno\nor-left\ndone\n"]
]

describe("C++ native C++20 execution", () => {
  it("proves the actual standard-header macro and typedef collisions with Clang", async () => {
    for (const name of ["WEOF", "wint_t"]) {
      const content = cppRuntime + `\nstd::int64_t ${name}(std::int64_t left, std::int64_t right) { return left + right; }\nint main() { return 0; }\n`
      let directory

      await assert.rejects(executeCppArtifacts({artifacts: [{path: "program.cpp", content}]}), error => {
        directory = error.directory
        expect(error.stage).toEqual("compile")
        expect(error.code).toEqual(1)
        assert.match(error.stderr, name == "WEOF" ? /expanded from macro 'WEOF'/u : /redefinition of 'wint_t'/u)
        return true
      })
      await assert.rejects(access(directory), error => error.code == "ENOENT")
    }
  })

  it("preserves ordinary CPP identifiers and the different C include environment", async () => {
    const cppModule = parse({language: "typescript", filename: "names.ts", source:
      "function WEOFValue(left: number, right: number): number { return left + right; } function wint_type(weof: number, wint: number): number { return WEOFValue(weof, wint); } console.log(wint_type(4, 9));"})
    const cModule = parse({language: "typescript", filename: "c-names.ts", source:
      "function WEOF(left: number, right: number): number { return left + right; } function wint_t(left: number, right: number): number { return WEOF(left, right); } console.log(wint_t(4, 9));"})

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      for (const [execute, module] of [[executeCpp, cppModule], [executeC, cModule]]) {
        const result = await execute(module, {optimization, sanitized})

        assert.deepEqual(result.bytes, Buffer.from("13\n"))
        expect(result.stderr).toEqual("")
        expect(result.status).toEqual(0)
      }
    }
  })

  for (const [label, source, stdout] of cases) it("executes " + label + " at O0/O2 with and without sanitizers", async () => {
    const module = parse({language: "typescript", filename: "native.ts", source})

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeCpp(module, {optimization, sanitized})

      expect(result.stages).toEqual(["compile", "link", "execute"])
      expect(result.status).toEqual(0)
      expect(result.stderr).toEqual("")
      expect(result.stdout).toEqual(stdout)
      assert.deepEqual(result.bytes, Buffer.from(stdout, "utf8"))
    }
  })

  it("executes distinguishable nested effects in every statement consumer and both short-circuit paths", async () => {
    const source = await readFile(new URL("fixtures/ordered-program.ts", import.meta.url), "utf8")
    const module = parse({language: "typescript", filename: "ordered-program.ts", source})
    const expected = "arg-left\narg-right\ninitial-left\ninitial-right\nassign-left\nassign-right\ntest\nprint-left\nprint-right\n12\nand-left\nreturn-left\nreturn-right\n7\n" +
      "true-and-left\ntrue-and-right\ntrue\nfalse-or-left\nfalse-or-right\ntrue\ntrue-or-left\ntrue\nstring-left\nstring-right\né\0😀\n"
    const content = generateArtifactSet({language: "cpp", module}).artifacts[0].content
    const reparsed = parse({language: "cpp", filename: "program.cpp", source: content})

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeCpp(reparsed, {optimization, sanitized})

      expect(result.stdout).toEqual(expected)
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
      assert.deepEqual(result.bytes, Buffer.from(expected, "utf8"))
    }
  })

  it("compiles unused bindings, unused functions, forward calls and recursion without warning suppression", async () => {
    const source = `function first(left: number, right: number): number { if (left > 0) { return second(left - 1, right); } return right; }
function second(left: number, right: number): number { return first(left, right); }
function unused(left: string, right: string): string { let ignored: string = left; ignored = right; return right; }
console.log(first(2, 9));`
    const module = parse({language: "typescript", filename: "forward.ts", source})

    for (const optimization of ["-O0", "-O2"]) for (const sanitized of [false, true]) {
      const result = await executeCpp(module, {optimization, sanitized})

      expect(result.stdout).toEqual("9\n")
      expect(result.stderr).toEqual("")
      expect(result.status).toEqual(0)
    }
  })

  it("reports real compile, link and execution failures and removes each fresh directory", async () => {
    for (const [stage, content, status] of [
      ["compile", "#error intentional compile failure\n", 1],
      ["link", "void unavailable();\nint main(void) { unavailable(); return 0; }\n", 1],
      ["execute", "int main(void) { return 7; }\n", 7]
    ]) {
      let directory

      await assert.rejects(executeCppArtifacts({artifacts: [{path: "program.cpp", content}]}), (error) => {
        expect(error.stage).toEqual(stage)
        expect(error.code).toEqual(status)
        expect(error.stdout).toEqual("")
        if (stage == "execute") expect(error.stderr).toEqual("")
        else assert.ok(error.stderr.length > 0)
        directory = error.directory
        return true
      })
      await assert.rejects(access(directory), (error) => error.code == "ENOENT")
    }
  })

})
