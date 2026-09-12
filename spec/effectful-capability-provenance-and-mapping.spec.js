// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {createCapabilityAuthority, generateArtifact, getNodeProvenance, getSymbolProvenance, parse, spansForNode} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

const authority = createCapabilityAuthority(task034AuthorityInput())

describe("effectful capability provenance and mapping", () => {
  it("tracks synthetic authority, exact operation identity, transfers, borrows, failures, and protected support", () => {
    const source = `function consume(resource: ProbeResource): void { probeClose(resource, false) }
function run(): string {
  const resource: ProbeResource = probeAcquire(false)
  consume(resource)
  return probeTrace()
}
console.log(run())`
    const module = parse({capabilityAuthority: authority, filename: "provenance.ts", language: "typescript", source})
    const capability = module.capabilities[0]
    const close = module.functions[0].body.statements[0].expression
    const borrow = close.arguments[0]
    const move = module.functions[1].body.statements[1].expression.arguments[0]
    const operationSymbol = module.provenance.symbols.find(({semanticDeclarationId}) =>
      semanticDeclarationId == "capability:0/operation:3")

    expect(getNodeProvenance(module, capability).origin.kind).toBe("synthetic")
    assert.ok(operationSymbol)
    expect(getSymbolProvenance(module, operationSymbol.id).references.some(({nodeId}) =>
      nodeId == getNodeProvenance(module, close).id)).toBe(true)

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const artifact = generateArtifact({language, module})

      assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, close).id).length > 0, `${language}:effect`)
      assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, borrow).id).length > 0, `${language}:borrow`)
      assert.ok(spansForNode(artifact.mapping, getNodeProvenance(module, move).id).length > 0, `${language}:move`)
      assert.ok(artifact.mapping.spans.some(({origin}) => origin.kind == "synthetic" &&
        origin.reason == "semantifold-task034-support"), `${language}:support`)
    }
  })
})
