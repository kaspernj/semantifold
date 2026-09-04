// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {getNodeProvenance, getSymbolProvenance, parse, primaryLocation} from "../index.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

describe("semantic source provenance", () => {
  it("registers exact source content and deterministic node and symbol identities for every frontend", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/locals/${filename}`, import.meta.url), "utf8")
      const first = parse({filename, language, source})
      const second = parse({filename, language, source})

      assert.deepEqual(first.provenance, second.provenance)
      assert.equal(first.provenance.schema, "SemantifoldProvenance")
      assert.equal(first.provenance.version, 1)
      assert.equal(first.provenance.coordinateSystem, "utf16")
      assert.deepEqual(first.provenance.sources, [{content: source, filename, id: "source:0", language}])
      assert.equal(new Set(first.provenance.nodes.map((node) => node.id)).size, first.provenance.nodes.length)
      assert.equal(new Set(first.provenance.symbols.map((symbol) => symbol.id)).size, first.provenance.symbols.length)

      for (const node of first.provenance.nodes) {
        assert.equal(node.origin.kind, "source")
        assert.equal(node.origin.sourceId, "source:0")
        assert.equal(node.origin.location.filename, filename)
      }
      const associated = first.functions[0].sourceProvenance

      assert.equal(associated.schema, "SemantifoldNodeProvenance")
      assert.equal(associated.version, 1)
      assert.deepEqual(JSON.parse(JSON.stringify(associated)), associated)

      const declaration = first.functions[0]
      const declarationProvenance = getNodeProvenance(first, declaration)
      const declarationSymbol = getSymbolProvenance(first, declarationProvenance.symbolId)

      assert.equal(declarationProvenance.kind, "FunctionDeclaration")
      assert.equal(declarationSymbol.name, declaration.name)
      assert.equal(declarationSymbol.declarationNodeId, declarationProvenance.id)
      assert.equal(declarationSymbol.kind, "function")

      const entryAssignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (first.entryPoint.body.statements[1])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (entryAssignment.expression)
      const callProvenance = getNodeProvenance(first, call)
      const parameter = declaration.parameters[0]
      const condition = /** @type {import("../src/semantic/types.js").IfStatement} */ (declaration.body.statements.at(-1)).condition

      assert.equal(callProvenance.symbolId, declarationProvenance.symbolId)
      assert.equal(getNodeProvenance(first, condition).symbolId, getNodeProvenance(first, parameter).symbolId)
      assert.ok(declarationSymbol.references.some((reference) => reference.nodeId == callProvenance.id && reference.role == "call"))
    }
  })

  it("uses UTF-16 offsets and columns with LF, CRLF, lone CR, and astral input", () => {
    const source = "/*😀*/ function choose(a: number, b: number): number {\r\n  if (a > b) return a\r  else return b\n}\r\nconsole.log(choose(1, 2))\n"
    const module = parse({filename: "newlines.ts", language: "typescript", source})
    const functionLocation = module.functions[0].location

    assert.equal(functionLocation.start.offset, source.indexOf("function"))
    assert.equal(functionLocation.start.line, 1)
    assert.equal(functionLocation.start.column, 8)
    assert.equal(module.entryPoint.location.start.line, 5)
    assert.equal(module.location.end.offset, source.length)
    assert.equal(module.provenance.sources[0].content, source)
  })

  it("preserves parser-token ranges for declarations, types, calls, assignments, literals, and operators", async () => {
    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/locals/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const declaration = module.functions[0]
      const local = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (declaration.body.statements[0])
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (declaration.body.statements.at(-1))
      const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (branch.consequent.statements[0])
      const entryAssignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (module.entryPoint.body.statements[1])
      const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (entryAssignment.expression)

      assert.equal(sourceText(source, getNodeProvenance(module, declaration).ranges.name), declaration.name)
      assert.equal(sourceText(source, getNodeProvenance(module, declaration.parameters[0]).ranges.name).replace(/^\$/u, ""), declaration.parameters[0].name)
      assert.equal(sourceText(source, getNodeProvenance(module, local).ranges.name).replace(/^\$/u, ""), local.name)
      assert.match(sourceText(source, getNodeProvenance(module, local.type).origin.location), /String|string/u)
      assert.equal(sourceText(source, getNodeProvenance(module, assignment).ranges.operator), "=")
      assert.equal(sourceText(source, getNodeProvenance(module, call).ranges.callee), call.callee)
      assert.match(sourceText(source, getNodeProvenance(module, local.initializer).origin.location), /yes/u)
    }

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})
      const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements.at(-1))
      const binary = /** @type {import("../src/semantic/types.js").BinaryExpression} */ (branch.condition)

      assert.equal(sourceText(source, getNodeProvenance(module, binary).ranges.operator), ">")
    }
  })

  it("selects safe primary locations from the closed provenance union", () => {
    const location = {
      end: {column: 2, line: 1, offset: 1},
      filename: "source.ts",
      start: {column: 1, line: 1, offset: 0}
    }
    const related = {location, sourceId: "source:0"}

    assert.equal(primaryLocation({kind: "source", location, sourceId: "source:0"}), location)
    assert.equal(primaryLocation({kind: "derived", origins: [related]}), location)
    assert.equal(primaryLocation({kind: "synthetic", reason: "wrapper", relatedOrigins: [related]}), location)
    assert.equal(primaryLocation({kind: "synthetic", reason: "wrapper", relatedOrigins: []}), undefined)
  })
})

/**
 * Slices one normalized source location.
 * @param {string} source - Source content.
 * @param {import("../src/semantic/types.js").SourceLocation} location - Source location.
 * @returns {string} Exact source text.
 */
function sourceText(source, location) {
  return source.slice(location.start.offset, location.end.offset)
}
