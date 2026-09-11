// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifact, getNodeProvenance, getSymbolProvenance, parse, spansForSymbol} from "../index.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]

describe("closed record provenance and mapping", () => {
  it("binds declaration, type, construction, and member tokens to stable nominal identities", async () => {
    const source = await readFile(new URL("fixtures/records/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const record = module.records[0]
    const recordNode = getNodeProvenance(module, record)
    const recordSymbol = getSymbolProvenance(module, /** @type {string} */ (recordNode.symbolId))
    const field = record.fields[0]
    const fieldNode = getNodeProvenance(module, field)
    const fieldSymbol = getSymbolProvenance(module, /** @type {string} */ (fieldNode.symbolId))
    const construction = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (
      module.entryPoint.body.statements[0]
    ).initializer

    if (construction.kind != "RecordConstruction") throw new Error("Expected record construction fixture.")
    const constructionNode = getNodeProvenance(module, construction)
    const read = /** @type {import("../src/semantic/types.js").PrintStatement} */ (
      module.entryPoint.body.statements[2]
    ).expression

    if (read.kind != "MemberRead") throw new Error("Expected member read fixture.")
    const readNode = getNodeProvenance(module, read)

    expect({
      declaration: source.slice(recordNode.ranges.name.start.offset, recordNode.ranges.name.end.offset),
      identity: recordSymbol.semanticDeclarationId,
      kind: recordSymbol.kind,
      roles: [...new Set(recordSymbol.references.map(({role}) => role))].sort()
    }).toEqual({declaration: "Address", identity: "record:0", kind: "record", roles: ["construct", "type"]})
    expect({
      declaration: source.slice(fieldNode.ranges.name.start.offset, fieldNode.ranges.name.end.offset),
      identity: fieldSymbol.semanticDeclarationId,
      kind: fieldSymbol.kind,
      roles: [...new Set(fieldSymbol.references.map(({role}) => role))]
    }).toEqual({declaration: "city", identity: "record:0:field:0", kind: "field", roles: ["member"]})
    assert.equal(source.slice(constructionNode.ranges.record.start.offset, constructionNode.ranges.record.end.offset), "Address")
    assert.equal(constructionNode.symbolId, recordNode.symbolId)
    const fieldTypeNode = getNodeProvenance(module, field.type)
    const argumentNode = getNodeProvenance(module, construction.arguments[0])
    const receiverNode = getNodeProvenance(module, read.receiver)

    assert.equal(source.slice(fieldTypeNode.ranges.type.start.offset, fieldTypeNode.ranges.type.end.offset), "string")
    assert.equal(source.slice(argumentNode.origin.location.start.offset, argumentNode.origin.location.end.offset), '"Paris"')
    assert.equal(source.slice(receiverNode.origin.location.start.offset, receiverNode.origin.location.end.offset), "address")
    assert.equal(source.slice(readNode.ranges.member.start.offset, readNode.ranges.member.end.offset), "city")
    assert.equal(readNode.symbolId, fieldNode.symbolId)
  })

  it("maps nominal declaration, construction, type, and read spellings in every cohort backend", async () => {
    const source = await readFile(new URL("fixtures/records/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const recordSymbol = /** @type {string} */ (getNodeProvenance(module, module.records[0]).symbolId)
    const fieldSymbol = /** @type {string} */ (getNodeProvenance(module, module.records[1].fields[0]).symbolId)

    for (const language of cohort) {
      const artifact = generateArtifact({language, module})
      const recordRoles = new Set(spansForSymbol(artifact.mapping, recordSymbol).map(({role}) => role))
      const fieldRoles = new Set(spansForSymbol(artifact.mapping, fieldSymbol).map(({role}) => role))

      assert.ok(recordRoles.has("name"), language)
      assert.ok(recordRoles.has("type"), language)
      assert.ok(recordRoles.has("record"), language)
      assert.ok(fieldRoles.has("name"), language)
      assert.ok(fieldRoles.has("member"), language)
    }
  })
})
