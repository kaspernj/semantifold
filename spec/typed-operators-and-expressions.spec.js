// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {generate, getNodeProvenance, parse, SemantifoldDiagnostic} from "../index.js"

const execFileAsync = promisify(execFile)
const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]
const targets = fixtures.map(([language]) => language)
const filenames = new Map(fixtures)
const expectedOperationTypes = new Map([
  ["BooleanAnd", "boolean"],
  ["BooleanEqual", "boolean"],
  ["BooleanNot", "boolean"],
  ["BooleanNotEqual", "boolean"],
  ["BooleanOr", "boolean"],
  ["IntegerAdd", "integer"],
  ["IntegerEqual", "boolean"],
  ["IntegerGreaterThan", "boolean"],
  ["IntegerGreaterThanOrEqual", "boolean"],
  ["IntegerLessThan", "boolean"],
  ["IntegerLessThanOrEqual", "boolean"],
  ["IntegerMultiply", "integer"],
  ["IntegerNegate", "integer"],
  ["IntegerNotEqual", "boolean"],
  ["IntegerSubtract", "integer"],
  ["StringConcat", "string"],
  ["StringEqual", "boolean"],
  ["StringNotEqual", "boolean"]
])

/**
 * Removes source-only metadata before semantic comparisons.
 * @param {unknown} value - Semantic value.
 * @returns {unknown} Location-free value.
 */
function withoutSourceMetadata(value) {
  return JSON.parse(JSON.stringify(value, (key, item) =>
    key == "location" || key == "provenance" || key == "sourceProvenance" ? undefined : item))
}

/**
 * Collects typed operation nodes from an opaque semantic subtree.
 * @param {unknown} value - Semantic subtree.
 * @param {{operation: string, type: string}[]} [operations] - Accumulator.
 * @returns {{operation: string, type: string}[]} Operation nodes.
 */
function collectOperations(value, operations = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectOperations(child, operations)
  } else if (value && typeof value == "object") {
    const operation = Reflect.get(value, "operation")
    const type = Reflect.get(value, "type")

    if (typeof operation == "string" && typeof type == "string") operations.push({operation, type})
    for (const [key, child] of Object.entries(value)) {
      if (key != "location" && key != "provenance" && key != "sourceProvenance") collectOperations(child, operations)
    }
  }

  return operations
}

/**
 * Executes generated source through the named real target toolchain.
 * @param {string} language - Target language.
 * @param {string} source - Generated source.
 * @returns {Promise<string>} Standard output.
 */
