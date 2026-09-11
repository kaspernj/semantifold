// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {generate, getNodeProvenance, parse} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const execFileAsync = promisify(execFile)
const fixtures = [
  {filename: "program.php", language: "php"},
  {filename: "program.rb", language: "ruby"},
  {filename: "program.js", language: "javascript"},
  {filename: "program.ts", language: "typescript"},
  {filename: "Main.java", language: "java"}
]
const filenames = {java: "Main.java", javascript: "program.js", php: "program.php", ruby: "program.rb", typescript: "program.ts"}
const expectedOutput = "compat\nbranch-ok!\npresent\nabsent\n7\n2\n3\n5\n4\n"
const locationSpellings = {
  java: {
    entry: "\"main\", java.util.List.of(7, 8)", entryOperator: ",", optionalOperator: "isPresent",
    type: "java.util.Map<String,java.util.List<Integer>>", value: "java.util.List.of(7, 8)", valueType: "java.util.List<Integer>"
  },
  javascript: {
    entry: "[\"main\", [7, 8]]", entryOperator: ",", optionalOperator: "!==",
    type: "ReadonlyMap<string, ReadonlyArray<number>>", value: "[7, 8]", valueType: "ReadonlyArray<number>"
  },
  php: {
    entry: "\"main\" => [7, 8]", entryOperator: "=>", optionalOperator: "!==",
    type: "array<string,list<int>>", value: "[7, 8]", valueType: "list<int>"
  },
  ruby: {
    entry: "\"main\" => [7, 8]", entryOperator: "=>", optionalOperator: "nil?",
    type: "Hash[String,Array[Integer]]", value: "[7, 8]", valueType: "Array[Integer]"
  },
  typescript: {
    entry: "[\"main\", [7, 8]]", entryOperator: ",", optionalOperator: "!==",
    type: "ReadonlyMap<string, ReadonlyArray<number>>", value: "[7, 8]", valueType: "ReadonlyArray<number>"
  }
}

describe("Task 013 five-language compatibility acceptance", () => {
  it("normalizes all substantial fixtures completely and retains representative exact nested locations", async () => {
    const parsed = await readCompatibilityFixtures()
    const canonical = semanticMeaning(parsed[0].module)
    const requiredKinds = [
      "AssignmentStatement", "BinaryExpression", "Block", "BooleanLiteral", "BreakStatement", "CallExpression",
      "CollectionSizeExpression", "ContinueStatement", "EntryPoint", "ExpressionStatement", "ForEachStatement",
      "FunctionDeclaration", "IdentifierExpression", "IfStatement", "IntegerLiteral", "ListIndexExpression", "ListLiteral",
      "ListType", "LocalDeclaration", "MapEntry", "MapLiteral", "MapLookupExpression", "MapType", "Module",
      "OptionalIsPresent", "OptionalNone", "OptionalSome", "OptionalType", "OptionalUnwrap", "Parameter", "PrintStatement",
      "ResolvedFunctionSignature", "ReturnStatement", "StringLiteral", "TypeReference", "UnaryExpression", "ValueBinding"
    ]

    for (const fixture of parsed) {
      expect({language: fixture.language, meaning: semanticMeaning(fixture.module)})
        .toEqual({language: fixture.language, meaning: canonical})
      expect(semanticKinds(fixture.module)).toEqual(requiredKinds)
      assertRepresentativeLocations(fixture)
    }
  })

  it("validates, emits, reparses all 25 routes, proves byte deduplication, and runs every distinct target", async () => {
    const parsed = await readCompatibilityFixtures()
    const generatedByTarget = new Map(fixtures.map(({language}) => [language, []]))
    let combinations = 0

    for (const sourceFixture of parsed) {
      for (const targetFixture of fixtures) {
        const generated = generate({language: targetFixture.language, module: sourceFixture.module})
        const reparsed = parse({filename: filenames[targetFixture.language], language: targetFixture.language, source: generated})

        expect({source: sourceFixture.language, target: targetFixture.language, meaning: semanticMeaning(reparsed)})
          .toEqual({source: sourceFixture.language, target: targetFixture.language, meaning: semanticMeaning(sourceFixture.module)})
        generatedByTarget.get(targetFixture.language)?.push(generated)
        combinations++
      }
    }

    expect(combinations).toEqual(25)
    for (const {language} of fixtures) {
      const generated = generatedByTarget.get(language) ?? []

      expect({artifacts: generated.length, distinctByteSequences: new Set(generated).size, language})
        .toEqual({artifacts: 5, distinctByteSequences: 1, language})
      expect(await execute(language, /** @type {string} */ (generated[0]))).toEqual(expectedOutput)
    }
  })

  it("retains the original minimal five-language fixture as backward-compatible semantic coverage", async () => {
    const modules = []

    for (const fixture of fixtures) {
      const source = await readFile(new URL(`fixtures/${fixture.filename}`, import.meta.url), "utf8")

      modules.push(parse({...fixture, source}))
    }
    const canonical = semanticMeaning(modules[0])

    for (const module of modules) expect(semanticMeaning(module)).toEqual(canonical)
  })
})

