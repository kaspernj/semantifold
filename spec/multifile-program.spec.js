// @ts-check

import {describe, expect, it} from "@velocious/testing"
import * as semantifold from "../index.js"

describe("multi-file semantic programs", () => {
  it("resolves caller-supplied TypeScript modules and cross-file declarations by stable identity", () => {
    const program = semantifold.parseProgram({
      entryModule: "main",
      sources: [
        {
          filename: "src/main.ts",
          id: "main",
          language: "typescript",
          source: `import {User} from "./model.js"
import {label} from "./math_tools.js"

const user: User = new User("Ada")
console.log(label(user))
`
        },
        {
          filename: "src/math_tools.ts",
          id: "math_tools",
          language: "typescript",
          source: `import type {User} from "./model.js"

export function label(user: User): string {
  return user.name
}
`
        },
        {
          filename: "src/model.ts",
          id: "model",
          language: "typescript",
          source: `export class User {
  constructor(readonly name: string) {}
}
`
        }
      ]
    })

    expect(program.kind).toEqual("Program")
    expect(program.entryModule).toEqual("main")
    expect(program.modules.map(({id}) => id)).toEqual(["model", "math_tools", "main"])

    const [model, math, main] = program.modules

    expect(model.records?.[0].id).toEqual("model#record:0")
    expect(math.functions[0].id).toEqual("math_tools#function:0")
    expect(math.imports).toMatchObject([{
      declarationId: "model#record:0",
      importedName: "User",
      kind: "Import",
      localName: "User",
      moduleId: "model",
      symbolKind: "record",
      typeOnly: true
    }])
    expect(main.imports.map(({declarationId}) => declarationId)).toEqual([
      "model#record:0",
      "math_tools#function:0"
    ])
    expect(model.exports).toMatchObject([{
      declarationId: "model#record:0",
      exportedName: "User",
      kind: "Export",
      symbolKind: "record"
    }])

    const parameterType = math.functions[0].parameters[0].type
    const returnedMember = math.functions[0].body.statements[0]
    const userDeclaration = main.entryPoint?.body.statements[0]
    const print = main.entryPoint?.body.statements[1]

    expect(parameterType).toMatchObject({declarationId: "model#record:0", kind: "RecordType"})
    expect(returnedMember).toMatchObject({expression: {field: "model#record:0:field:0", kind: "MemberRead"}})
    expect(userDeclaration).toMatchObject({initializer: {kind: "RecordConstruction", record: {declarationId: "model#record:0"}}})
    expect(print).toMatchObject({expression: {kind: "CallExpression", resolution: {declarationId: "math_tools#function:0"}}})
  })
})