async function executeGenerated(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-operators-${language}-`))

  try {
    const filename = path.join(directory, filenames.get(language) ?? "program")

    await writeFile(filename, source)
    if (language == "php") return (await execFileAsync("php", [filename])).stdout
    if (language == "ruby") return (await execFileAsync("ruby", [filename])).stdout
    if (language == "javascript") return (await execFileAsync("node", [filename])).stdout
    if (language == "typescript") {
      await execFileAsync(path.resolve("node_modules/.bin/tsc"), [filename, "--target", "ES2024", "--module", "nodenext"], {cwd: directory})

      return (await execFileAsync("node", [path.join(directory, "program.js")])).stdout
    }

    await execFileAsync("javac", [filename], {cwd: directory})

    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

describe("typed operators and richer expressions", () => {
  it("normalizes nested TypeScript operators to closed typed operations", () => {
    const module = parse({
      filename: "operators.ts",
      language: "typescript",
      source: `function compute(left: number, right: number): number {
  if (!(left === right) && left <= right) {
    return -left + right * 2
  } else {
    return left - right
  }
}
console.log(compute(3, 10))
`
    })
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body[0])

    expect(withoutSourceMetadata(branch.condition)).toEqual({
      kind: "BinaryExpression",
      left: {
        kind: "UnaryExpression",
        operand: {
          kind: "BinaryExpression",
          left: {kind: "IdentifierExpression", name: "left"},
          operation: "IntegerEqual",
          right: {kind: "IdentifierExpression", name: "right"},
          type: "boolean"
        },
        operation: "BooleanNot",
        type: "boolean"
      },
      operation: "BooleanAnd",
      right: {
        kind: "BinaryExpression",
        left: {kind: "IdentifierExpression", name: "left"},
        operation: "IntegerLessThanOrEqual",
        right: {kind: "IdentifierExpression", name: "right"},
        type: "boolean"
      },
      type: "boolean"
    })
    expect(withoutSourceMetadata(branch.consequent[0].expression)).toEqual({
      kind: "BinaryExpression",
      left: {
        kind: "UnaryExpression",
        operand: {kind: "IdentifierExpression", name: "left"},
        operation: "IntegerNegate",
        type: "integer"
      },
      operation: "IntegerAdd",
      right: {
        kind: "BinaryExpression",
        left: {kind: "IdentifierExpression", name: "right"},
        operation: "IntegerMultiply",
        right: {kind: "IntegerLiteral", value: 2},
        type: "integer"
      },
      type: "integer"
    })

    const condition = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (branch.condition)
    const negated = /** @type {import("../src/semantic/types.js").UnaryExpression} */ (condition.left)
    const equality = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (negated.operand)

    expect({
      equalityLine: equality.location.start.line,
      equalityOperator: getNodeProvenance(module, equality).ranges.operator.start.column,
      negatedLine: negated.location.start.line,
      rightLine: equality.right.location.start.line
    }).toEqual({equalityLine: 2, equalityOperator: 14, negatedLine: 2, rightLine: 2})
  })

  it("normalizes every operation and result type equivalently in all five frontends", async () => {
    const modules = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/operators/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const operations = collectOperations(module)
      const observed = new Map(operations.map(({operation, type}) => [operation, type]))

      expect(JSON.stringify(module).includes("sourceOperation")).toBe(false)
      expect([...observed.entries()].sort()).toEqual([...expectedOperationTypes.entries()].sort())
      expect(operations.every(({operation, type}) => expectedOperationTypes.get(operation) == type)).toBe(true)
      expect({language, output: await executeGenerated(language, source)}).toEqual({language, output: "typed:operators\n"})
      modules.push(module)
    }

    for (const module of modules.slice(1)) {
      expect(withoutSourceMetadata(module)).toEqual(withoutSourceMetadata(modules[0]))
    }
  })

  it("uses target-specific spelling for typed string operations", () => {
    const module = parse({
      filename: "strings.ts",
      language: "typescript",
      source: `function join(left: string, right: string): string {
  if (left === right) return left + right
  else return left + ":" + right
}
console.log(join("typed", "operators"))
`
    })

    const php = generate({language: "php", module})
    const java = generate({language: "java", module})

    assert.match(php, /\$left === \$right/u)
    assert.match(php, /\$left \. \$right/u)
    assert.match(java, /\(left\)\.equals\(right\)/u)
    assert.match(java, /left \+ right/u)
  })

  it("rejects mixed addition at the offending operand", () => {
    const source = `function invalid(left: number, right: string): string {
  if (true) return left + right
  else return right
}
console.log(invalid(1, "x"))
`

    assert.throws(
      () => parse({filename: "mixed.ts", language: "typescript", source}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_OPERAND_TYPE" &&
        error.location?.start.line == 2 && error.location.start.column == 27
    )
  })

  it("round-trips precedence and executes exact behavior through all five targets", async () => {
    const source = await readFile(new URL("fixtures/operators/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const generated = generate({language, module})
      const reparsed = parse({filename: filenames.get(language), language, source: generated})

      expect({language, module: withoutSourceMetadata(reparsed)}).toEqual({language, module: withoutSourceMetadata(module)})
      expect({language, output: await executeGenerated(language, generated)}).toEqual({language, output: "typed:operators\n"})
    }
  })

  it("preserves short-circuit order with side-effect-free divergent calls", async () => {
    const module = parse({
      filename: "short-circuit.ts",
      language: "typescript",
      source: `function diverge(flag: boolean, fallback: boolean): boolean {
  if (flag) return diverge(flag, fallback)
  else return fallback
}
function guarded(left: boolean, right: boolean): string {
  if ((left || diverge(true, false)) && (right && diverge(true, false))) return "bad"
  else return "short"
}
console.log(guarded(true, false))
`
    })

    for (const language of targets) {
      expect({language, output: await executeGenerated(language, generate({language, module}))}).toEqual({language, output: "short\n"})
    }
  })
})