/**
 * Reads and parses all Task 013 fixtures.
 * @returns {Promise<Array<{filename: string, language: string, module: import("../src/semantic/types.js").SemanticModule, source: string}>>}
 */
async function readCompatibilityFixtures() {
  return Promise.all(fixtures.map(async (fixture) => {
    const source = await readFile(new URL(`fixtures/compatibility/${fixture.filename}`, import.meta.url), "utf8")

    return {...fixture, module: parse({...fixture, source}), source}
  }))
}

/**
 * Asserts exact locations for nested types, one map entry, an optional test,
 * a loop binding, and all three nested call arguments.
 * @param {{filename: string, language: string, module: import("../src/semantic/types.js").SemanticModule, source: string}} fixture - Parsed fixture.
 * @returns {void}
 */
function assertRepresentativeLocations(fixture) {
  const {filename, language, module, source} = fixture
  const expected = locationSpellings[language]
  const groups = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (
    module.entryPoint.body.statements.find((statement) => statement.kind == "LocalDeclaration" && statement.name == "groups")
  )
  const groupsType = /** @type {import("../src/semantic/types.js").MapType} */ (groups.type)
  const groupsValueType = /** @type {import("../src/semantic/types.js").ListType} */ (groupsType.valueType)
  const groupsLiteral = /** @type {import("../src/semantic/types.js").MapLiteral} */ (groups.initializer)
  const entry = groupsLiteral.entries[0]
  const optional = functionNamed(module, "optionalLabel")
  const optionalBranch = /** @type {import("../src/semantic/types.js").IfStatement} */ (optional.body.statements[0])
  const loopFunction = functionNamed(module, "orderedTotal")
  const loop = /** @type {import("../src/semantic/types.js").ForEachStatement} */ (
    loopFunction.body.statements.find((statement) => statement.kind == "ForEachStatement")
  )
  const branchCall = /** @type {import("../src/semantic/types.js").CallExpression} */ (
    findExpressions(module.entryPoint.body).find((expression) => expression.kind == "CallExpression" && expression.callee == "sumThree")
  )
  const typeRange = getNodeProvenance(module, groupsType).ranges.type
  const valueTypeRange = getNodeProvenance(module, groupsValueType).ranges.type
  const entryOperator = getNodeProvenance(module, entry).ranges.operator
  const optionalOperator = getNodeProvenance(module, optionalBranch.condition).ranges.operator
  const bindingName = getNodeProvenance(module, loop.valueBinding).ranges.name

  assert.ok(typeRange && valueTypeRange && entryOperator && optionalOperator && bindingName)
  expect(typeRange).toEqual(exactLocation(filename, source, expected.type))
  expect(valueTypeRange).toEqual(exactLocation(filename, source, expected.valueType, typeRange.start.offset))
  expect(entry.location).toEqual(exactLocation(filename, source, expected.entry))
  expect(entry.key.location).toEqual(exactLocation(filename, source, "\"main\"", entry.location.start.offset))
  expect(entry.value.location).toEqual(exactLocation(filename, source, expected.value, entry.key.location.end.offset))
  expect(textAt(source, entryOperator)).toEqual(expected.entryOperator)
  expect(textAt(source, optionalOperator)).toEqual(expected.optionalOperator)
  expect(loop.valueBinding.location).toEqual(exactLocation(filename, source, language == "php" ? "$item" : "item"))
  expect(bindingName).toEqual(loop.valueBinding.location)

  const callSpelling = "sumThree(countdown(1), 1, 2)"
  const callStart = source.indexOf(callSpelling)

  assert.ok(callStart >= 0)
  expect(branchCall.location).toEqual(locationFromOffsets(filename, source, callStart, callStart + callSpelling.length))
  expect(branchCall.arguments.map((argument) => textAt(source, argument.location))).toEqual(["countdown(1)", "1", "2"])
  expect(branchCall.arguments.map(({location}) => location)).toEqual([
    locationFromOffsets(filename, source, callStart + "sumThree(".length, callStart + "sumThree(countdown(1)".length),
    locationFromOffsets(filename, source, callStart + "sumThree(countdown(1), ".length, callStart + "sumThree(countdown(1), 1".length),
    locationFromOffsets(filename, source, callStart + "sumThree(countdown(1), 1, ".length, callStart + callSpelling.length - 1)
  ])
}

