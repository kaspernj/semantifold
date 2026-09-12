// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse} from "../index.js"

describe("reference classes, methods, and constructors", () => {
  it("resolves nominal class, constructor, receiver, method, and private-field identities", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const counter = module.classes[0]
    const add = counter.methods[0]
    const write = add.body.statements[0]
    const declaration = module.entryPoint.body.statements[0]
    const call = module.entryPoint.body.statements[3]

    expect(module.classes.map(({id, name}) => [id, name])).toEqual([
      ["class:0", "Counter"],
      ["class:1", "Pair"]
    ])
    expect(counter.fields.map(({id, name}) => [id, name])).toEqual([["class:0:field:0", "value"]])
    expect(counter.constructor).toMatchObject({id: "class:0:constructor", kind: "ConstructorDeclaration"})
    expect(counter.methods.map(({id, name}) => [id, name])).toEqual([
      ["class:0:method:0", "add"],
      ["class:0:method:1", "next"],
      ["class:0:method:2", "current"],
      ["class:0:method:3", "combine"]
    ])
    expect(write).toMatchObject({
      field: "class:0:field:0",
      kind: "PrivateFieldWriteStatement",
      receiver: {classId: "class:0", kind: "ReceiverExpression"}
    })
    expect(declaration).toMatchObject({
      initializer: {
        kind: "ReferenceConstruction",
        reference: {declarationId: "class:0", kind: "ReferenceType"},
        resolution: {declarationId: "class:0:constructor", kind: "ResolvedConstructorSignature"}
      },
      type: {declarationId: "class:0", kind: "ReferenceType"}
    })
    expect(call).toMatchObject({
      expression: {
        kind: "MethodCallExpression",
        method: "class:0:method:0",
        resolution: {declarationId: "class:0:method:0", kind: "ResolvedMethodSignature"}
      },
      kind: "ExpressionStatement"
    })
  })
})
