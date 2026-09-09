// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse} from "../index.js"
import {executeKotlin, executeKotlinArtifacts, kotlinProfiles, kotlinSourceArtifacts} from "./support/kotlin-toolchain.js"

describe("Kotlin/JVM real compiler and runnable-JAR execution", () => {
  for (const [directory, stdout] of kotlinProfiles) {
    it("compiles and executes the " + (directory || "base") + " source and generated profiles with warnings as errors", async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.kt`, import.meta.url), "utf8")
      const module = parse({language: "kotlin", filename: "Program.kt", source})
      const results = [await executeKotlinArtifacts(kotlinSourceArtifacts(source), {label: "original-" + (directory || "base")}),
        await executeKotlin(module, {label: "generated-" + (directory || "base")})]

      for (const result of results) {
        expect(result.compile.status).toEqual(0)
        expect(result.compile.stderr).toEqual("")
        expect(result.execute.status).toEqual(0)
        expect(result.execute.stderr).toEqual("")
        expect(result.execute.stdout).toEqual(stdout)
        assert.deepEqual(result.execute.bytes, Buffer.from(stdout, "utf8"))
      }
    })
  }

  it("preserves exact JVM String equality for non-normalized scalar sequences", async () => {
    const module = parse({language: "typescript", filename: "equality.ts", source:
      'function same(left: string, right: string): boolean { return left === right; } ' +
      'console.log(same("é", "é")); console.log(same("😀", "😀"));'})
    const result = await executeKotlin(module, {label: "scalar-equality"})

    expect(result.execute.stdout).toEqual("false\ntrue\n")
  })

  it("preserves observable eager operand, call-argument, and short-circuit order", async () => {
    const cases = [
      ["eager-operands", `fun markLeft(left: Long, right: Long): Long { println("left"); return left }
fun markRight(left: Long, right: Long): Long { println("right"); return right }
fun add(left: Long, right: Long): Long { return markLeft(left, right) + markRight(left, right) }
fun main() { println(add(2, 3)) }
`, "left\nright\n5\n"],
      ["call-arguments", `fun markLeft(left: Long, right: Long): Long { println("left"); return left }
fun markRight(left: Long, right: Long): Long { println("right"); return right }
fun select(left: Long, right: Long): Long { return left }
fun ordered(left: Long, right: Long): Long { return select(markLeft(left, right), markRight(left, right)) }
fun main() { println(ordered(2, 3)) }
`, "left\nright\n2\n"],
      ["short-circuit", `fun markLeft(left: Boolean, right: Boolean): Boolean { println("left"); return left }
fun markRight(left: Boolean, right: Boolean): Boolean { println("right"); return right }
fun both(left: Boolean, right: Boolean): Boolean { return markLeft(left, right) && markRight(left, right) }
fun main() { println(both(false, true)) }
`, "left\nfalse\n"]
    ]

    for (const [label, source, stdout] of cases) {
      const module = parse({language: "kotlin", filename: "Program.kt", source})
      const result = await executeKotlin(module, {label})

      expect(result.execute.stdout).toEqual(stdout)
      expect(result.execute.stderr).toEqual("")
    }
  })

  it("traps dynamic add, subtract, and multiply results outside the safe range or JVM Long", async () => {
    for (const [name, operation, left, right] of [
      ["add", "+", "9007199254740991", "1"],
      ["subtract", "-", "-9007199254740991", "1"],
      ["multiply", "*", "9007199254740991", "2"],
      ["multiplyLong", "*", "9007199254740991", "9007199254740991"]
    ]) {
      const module = parse({language: "typescript", filename: "overflow.ts", source:
        `function ${name}(left: number, right: number): number { return left ${operation} right; } ` +
        `console.log(${name}(${left}, ${right}));`})
      const result = await executeKotlinArtifacts(generateArtifactSet({language: "kotlin", module}),
        {expectedStatus: 1, label: `${name}-overflow`})

      expect(result.execute.stdout).toEqual("")
      expect(result.execute.stderr).toContain("ArithmeticException")
    }
  })
})
