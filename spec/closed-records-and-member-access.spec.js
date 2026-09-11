// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {parse} from "../index.js"

describe("closed records and member access", () => {
  it("resolves canonical TypeScript records, construction, and member reads nominally", () => {
    const module = parse({
      filename: "records.ts",
      language: "typescript",
      source: `class Address {
  constructor(readonly city: string) {}
}

class User {
  constructor(readonly name: string, readonly address: Address) {}
}

function pass(user: User): User {
  return user
}

const address: Address = new Address("Paris")
const user: User = new User("Ada", address)
console.log(pass(user).address.city)
`
    })

    expect(module.records.map(({id, name, fields}) => ({
      fields: fields.map(({id: fieldId, name: fieldName, type}) => ({
        fieldId,
        fieldName,
        type: type.kind == "RecordType"
          ? {declarationId: type.declarationId, kind: type.kind}
          : {kind: type.kind, name: /** @type {import("../src/semantic/types.js").TypeReference} */ (type).name}
      })),
      id,
      name
    }))).toEqual([
      {
        fields: [{fieldId: "record:0:field:0", fieldName: "city", type: {kind: "TypeReference", name: "string"}}],
        id: "record:0",
        name: "Address"
      },
      {
        fields: [
          {fieldId: "record:1:field:0", fieldName: "name", type: {kind: "TypeReference", name: "string"}},
          {fieldId: "record:1:field:1", fieldName: "address", type: {declarationId: "record:0", kind: "RecordType"}}
        ],
        id: "record:1",
        name: "User"
      }
    ])
    expect(module.functions[0].parameters[0].type).toMatchObject({declarationId: "record:1", kind: "RecordType"})
    expect(module.entryPoint.body.statements.map((statement) =>
      statement.kind == "LocalDeclaration" ? statement.initializer.kind : statement.expression.kind)).toEqual([
      "RecordConstruction", "RecordConstruction", "MemberRead"
    ])
    const printed = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[2]).expression

    expect(printed).toMatchObject({
      field: "record:0:field:0",
      kind: "MemberRead",
      receiver: {
        field: "record:1:field:1",
        kind: "MemberRead",
        receiver: {kind: "CallExpression"}
      }
    })
  })
})