/** @param {import("../src/semantic/types.js").SemanticModule} module @param {string} name */
function functionNamed(module, name) {
  const declaration = module.functions.find((candidate) => candidate.name == name)

  assert.ok(declaration)
  return declaration
}

/**
 * Finds all expressions beneath one block without interpreting source text.
 * @param {import("../src/semantic/types.js").Block} block - Semantic block.
 * @returns {import("../src/semantic/types.js").Expression[]} Expressions.
 */
function findExpressions(block) {
  const found = []
  const visit = (value) => {
    if (!value || typeof value != "object") return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value.kind == "string" && [
      "BinaryExpression", "BooleanLiteral", "CallExpression", "CollectionSizeExpression", "IdentifierExpression",
      "IntegerLiteral", "ListIndexExpression", "ListLiteral", "MapLiteral", "MapLookupExpression", "OptionalIsPresent",
      "OptionalNone", "OptionalSome", "OptionalUnwrap", "StringLiteral", "UnaryExpression"
    ].includes(value.kind)) found.push(value)
    for (const [key, child] of Object.entries(value)) {
      if (!["location", "provenance", "sourceProvenance"].includes(key)) visit(child)
    }
  }

  visit(block)
  return /** @type {import("../src/semantic/types.js").Expression[]} */ (found)
}

/** @param {unknown} value */
function semanticKinds(value) {
  const kinds = new Set()
  const visit = (candidate) => {
    if (!candidate || typeof candidate != "object") return
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    if (typeof candidate.kind == "string") kinds.add(candidate.kind)
    for (const [key, child] of Object.entries(candidate)) {
      if (!["location", "provenance", "sourceProvenance"].includes(key)) visit(child)
    }
  }

  visit(value)
  return [...kinds].sort()
}

/** @param {string} source @param {import("../src/semantic/types.js").SourceLocation} location */
function textAt(source, location) {
  return source.slice(location.start.offset, location.end.offset)
}

/** @param {string} filename @param {string} source @param {string} spelling @param {number} [from] */
function exactLocation(filename, source, spelling, from = 0) {
  const start = source.indexOf(spelling, from)

  assert.ok(start >= 0, `${filename}: ${spelling}`)
  return locationFromOffsets(filename, source, start, start + spelling.length)
}

/** @param {string} filename @param {string} source @param {number} start @param {number} end */
function locationFromOffsets(filename, source, start, end) {
  return {end: pointAt(source, end), filename, start: pointAt(source, start)}
}

/** @param {string} source @param {number} offset */
function pointAt(source, offset) {
  const lines = source.slice(0, offset).split("\n")

  return {column: /** @type {string} */ (lines.at(-1)).length + 1, line: lines.length, offset}
}

/**
 * Executes one generated original-five program with its real required tools.
 * @param {string} language - Target language.
 * @param {string} source - Generated source.
 * @returns {Promise<string>} Exact stdout.
 */
async function execute(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-task013-${language}-`))

  try {
    const filename = path.join(directory, filenames[language])

    await writeFile(filename, source)
    if (language == "php" || language == "ruby") return (await execFileAsync(language, [filename])).stdout
    if (language == "javascript") return (await execFileAsync("node", [filename])).stdout
    if (language == "typescript") {
      const compiler = path.resolve("node_modules/.bin/tsc")

      await execFileAsync(compiler, [filename, "--target", "ES2024", "--module", "nodenext", "--strict"], {cwd: directory})
      return (await execFileAsync("node", [path.join(directory, "program.js")])).stdout
    }
    await execFileAsync("javac", [filename], {cwd: directory})
    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}
